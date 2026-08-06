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

export function getCurrentDeviceState(): DeviceState {
  return getDeviceState();
}

export function patchCurrentDeviceState(patch: Partial<DeviceState>): DeviceState {
  return patchDeviceState(patch);
}

export function executeDeviceCommand(intent: DeviceIntent, slots: Record<string, unknown> = {}): DeviceState {
  return applyDeviceCommand(intent, slots);
}
