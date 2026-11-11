import cors from '@fastify/cors';
import Fastify from 'fastify';
import { z } from 'zod';
import { ApiError, publicErrorBody } from './http/apiError.js';
import { registerRoutes } from './routes/index.js';
import { startMqttGateway, stopMqttGateway } from './services/mqttGateway.service.js';
import { assertDeviceAuthConfiguration, authenticateDeviceRequest } from './services/deviceAuth.service.js';
import { deviceCredentialBackend, setDeviceCredentialPool } from './services/deviceAuth.service.js';
import { createPostgresPool } from './runtime/postgres.js';
import { assertMigrationsApplied, loadMigrations } from './runtime/migrations.js';
import type { Pool } from 'pg';
import { startRuntimeMaintenance } from './runtime/maintenance.js';
import { initializeUsage } from './runtime/usage.js';
import { getRuntimeStatus } from './runtime/status.js';
import { assertPilotDeviceLimit } from './runtime/pilotLimits.js';
import { listDeviceProfiles } from './repositories/system.repository.js';
import { assertVoiceHistoryConfiguration, setVoiceHistoryPool, voiceHistoryBackend } from './repositories/voiceHistory.repository.js';
import { setProductionVoiceHistoryPool } from './repositories/productionVoiceHistory.repository.js';
import {
  assertOperationsAuthConfiguration,
  authenticateOperationsRequest,
  getOperationsCorsOrigins,
} from './services/operationsAuth.service.js';

export async function createServer() {
  if (process.env.NODE_ENV === 'production' && process.env.DONGXIN_PILOT_JSON_MODE !== 'acknowledge-local-json-limits') {
    throw new Error('Production storage is not implemented. This release uses local JSON and in-memory control state. Set DONGXIN_PILOT_JSON_MODE=acknowledge-local-json-limits only for an explicitly bounded, single-instance hardware pilot; do not use it for consumer production.');
  }
  if (process.env.NODE_ENV === 'production') {
    assertPilotDeviceLimit(await listDeviceProfiles());
  }
  assertOperationsAuthConfiguration();
  assertDeviceAuthConfiguration();
  assertVoiceHistoryConfiguration();
  if (process.env.NODE_ENV === 'production' && process.env.MQTT_ENABLED !== 'false' &&
      !String(process.env.MQTT_URL || '').startsWith('mqtts://')) {
    throw new Error('Production MQTT gateway requires MQTT_URL=mqtts://...');
  }
  getRuntimeStatus(); // Validate environment limits before accepting traffic.
  const server = Fastify({
    logger: true,
    bodyLimit: 10 * 1024 * 1024
  });

  await server.register(cors, {
    origin: getOperationsCorsOrigins(),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id', 'X-Request-Id', 'X-Timestamp', 'X-Signature', 'X-Voice-Test-Session-Id', 'X-Stm32-Control-Revision']
  });

  server.addHook('onRequest', async (request) => {
    if (process.env.NODE_ENV === 'production' && request.url.split('?', 1)[0].startsWith('/api/development/')) {
      throw new ApiError(404, 'NOT_FOUND', '接口不存在');
    }
    if (isPublicApiRequest(request.method, request.url)) return;
    const user = authenticateOperationsRequest(request.headers.authorization);
    if (user.role !== 'ADMIN' && !['GET', 'HEAD'].includes(request.method) && !request.url.startsWith('/api/knowledge/')) {
      throw new ApiError(403, 'FORBIDDEN', '该账号仅有知识库操作权限');
    }
  });

  server.addContentTypeParser(
    ['application/octet-stream', 'audio/pcm', 'audio/l16'],
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body)
  );

  // Authenticate before reading audio, then bind the parsed body to the same identity.
  server.addHook('onRequest', async (request) => {
    if (request.method !== 'OPTIONS' && request.url.startsWith('/api/device/v1/')) await authenticateDeviceRequest(request);
  });
  server.addHook('preValidation', async (request) => {
    if (request.method !== 'OPTIONS' && request.url.startsWith('/api/device/v1/')) await authenticateDeviceRequest(request);
  });

  await registerRoutes(server);

  let stopMaintenance: (() => Promise<void>) | undefined;
  let credentialPool: Pool | null = null;
  server.addHook('onReady', async () => {
    if (deviceCredentialBackend() === 'postgres' || voiceHistoryBackend() === 'postgres') {
      credentialPool = createPostgresPool();
      try {
        await credentialPool.query('SELECT 1');
        await assertMigrationsApplied(credentialPool, await loadMigrations());
        if (deviceCredentialBackend() === 'postgres') setDeviceCredentialPool(credentialPool);
        if (voiceHistoryBackend() === 'postgres') {
          setVoiceHistoryPool(credentialPool);
          setProductionVoiceHistoryPool(credentialPool);
        }
      } catch (error) {
        await credentialPool.end();
        credentialPool = null;
        throw error;
      }
    }
    await initializeUsage();
    stopMaintenance = startRuntimeMaintenance((error) => server.log.error(error), credentialPool);
    startMqttGateway(server.log);
  });
  server.addHook('onClose', async () => {
    await stopMaintenance?.();
    await stopMqttGateway();
    setDeviceCredentialPool(null);
    setVoiceHistoryPool(null);
    setProductionVoiceHistoryPool(null);
    await credentialPool?.end();
  });

  server.setErrorHandler((error, _request, reply) => {
    const isValidationError = error instanceof z.ZodError;
    const isApiError = error instanceof ApiError;
    const nativeStatus = (error as { statusCode?: number }).statusCode;
    const statusCode = isValidationError ? 422 : isApiError ? error.statusCode : nativeStatus && nativeStatus >= 400 && nativeStatus < 500 ? nativeStatus : 500;
    const code = isValidationError ? 'VALIDATION_ERROR' : isApiError ? error.code : 'INTERNAL_ERROR';
    const message = error instanceof Error ? error.message : String(error);

    server.log.error(error);
    if (statusCode === 429) reply.header('Retry-After', '3');
    reply.status(statusCode).send(publicErrorBody(statusCode, code, message));
  });

  return server;
}

function isPublicApiRequest(method: string, url: string): boolean {
  if (method === 'OPTIONS') return true;
  const path = url.split('?', 1)[0];
  return (
    path === '/' ||
    path === '/api/health' ||
    path === '/api/auth/login' ||
    path === '/api/auth/status' ||
    path.startsWith('/api/device/v1/')
  );
}
