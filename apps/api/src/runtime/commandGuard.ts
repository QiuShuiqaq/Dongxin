import type { DeviceCommandRecord } from '@dongxin/shared';
import { getDeviceControlRevision } from '../deviceSimulator.js';
import { ApiError } from '../http/apiError.js';
import { assertWorkActive, currentWorkDeadline, currentWorkId, isVoiceWorkActive } from './workload.js';

const field = '_voiceGuard';
export function voiceCommandGuard(deviceId: string, expectedRevision: number): Record<string, unknown> {
  assertVoiceRevision(deviceId, expectedRevision);
  return { [field]: { revision: expectedRevision, expiresAt: currentWorkDeadline() ?? Date.now() + 45_000, workId: currentWorkId() } };
}

export function assertVoiceRevision(deviceId: string, expectedRevision: number): void {
  assertWorkActive();
  if (expectedRevision !== getDeviceControlRevision(deviceId)) {
    throw new ApiError(409, 'STALE_VOICE_COMMAND', '设备状态已变化，本次语音控制已取消，请重新操作');
  }
}

/** Repeat admission immediately before delivery, including reconnect replay. */
export function isCommandCurrent(command: DeviceCommandRecord, now = Date.now()): boolean {
  const guard = command.slots[field] as { revision?: unknown; expiresAt?: unknown; workId?: unknown } | undefined;
  if (!guard) return now < commandExpiresAt(command);
  return isCommandRevisionCurrent(command, now)
    && (guard.workId === undefined || typeof guard.workId === 'string' && isVoiceWorkActive(guard.workId));
}

/** Confirmation is a new turn: validate the old revision/deadline, not its finished work ID. */
export function isCommandRevisionCurrent(command: DeviceCommandRecord, now = Date.now()): boolean {
  const guard = command.slots[field] as { revision?: unknown; expiresAt?: unknown } | undefined;
  return !!guard && typeof guard.revision === 'number' && guard.revision === getDeviceControlRevision(command.deviceId)
    && typeof guard.expiresAt === 'number' && now < guard.expiresAt
    && now < commandExpiresAt(command);
}

export function commandExpiresAt(command: DeviceCommandRecord): number {
  const guard = command.slots[field] as { expiresAt?: unknown } | undefined;
  const fallback = Date.parse(command.createdAt) + 60_000;
  return typeof guard?.expiresAt === 'number' ? Math.min(fallback, guard.expiresAt) : fallback;
}
