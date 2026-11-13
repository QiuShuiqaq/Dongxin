import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEVICE_PRESENCE_TTL_MS, DevicePresence, projectDevicePresence, shouldProcessMqttUplink } from './devicePresence.js';
import type { DeviceProfile } from '@dongxin/shared';

const device = (protocol: DeviceProfile['protocol'], status: DeviceProfile['status'] = 'ONLINE'): DeviceProfile => ({
  id: `${protocol}-device`, name: 'Presence fixture', model: 'DX-AI-01', protocol, status,
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
});

test('MQTT status is unknown until fresh evidence, expires to unknown, and restarts unknown', () => {
  let now = 10_000;
  const presence = new DevicePresence(() => now);
  const generation = presence.startMqttSession();
  assert.equal(presence.mqttStatus('device-1'), 'UNKNOWN');
  assert.equal(presence.observeMqtt(generation, 'device-1', 'ONLINE', now), true);
  assert.equal(presence.mqttStatus('device-1'), 'ONLINE');

  now += DEVICE_PRESENCE_TTL_MS;
  assert.equal(presence.mqttStatus('device-1'), 'UNKNOWN');

  now += 1;
  const nextGeneration = presence.startMqttSession();
  assert.equal(presence.mqttStatus('device-1'), 'UNKNOWN');
  assert.equal(presence.observeMqtt(generation, 'device-1', 'ONLINE', now), false);
  assert.equal(presence.observeMqtt(nextGeneration, 'device-1', 'ONLINE', now), true);
  presence.endMqttSession();
  assert.equal(presence.mqttStatus('device-1'), 'UNKNOWN');
});

test('retained ONLINE reports are ignored, while a live heartbeat confirms presence', () => {
  let now = 50_000;
  const presence = new DevicePresence(() => now);
  const generation = presence.startMqttSession();

  const retainedOnlinePacket = { retain: true };
  if (shouldProcessMqttUplink(retainedOnlinePacket)) {
    presence.observeMqtt(generation, 'device-1', 'ONLINE', now);
  }
  assert.equal(presence.mqttStatus('device-1'), 'UNKNOWN');

  now += 1;
  const liveHeartbeatPacket = { retain: false };
  assert.equal(shouldProcessMqttUplink(liveHeartbeatPacket), true);
  presence.observeMqtt(generation, 'device-1', 'ONLINE', now);
  assert.equal(presence.mqttStatus('device-1'), 'ONLINE');
});

test('LWT/offline is visible in the current MQTT session, then restart requires fresh evidence', () => {
  let now = 75_000;
  const presence = new DevicePresence(() => now);
  const generation = presence.startMqttSession();
  presence.observeMqtt(generation, 'device-1', 'ONLINE', now);

  now += 1;
  presence.observeMqtt(generation, 'device-1', 'OFFLINE', now);
  assert.equal(presence.mqttStatus('device-1'), 'OFFLINE');

  const restartedProcessPresence = new DevicePresence(() => now);
  assert.equal(restartedProcessPresence.mqttStatus('device-1'), 'UNKNOWN');
  const restartedGeneration = restartedProcessPresence.startMqttSession();
  assert.equal(restartedProcessPresence.mqttStatus('device-1'), 'UNKNOWN');
  assert.equal(restartedProcessPresence.observeMqtt(restartedGeneration, 'device-1', 'ONLINE', now), true);
  assert.equal(restartedProcessPresence.mqttStatus('device-1'), 'ONLINE');
});

test('older queued observation cannot override a newer online/offline observation', () => {
  const presence = new DevicePresence(() => 20_000);
  const generation = presence.startMqttSession();
  assert.equal(presence.observeMqtt(generation, 'device-2', 'ONLINE', 12_000), true);
  assert.equal(presence.observeMqtt(generation, 'device-2', 'OFFLINE', 11_000), false);
  assert.equal(presence.mqttStatus('device-2'), 'ONLINE');
  assert.equal(presence.observeMqtt(generation, 'device-2', 'OFFLINE', 13_000), true);
  assert.equal(presence.mqttStatus('device-2'), 'OFFLINE');
});

test('HTTP presence is independent of MQTT restart and status projection fails closed', () => {
  let now = 30_000;
  const presence = new DevicePresence(() => now);
  presence.observeHttp('HTTP-device', 'ONLINE', now);
  const mqttDevice = { ...device('MQTT'), id: 'MQTT-device' };
  const httpDevice = device('HTTP');
  const simulator = device('SIMULATOR', 'ONLINE');

  assert.equal(projectDevicePresence(httpDevice, presence).status, 'ONLINE');
  assert.equal(projectDevicePresence(mqttDevice, presence).status as string, 'UNKNOWN');
  assert.equal(projectDevicePresence(simulator).status, 'ONLINE');

  const generation = presence.startMqttSession();
  presence.observeMqtt(generation, mqttDevice.id, 'ONLINE', 30_000);
  presence.endMqttSession();
  assert.equal(projectDevicePresence(mqttDevice, presence).status as string, 'UNKNOWN');
  assert.equal(projectDevicePresence(httpDevice, presence).status, 'ONLINE');
  now += DEVICE_PRESENCE_TTL_MS;
  assert.equal(projectDevicePresence(device('HTTP'), presence).status as string, 'UNKNOWN');
});
