import type { DeviceIntent, DeviceState } from '@dongxin/shared';
import { DeviceIntentSchema } from '@dongxin/shared';
import { z } from 'zod';
import { applyDeviceCommand, getDeviceState, patchDeviceState } from '../deviceSimulator.js';

export const PatchDeviceStateSchema = z.object({
  isOnline: z.boolean().optional(),
  ambientTemperature: z.number().optional(),
  humidity: z.number().optional(),
  hasOccupancy: z.boolean().optional(),
  voiceBroadcastEnabled: z.boolean().optional(),
  faultCode: z.string().nullable().optional()
});

export const DeviceCommandRequestSchema = z.object({
  intent: DeviceIntentSchema,
  slots: z.record(z.string(), z.unknown()).default({})
});

export function getCurrentDeviceState(deviceId?: string): DeviceState {
  return getDeviceState(deviceId);
}

export function patchCurrentDeviceState(
  patch: Partial<DeviceState>,
  deviceId?: string,
  options?: { bumpRevision?: boolean },
): DeviceState {
  return patchDeviceState(patch, deviceId, options);
}

export function executeDeviceCommand(intent: DeviceIntent, slots: Record<string, unknown> = {}, deviceId?: string): DeviceState {
  return applyDeviceCommand(intent, slots, deviceId);
}
