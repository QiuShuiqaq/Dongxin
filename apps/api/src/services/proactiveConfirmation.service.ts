import type { DeviceIntent } from '@dongxin/shared';
import { getDeviceControlRevision } from '../deviceSimulator.js';

interface PendingConfirmation {
  intent: DeviceIntent;
  playbackId: string;
  revision: number;
  expiresAt: number;
}

const pending = new Map<string, PendingConfirmation>();
const awaitingPlayback = new Map<string, { deviceId: string; intent: DeviceIntent; revision: number }>();

export function stageProactiveConfirmation(deviceId: string, playbackId: string, intent: DeviceIntent): void {
  clearProactiveConfirmation(deviceId);
  awaitingPlayback.set(playbackId, { deviceId, intent, revision: getDeviceControlRevision(deviceId) });
}

export function finishProactivePlayback(deviceId: string, playbackId: string, completed: boolean): void {
  const staged = awaitingPlayback.get(playbackId);
  if (!staged || staged.deviceId !== deviceId) return;
  awaitingPlayback.delete(playbackId);
  if (completed && staged.revision === getDeviceControlRevision(deviceId)) {
    pending.set(deviceId, { ...staged, playbackId, expiresAt: Date.now() + 30_000 });
  }
}

export function clearProactiveConfirmation(deviceId: string): void {
  pending.delete(deviceId);
  for (const [id, staged] of awaitingPlayback) {
    if (staged.deviceId === deviceId) awaitingPlayback.delete(id);
  }
}

export function takeProactiveConfirmation(deviceId: string, text: string): { intent?: DeviceIntent; declined?: boolean } | null {
  const value = pending.get(deviceId);
  if (!value) return null;
  if (Date.now() > value.expiresAt || value.revision !== getDeviceControlRevision(deviceId)) {
    pending.delete(deviceId);
    return null;
  }
  const normalized = text.replace(/[\s，。！？!?,.]/g, '').trim();
  if (/不|取消|算了|拒绝|别开|停/.test(normalized)) {
    pending.delete(deviceId);
    return { declined: true };
  }
  if (/^(好|好的|可以|需要|是|对|开吧|打开吧|帮我开)$/.test(normalized)) {
    pending.delete(deviceId);
    return { intent: value.intent };
  }
  pending.delete(deviceId);
  return null;
}
