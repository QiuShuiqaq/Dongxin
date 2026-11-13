import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import Fastify from 'fastify';
import type { DeviceCommandRecord, DeviceEvent, DeviceProfile, DeviceState } from '@dongxin/shared';
import { ApiError } from '../http/apiError.js';

const now = '2026-11-13T00:00:00.000Z';
const state: DeviceState = {
  isOnline: true,
  activeModes: [],
  targetTemperature: 38,
  ambientTemperature: 25,
  hasOccupancy: false,
  voiceBroadcastEnabled: true,
  faultCode: null,
  updatedAt: now
};
const profiles = new Map<string, DeviceProfile>([
  ['SIM-001', {
    id: 'SIM-001', name: 'Simulator', model: 'DX-AI-01', protocol: 'SIMULATOR',
    status: 'ONLINE', createdAt: now, updatedAt: now
  }],
  ['DX-PILOT-001', {
    id: 'DX-PILOT-001', name: 'Physical pilot', model: 'DX-AI-01', protocol: 'MQTT',
    status: 'ONLINE', createdAt: now, updatedAt: now
  }],
  ['DX-HTTP-001', {
    id: 'DX-HTTP-001', name: 'Physical HTTP device', model: 'DX-AI-01', protocol: 'HTTP',
    status: 'ONLINE', createdAt: now, updatedAt: now
  }]
]);
const queued: DeviceCommandRecord[] = [];
const events: DeviceEvent[] = [];
const executed: string[] = [];
let transportCalls = 0;

mock.module(new URL('../services/deviceRegistry.service.js', import.meta.url).href, {
  namedExports: {
    getDevice: async (deviceId: string) => {
      const device = profiles.get(deviceId);
      if (!device) throw new ApiError(404, 'DEVICE_NOT_FOUND', 'Unknown device');
      return device;
    },
    getDeviceState: async () => state,
    listDevices: async () => [...profiles.values()],
    listCommandsForDevice: async (deviceId: string) => queued.filter((item) => item.deviceId === deviceId),
    queueDeviceCommand: async (input: Omit<DeviceCommandRecord, 'id' | 'createdAt'>) => {
      const command: DeviceCommandRecord = { ...input, id: 'command-1', createdAt: now };
      queued.push(command);
      return command;
    },
    executeCommandForDevice: async (deviceId: string, command: DeviceCommandRecord) => {
      executed.push(deviceId);
      return { state, command: { ...command, status: 'APPLIED' } };
    },
    recordDeviceEvent: async (input: Omit<DeviceEvent, 'id' | 'createdAt'>) => {
      const event: DeviceEvent = { ...input, id: 'event-1', createdAt: now };
      events.push(event);
      return event;
    }
  }
});
mock.module(new URL('../services/mqttGateway.service.js', import.meta.url).href, {
  namedExports: {
    publishQueuedDeviceCommand: async () => {
      transportCalls += 1;
      throw new Error('Generic simulation route must never publish to MQTT');
    }
  }
});

const { registerDevicesRoutes } = await import('./devices.routes.js');

async function withRoutes(run: (server: ReturnType<typeof Fastify>) => Promise<void>) {
  queued.length = 0;
  events.length = 0;
  executed.length = 0;
  transportCalls = 0;
  const server = Fastify();
  await registerDevicesRoutes(server);
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

test('generic command route rejects physical MQTT and HTTP devices before queuing', async () => {
  await withRoutes(async (server) => {
    for (const deviceId of ['DX-PILOT-001', 'DX-HTTP-001']) {
      const response = await server.inject({
        method: 'POST', url: `/api/devices/${deviceId}/commands`,
        payload: { intent: 'LIGHT_ON' }
      });
      assert.equal(response.statusCode, 403, response.body);
      assert.equal(response.json().code, 'PHYSICAL_DEVICE_SIMULATION_FORBIDDEN');
    }
    assert.equal(queued.length, 0);
    assert.equal(executed.length, 0);
    assert.equal(transportCalls, 0);
  });
});

test('generic event route rejects physical reports and cannot spoof the URL device ID', async () => {
  await withRoutes(async (server) => {
    const rejected = await server.inject({
      method: 'POST', url: '/api/devices/DX-PILOT-001/events',
      payload: { type: 'STATE_REPORT', payload: { isOnline: true } }
    });
    assert.equal(rejected.statusCode, 403, rejected.body);
    assert.equal(events.length, 0);
    assert.equal(transportCalls, 0);

    const accepted = await server.inject({
      method: 'POST', url: '/api/devices/SIM-001/events',
      payload: { deviceId: 'DX-PILOT-001', type: 'RADAR', payload: { hasOccupancy: true } }
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.deviceId, 'SIM-001');
  });
});

test('generic simulator command remains a local simulation', async () => {
  await withRoutes(async (server) => {
    const response = await server.inject({
      method: 'POST', url: '/api/devices/SIM-001/commands',
      payload: { intent: 'LIGHT_ON' }
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(queued.length, 1);
    assert.deepEqual(executed, ['SIM-001']);
    assert.equal(transportCalls, 0);
    assert.equal(response.json().command.status, 'APPLIED');
  });
});
