import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { diagnoseProvider, setDefaultProvider } from '../services/aiTesting.service.js';
import { auditAiChange } from '../services/operationsAiAudit.service.js';
import {
  bootstrapSpeechProviders,
  getOperationsAiServices,
  listOperationsTtsVoices,
  previewOperationsTts,
  saveOperationsTtsVoice,
} from '../services/operationsAiServices.service.js';
import { requireOperationsRole } from '../services/operationsAuth.service.js';
import { transcribeAudio } from '../services/speech.service.js';
import { ApiError } from '../http/apiError.js';

const serviceParamsSchema = z.object({ serviceType: z.enum(['ASR', 'LLM', 'TTS']) });
const defaultBodySchema = z.object({ providerId: z.string().min(1) });
const diagnoseBodySchema = z.object({ providerId: z.string().min(1) });
const asrPreviewBodySchema = z.object({
  providerId: z.string().min(1).optional(),
  audioBase64: z.string().min(4).max(2_796_204).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  audioMimeType: z.string().regex(/^audio\/(?:wav|webm|mpeg|mp4|ogg|aac|flac)(?:;codecs=[A-Za-z0-9.,_-]+)?$/i),
}).strict();

export async function registerOperationsAiServicesRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/operations/ai-services', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    return getOperationsAiServices();
  });
  server.get('/api/operations/ai-services/tts-voices', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    return listOperationsTtsVoices(request.query);
  });
  server.post('/api/operations/ai-services/bootstrap-speech', async (request) => {
    const actor = requireOperationsRole(request.headers.authorization, ['ADMIN']);
    const result = await bootstrapSpeechProviders();
    await auditAiChange(request, actor.username, '初始化语音模型', { created: result.created });
    return result;
  });
  server.put('/api/operations/ai-services/defaults/:serviceType', async (request) => {
    const actor = requireOperationsRole(request.headers.authorization, ['ADMIN']);
    const { serviceType } = serviceParamsSchema.parse(request.params);
    const { providerId } = defaultBodySchema.parse(request.body);
    const result = await setDefaultProvider(serviceType, { providerId });
    await auditAiChange(request, actor.username, '切换默认模型', { serviceType, providerId });
    return result;
  });
  server.patch('/api/operations/ai-services/tts-voice', async (request) => {
    const actor = requireOperationsRole(request.headers.authorization, ['ADMIN']);
    const result = await saveOperationsTtsVoice(request.body);
    await auditAiChange(request, actor.username, '切换 TTS 音色', result);
    return result;
  });
  server.post('/api/operations/ai-services/diagnose', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN']);
    const body = diagnoseBodySchema.parse(request.body);
    const { error, ...result } = await diagnoseProvider(body);
    return { ...result, error: error ? '服务测试失败，请检查服务商配置和服务器日志' : null };
  });
  server.post('/api/operations/ai-services/tts-preview', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN']);
    return previewOperationsTts(request.body);
  });
  server.post('/api/operations/ai-services/asr-preview', { bodyLimit: 3 * 1024 * 1024 }, async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN']);
    const body = asrPreviewBodySchema.parse(request.body);
    if (Buffer.from(body.audioBase64, 'base64').byteLength > 2 * 1024 * 1024) {
      throw new ApiError(413, 'ASR_AUDIO_TOO_LARGE', 'ASR 试听音频不能超过 2 MB');
    }
    const result = await transcribeAudio({
      providerId: body.providerId,
      audioBase64: body.audioBase64,
      mimeType: body.audioMimeType.split(';', 1)[0].toLowerCase(),
    });
    if (result.status !== 'COMPLETED' || !result.text) {
      throw new ApiError(502, 'ASR_PREVIEW_FAILED', 'ASR 试听失败，请检查模型配置和音频格式');
    }
    return {
      providerId: result.providerId,
      transcript: result.text,
      latencyMs: result.latencyMs,
      costCny: result.costCny,
      isEstimated: result.isEstimated,
    };
  });
}
