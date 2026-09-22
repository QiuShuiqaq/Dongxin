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
import {
  completeVoiceTest,
  failVoiceTest,
  markVoiceTestProcessing
} from '../services/voiceTest.service.js';

const DeviceIdQuerySchema = z.object({
  deviceId: z.string().min(1)
});

const PollQuerySchema = z.object({
  deviceId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(20).default(5)
});

const DevicePcmQuerySchema = z.object({
  deviceId: z.string().min(1),
  sampleRate: z.coerce.number().int().min(8_000).max(48_000).default(16_000),
  bitsPerSample: z.coerce.number().int().refine((value) => value === 16, {
    message: 'only 16-bit PCM is supported'
  }).default(16),
  channels: z.coerce.number().int().min(1).max(2).default(1),
  asrProviderId: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  ttsProviderId: z.string().min(1).optional(),
  requireWakeWord: z.enum(['0', '1']).default('1').transform((value) => value === '1'),
  synthesizeSpeech: z.enum(['0', '1']).default('0').transform((value) => value === '1'),
  testMode: z.enum(['FULL_PIPELINE', 'ASR_ONLY']).default('FULL_PIPELINE')
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

  server.post('/api/device/v1/voice-pcm', async (request) => {
    const query = DevicePcmQuerySchema.parse(request.query);
    if (!Buffer.isBuffer(request.body)) {
      throw new Error('voice-pcm requires a raw PCM request body');
    }

    const testSessionId = readHeader(request, 'x-voice-test-session-id');
    const wav = wrapPcmAsWav(
      request.body,
      query.sampleRate,
      query.bitsPerSample,
      query.channels
    );
    try {
      if (testSessionId) await markVoiceTestProcessing(testSessionId);
      const result = await runVoicePipeline({
        deviceId: query.deviceId,
        inputSource: 'DEVICE_AUDIO',
        audioBase64: wav.toString('base64'),
        mimeType: 'audio/wav',
        asrProviderId: query.asrProviderId,
        providerId: query.providerId,
        ttsProviderId: query.ttsProviderId,
        requireWakeWord: query.requireWakeWord,
        synthesizeSpeech: query.synthesizeSpeech,
        testMode: query.testMode,
        simulateOffline: 'MISS',
        applyToDevice: true
      });
      if (testSessionId) await completeVoiceTest(testSessionId, result);
      return ok(request, result);
    } catch (error) {
      if (testSessionId) await failVoiceTest(testSessionId, error);
      throw error;
    }
  });

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

function readHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function wrapPcmAsWav(
  pcm: Buffer,
  sampleRate: number,
  bitsPerSample: number,
  channels: number
): Buffer {
  const blockAlign = channels * (bitsPerSample / 8);
  const dataLength = pcm.length - (pcm.length % blockAlign);
  const header = Buffer.alloc(44);

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataLength, 40);

  return Buffer.concat([header, pcm.subarray(0, dataLength)]);
}
