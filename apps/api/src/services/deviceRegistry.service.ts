import type { DeviceCommandRecord, DeviceEvent, DeviceProfile, DeviceState } from '@dongxin/shared';
import { DeviceEventTypeSchema } from '@dongxin/shared';
import { z } from 'zod';
import { ApiError } from '../http/apiError.js';
import { DEFAULT_DEVICE_ID, appendDeviceCommand, appendDeviceEvent, getDeviceProfile, listDeviceProfiles, patchDeviceCommand, saveDeviceProfiles } from '../repositories/system.repository.js';
import { getCurrentDeviceState, patchCurrentDeviceState, executeDeviceCommand } from './device.service.js';
import { appendLog } from './log.service.js';

export const DeviceEventRequestSchema = z.object({
  deviceId: z.string().min(1).default(DEFAULT_DEVICE_ID),
  type: DeviceEventTypeSchema,
  payload: z.record(z.string(), z.unknown()).default({})
});

export async function listDevices(): Promise<DeviceProfile[]> {
  return listDeviceProfiles();
}

export async function getDevice(deviceId: string): Promise<DeviceProfile> {
  const device = await getDeviceProfile(deviceId);
  if (!device) {
    throw new ApiError(404, 'DEVICE_NOT_FOUND', `Unknown device: ${deviceId}`);
  }
  return device;
}

export async function saveDevices(devices: DeviceProfile[]): Promise<DeviceProfile[]> {
  return saveDeviceProfiles(devices);
}

export async function getDeviceState(deviceId: string): Promise<DeviceState> {
  void deviceId;
  return getCurrentDeviceState();
}

export async function recordDeviceEvent(requestBody: unknown): Promise<DeviceEvent> {
  const body = DeviceEventRequestSchema.parse(requestBody);
  const event = await appendDeviceEvent(body);
  await appendLog({
    type: 'DEVICE',
    summary: `Device event ${body.type}`,
    payload: body
  });

  if (body.type === 'STATE_REPORT' || body.type === 'OCCUPANCY' || body.type === 'RADAR' || body.type === 'FAULT') {
    patchCurrentDeviceState(extractStatePatch(body.payload));
  }

  return event;
}

export async function executeCommandForDevice(
  deviceId: string,
  command: DeviceCommandRecord
): Promise<{ state: DeviceState; command: DeviceCommandRecord }> {
  void deviceId;
  const state = executeDeviceCommand(command.intent, command.slots);
  const nextCommand = await patchDeviceCommand(command.id, {
    status: 'APPLIED',
    completedAt: new Date().toISOString()
  });

  await appendLog({
    type: 'COMMAND',
    summary: `Command applied: ${command.intent}`,
    payload: {
      commandId: nextCommand?.id ?? command.id,
      intent: command.intent,
      slots: command.slots
    }
  });

  return {
    state,
    command: nextCommand ?? command
  };
}

export async function queueDeviceCommand(command: Omit<DeviceCommandRecord, 'id' | 'createdAt'>): Promise<DeviceCommandRecord> {
  return appendDeviceCommand(command);
}

function extractStatePatch(payload: Record<string, unknown>): Partial<DeviceState> {
  return {
    isOnline: typeof payload.isOnline === 'boolean' ? payload.isOnline : undefined,
    ambientTemperature: typeof payload.ambientTemperature === 'number' ? payload.ambientTemperature : undefined,
    humidity: typeof payload.humidity === 'number' ? payload.humidity : undefined,
    hasOccupancy: typeof payload.hasOccupancy === 'boolean' ? payload.hasOccupancy : undefined,
    voiceBroadcastEnabled: typeof payload.voiceBroadcastEnabled === 'boolean' ? payload.voiceBroadcastEnabled : undefined,
    faultCode: typeof payload.faultCode === 'string' || payload.faultCode === null ? (payload.faultCode as string | null) : undefined
  };
}
