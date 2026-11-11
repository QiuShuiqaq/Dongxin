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
  archiveVoiceTestPcm,
  completeVoiceTest,
  failVoiceTest,
  markVoiceTestProcessing
} from '../services/voiceTest.service.js';
import { getDeviceVoiceReplyPcm } from '../services/deviceAudioAsset.service.js';
import { getDeviceVolume } from '../repositories/deviceVolume.repository.js';
import { isConversationEnd } from '../services/conversation.service.js';
import { beginVoiceTestWork } from '../runtime/voiceTestWork.js';
import { replayDeviceVoice } from '../runtime/requestReplay.js';
import { DEVICE_PCM_BODY_LIMIT, wrapDevicePcmAsWav } from '../services/devicePcm.service.js';
import { ApiError } from '../http/apiError.js';

const DeviceIdQuerySchema = z.object({
  deviceId: z.string().min(1)
});

const PollQuerySchema = z.object({
  deviceId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(20).default(5)
});

export const DevicePcmQuerySchema = z.object({
  deviceId: z.string().min(1),
  sampleRate: z.coerce.number().int().refine((value) => value === 16_000, {
    message: 'the C3 voice endpoint requires 16000 Hz PCM'
  }).default(16_000),
  bitsPerSample: z.coerce.number().int().refine((value) => value === 16, {
    message: 'the C3 voice endpoint requires 16-bit PCM'
  }).default(16),
  channels: z.coerce.number().int().refine((value) => value === 1, {
    message: 'the C3 voice endpoint requires mono PCM'
  }).default(1),
  asrProviderId: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  ttsProviderId: z.string().min(1).optional(),
  requireWakeWord: z.enum(['0', '1']).default('1').transform((value) => value === '1'),
  ciWake: z.enum(['0', '1']).default('0').transform((value) => value === '1'),
  synthesizeSpeech: z.enum(['0', '1']).default('0').transform((value) => value === '1'),
  testMode: z.enum(['FULL_PIPELINE', 'ASR_ONLY']).default('FULL_PIPELINE')
});

const VoiceReplyParamsSchema = z.object({
  id: z.string().uuid()
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
    ok(request, await replayDeviceVoice(request, () => handleDeviceAccessVoiceTurn(request.body, { recordProductionHistory: true })))
  );

  server.post('/api/device/v1/voice-audio', { bodyLimit: 768 * 1024 }, async (request) => replayDeviceVoice(request, async () => {
    const { deviceId } = DeviceIdQuerySchema.parse(request.body);
    const result = await runVoicePipeline({
      ...(request.body as Record<string, unknown>),
      inputSource: 'DEVICE_AUDIO',
      applyToDevice: true
    }, { recordProductionHistory: true });
    return ok(request, { ...result, volumePercent: await getDeviceVolume(deviceId) });
  }));

  server.post('/api/device/v1/voice-pcm', { bodyLimit: DEVICE_PCM_BODY_LIMIT }, async (request) => replayDeviceVoice(request, async () => {
    const query = DevicePcmQuerySchema.parse(request.query);
    if (!Buffer.isBuffer(request.body)) {
      throw new ApiError(415, 'INVALID_AUDIO_CONTENT_TYPE', '设备音频必须以原始 PCM 请求体上传');
    }

    const testSessionId = readHeader(request, 'x-voice-test-session-id');
    const revisionHeader = readHeader(request, 'x-stm32-control-revision');
    const deviceControlRevision = revisionHeader === undefined ? undefined : Number(revisionHeader);
    const wav = wrapDevicePcmAsWav(request.body);
    const work = testSessionId ? beginVoiceTestWork(testSessionId) : null;
    try {
      const testSession = testSessionId
        ? await markVoiceTestProcessing(testSessionId, query.deviceId)
        : null;
      if (testSessionId) {
        await archiveVoiceTestPcm(testSessionId, wav);
      }
      const result = await runVoicePipeline({
        deviceId: query.deviceId,
        conversationId: testSession?.result?.conversationId,
        inputSource: 'DEVICE_AUDIO',
        audioBase64: wav.toString('base64'),
        mimeType: 'audio/wav',
        asrProviderId: testSession?.settings.asrProviderId ?? query.asrProviderId,
        providerId: testSession?.settings.llmProviderId ?? query.providerId,
        ttsProviderId: testSession?.settings.ttsProviderId ?? query.ttsProviderId,
        ttsVoice: testSession?.settings.ttsVoice,
        llmTemperature: testSession?.settings.llmTemperature,
        llmMaxOutputTokens: testSession?.settings.llmMaxOutputTokens,
        llmHistoryTurns: testSession?.settings.llmHistoryTurns,
        requireWakeWord: query.requireWakeWord,
        ciWakeAcknowledged: query.ciWake,
        deviceControlRevision,
        synthesizeSpeech: query.synthesizeSpeech,
        testMode: query.testMode,
        simulateOffline: 'MISS',
        applyToDevice: true
      }, { signal: work?.signal, recordProductionHistory: !testSessionId });
      if (testSessionId) await completeVoiceTest(testSessionId, result, Math.round(request.body.length / query.sampleRate / query.channels / 2 * 1000));
      return ok(request, { ...result, endSession: isConversationEnd(result.transcript || ''), volumePercent: await getDeviceVolume(query.deviceId) });
    } catch (error) {
      if (testSessionId) await failVoiceTest(testSessionId, error);
      throw error;
    } finally {
      work?.dispose();
    }
  }));

  server.get('/api/device/v1/voice-replies/:id/pcm', async (request, reply) => {
    const { id } = VoiceReplyParamsSchema.parse(request.params);
    const deviceId = readHeader(request, 'x-device-id');
    const pcm = getDeviceVoiceReplyPcm(id, deviceId);
    return reply
      .header('Cache-Control', 'private, no-store')
      .header('X-Audio-Sample-Rate', '16000')
      .header('X-Audio-Bits-Per-Sample', '16')
      .header('X-Audio-Channels', '1')
      .type('application/octet-stream')
      .send(pcm);
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
