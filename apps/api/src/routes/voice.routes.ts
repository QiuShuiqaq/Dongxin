import type { FastifyInstance } from "fastify";
import { z } from 'zod';
import { voiceConversations } from '../services/conversation.service.js';
import { appendVoiceHistoryTurn, listVoiceHistory } from '../repositories/voiceHistory.repository.js';
import { voiceHistoryBackend } from '../repositories/voiceHistory.repository.js';
import { listVoiceTestSessions } from '../repositories/voiceTest.repository.js';
import { DeviceVolumeSchema, getDeviceVolume, saveDeviceVolume } from '../repositories/deviceVolume.repository.js';
import { handleVoiceTurn } from "../services/voice.service.js";
import {
  runVoicePipeline,
  runVoicePipelineBatch,
} from "../services/voicePipeline.service.js";

export async function registerVoiceRoutes(
  server: FastifyInstance,
): Promise<void> {
  server.get('/api/development/voice-volume/:deviceId', async (request) => {
    const { deviceId } = z.object({ deviceId: z.string().min(1) }).parse(request.params);
    return { deviceId, volumePercent: await getDeviceVolume(deviceId) };
  });
  server.put('/api/development/voice-volume/:deviceId', async (request) => {
    const { deviceId } = z.object({ deviceId: z.string().min(1) }).parse(request.params);
    const { volumePercent } = z.object({ volumePercent: DeviceVolumeSchema }).parse(request.body);
    return { deviceId, volumePercent: await saveDeviceVolume(deviceId, volumePercent) };
  });
  server.get('/api/development/voice-history', async (request) => {
    const { deviceId, limit, offset } = z.object({
      deviceId: z.string().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).max(100000).default(0),
    }).parse(request.query);
    if (voiceHistoryBackend() === 'postgres') return listVoiceHistory(deviceId, limit, offset);
    const [textSessions, deviceSessions] = await Promise.all([
      listVoiceHistory(deviceId, offset + limit), listVoiceTestSessions(),
    ]);
    const realSessions = deviceSessions
      .filter((session) => !deviceId || session.deviceId === deviceId)
      .map((session) => ({
        id: session.id,
        deviceId: session.deviceId,
        channel: session.mode === 'ASR_ONLY' ? 'asr-test' as const : 'device-test' as const,
        createdAt: session.requestedAt,
        updatedAt: session.updatedAt,
        turns: (session.turns.length ? session.turns : session.result ? [{ id: session.result.sessionId, at: session.completedAt || session.updatedAt, result: session.result }] : []).map((turn) => ({
          id: turn.id,
          at: turn.at,
          text: turn.result.transcript || '',
          reply: session.mode === 'ASR_ONLY' ? '' : turn.result.replyText,
          route: turn.result.route,
          error: null,
          latencyMs: turn.result.totalLatencyMs,
          costCny: turn.result.cost.totalCny,
        })),
        status: session.status,
      }));
    return [...textSessions, ...realSessions]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(offset, offset + limit);
  });
  server.post('/api/voice/conversations/reset', async (request) => {
    const scope = z.object({ deviceId: z.string().min(1), channel: z.enum(['pipeline', 'llm-test']) }).parse(request.body);
    voiceConversations.reset(scope);
    return { reset: true };
  });
  server.post("/api/voice/turn", async (request) =>
    handleVoiceTurn(request.body),
  );
  server.post("/api/voice/pipeline/test", async (request) => {
    const result = await runVoicePipeline(request.body);
    const deviceId = z.object({ deviceId: z.string().min(1) }).parse(request.body).deviceId;
    if (result.conversationId) {
      await appendVoiceHistoryTurn({
        conversationId: result.conversationId,
        deviceId,
        channel: 'pipeline',
        turn: {
          text: result.transcript ?? '',
          reply: result.replyText,
          route: result.route,
          error: result.stages.find((stage) => stage.status === 'FAILED')?.error ?? null,
          latencyMs: result.totalLatencyMs,
          costCny: result.cost.totalCny,
        },
      });
    }
    return result;
  });
  server.post("/api/voice/pipeline/batch", async (request) =>
    runVoicePipelineBatch(request.body),
  );
}
