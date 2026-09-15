import type { FastifyInstance } from 'fastify';
import { DEFAULT_DEVICE_ID } from '../repositories/system.repository.js';
import {
  DeviceCommandRequestSchema,
  PatchDeviceStateSchema,
  executeDeviceCommand,
  getCurrentDeviceState,
  patchCurrentDeviceState
} from '../services/device.service.js';
import {
  executeCommandForDevice,
  getDevice,
  getDeviceState,
  listCommandsForDevice,
  listDevices,
  queueDeviceCommand,
  recordDeviceEvent
} from '../services/deviceRegistry.service.js';
import { publishQueuedDeviceCommand } from '../services/mqttGateway.service.js';

export async function registerDevicesRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/device-state', async () => getCurrentDeviceState());

  server.get('/api/devices', async () => listDevices());

  server.get('/api/devices/:deviceId', async (request) => {
    const { deviceId } = request.params as { deviceId: string };
    return getDevice(deviceId);
  });

  server.get('/api/devices/:deviceId/state', async (request) => {
    const { deviceId } = request.params as { deviceId: string };
    return getDeviceState(deviceId);
  });

  server.patch('/api/device-state', async (request) => {
    const patch = PatchDeviceStateSchema.parse(request.body);
    return patchCurrentDeviceState(patch);
  });

  server.post('/api/device/command', async (request) => {
    const body = DeviceCommandRequestSchema.parse(request.body);
    return executeDeviceCommand(body.intent, body.slots);
  });

  server.post('/api/devices/:deviceId/events', async (request) => {
    const { deviceId } = request.params as { deviceId: string };
    return recordDeviceEvent({
      deviceId,
      ...(request.body as Record<string, unknown>)
    });
  });

  server.post('/api/devices/:deviceId/commands', async (request) => {
    const { deviceId } = request.params as { deviceId: string };
    const body = DeviceCommandRequestSchema.parse(request.body);
    const command = await queueDeviceCommand({
      deviceId,
      intent: body.intent,
      slots: body.slots,
      status: 'QUEUED',
      safetyDecision: null,
      completedAt: null
    });
    const device = await getDevice(deviceId);
    if (device.protocol === 'SIMULATOR') {
      return executeCommandForDevice(deviceId, command);
    }

    const delivered = await publishQueuedDeviceCommand(command);
    return {
      state: await getDeviceState(deviceId),
      command,
      delivery: delivered ? 'MQTT' : 'QUEUED_FOR_DEVICE'
    };
  });

  server.get('/api/devices/:deviceId/commands', async (request) => {
    const { deviceId } = request.params as { deviceId: string };
    await getDevice(deviceId);
    return listCommandsForDevice(deviceId);
  });
}
