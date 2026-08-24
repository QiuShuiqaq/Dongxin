import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  getDeviceAccessConfig,
  handleDeviceAccessEvent,
  handleDeviceAccessVoiceTurn,
  handleDeviceCommandResult,
  handleDeviceHeartbeat,
  handleDeviceStateReport,
  pollDeviceAccessCommands,
  registerDeviceAccess
} from '../services/deviceAccess.service.js';
import { runVoicePipeline } from '../services/voicePipeline.service.js';

const DeviceIdQuerySchema = z.object({
  deviceId: z.string().min(1)
});

const PollQuerySchema = z.object({
  deviceId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(20).default(5)
});

export async function registerDeviceAccessRoutes(server: FastifyInstance): Promise<void> {
  server.post('/api/device/v1/register', async (request) =>
    ok(request, await registerDeviceAccess(request.body))
  );

  server.post('/api/device/v1/heartbeat', async (request) =>
    ok(request, await handleDeviceHeartbeat(request.body))
  );

  server.get('/api/device/v1/config', async (request) => {
    const query = DeviceIdQuerySchema.parse(request.query);
    return ok(request, await getDeviceAccessConfig(query.deviceId));
  });

  server.post('/api/device/v1/state', async (request) =>
    ok(request, await handleDeviceStateReport(request.body))
  );

  server.post('/api/device/v1/events', async (request) =>
    ok(request, await handleDeviceAccessEvent(request.body))
  );

  server.post('/api/device/v1/voice-turn', async (request) =>
    ok(request, await handleDeviceAccessVoiceTurn(request.body))
  );

  server.post('/api/device/v1/voice-audio', async (request) =>
    ok(
      request,
      await runVoicePipeline({
        ...(request.body as Record<string, unknown>),
        inputSource: 'DEVICE_AUDIO',
        applyToDevice: true
      })
    )
  );

  server.get('/api/device/v1/commands/poll', async (request) => {
    const query = PollQuerySchema.parse(request.query);
    return ok(request, await pollDeviceAccessCommands(query.deviceId, query.limit));
  });

  server.post('/api/device/v1/commands/result', async (request) =>
    ok(request, await handleDeviceCommandResult(request.body))
  );
}

function ok<T>(request: FastifyRequest, data: T) {
  const requestId = readRequestId(request);
  return {
    success: true,
    requestId,
    serverTime: new Date().toISOString(),
    data
  };
}

function readRequestId(request: FastifyRequest): string {
  const headerValue = request.headers['x-request-id'];
  return Array.isArray(headerValue) ? headerValue[0] : headerValue || `req_${Date.now()}`;
}
