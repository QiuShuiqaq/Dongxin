import type { DeviceProfile } from '@dongxin/shared';
import { performance } from 'node:perf_hooks';

type PresenceState = 'ONLINE' | 'OFFLINE';
type ObservedPresence = { state: PresenceState; receivedAt: number };

// The firmware sends a heartbeat every 15-17 minutes. This is an expiry
// threshold, not a claim that a device has disconnected at the deadline.
export const DEVICE_PRESENCE_TTL_MS = 35 * 60 * 1000;
const DEVICE_PRESENCE_MAX_ENTRIES = 200_000;

export function shouldProcessMqttUplink(packet: { retain?: boolean }): boolean {
  return packet.retain !== true;
}

export class DevicePresence {
  private mqttGeneration = 0;
  private mqttConnected = false;
  private mqtt = new Map<string, ObservedPresence>();
  private http = new Map<string, ObservedPresence>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  startMqttSession(): number {
    this.mqttGeneration += 1;
    this.mqttConnected = true;
    this.mqtt.clear();
    return this.mqttGeneration;
  }

  endMqttSession(): void {
    this.mqttGeneration += 1;
    this.mqttConnected = false;
    this.mqtt.clear();
  }

  isCurrentMqttSession(generation: number): boolean {
    return this.mqttConnected && this.mqttGeneration === generation;
  }

  observeMqtt(generation: number, deviceId: string, state: PresenceState, receivedAt: number): boolean {
    if (!this.isCurrentMqttSession(generation)) return false;
    return this.observe(this.mqtt, deviceId, state, receivedAt);
  }

  observeHttp(deviceId: string, state: PresenceState, receivedAt = this.now()): void {
    this.observe(this.http, deviceId, state, receivedAt);
  }

  mqttStatus(deviceId: string): PresenceState | 'UNKNOWN' {
    return this.mqttConnected ? this.status(this.mqtt, deviceId) : 'UNKNOWN';
  }

  effectiveStatus(device: DeviceProfile): DeviceProfile['status'] {
    if (device.protocol === 'SIMULATOR') return device.status;
    const presence = device.protocol === 'MQTT' ? this.mqttStatus(device.id) : this.status(this.http, device.id);
    return presence === 'ONLINE' && device.status === 'FAULT' ? 'FAULT' : presence;
  }

  private observe(map: Map<string, ObservedPresence>, deviceId: string, state: PresenceState, receivedAt: number): boolean {
    const previous = map.get(deviceId);
    if (previous && previous.receivedAt > receivedAt) return false;
    map.delete(deviceId);
    map.set(deviceId, { state, receivedAt });
    if (map.size > DEVICE_PRESENCE_MAX_ENTRIES) {
      const cutoff = this.now() - DEVICE_PRESENCE_TTL_MS;
      for (const [id, entry] of map) {
        if (entry.receivedAt >= cutoff) break;
        map.delete(id);
      }
      while (map.size > DEVICE_PRESENCE_MAX_ENTRIES) {
        const oldest = map.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    }
    return true;
  }

  private status(map: Map<string, ObservedPresence>, deviceId: string): PresenceState | 'UNKNOWN' {
    const entry = map.get(deviceId);
    if (!entry || this.now() - entry.receivedAt >= DEVICE_PRESENCE_TTL_MS) return 'UNKNOWN';
    return entry.state;
  }
}

export const devicePresence = new DevicePresence();

export function projectDevicePresence(device: DeviceProfile, presence = devicePresence): DeviceProfile {
  return { ...device, status: presence.effectiveStatus(device) };
}
