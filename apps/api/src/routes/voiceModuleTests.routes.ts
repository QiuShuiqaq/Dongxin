import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { appendVoiceHistoryTurn } from '../repositories/voiceHistory.repository.js';
import {
  getAudioTest,
  getAudioTestPcm,
  stopAudioTest,
  testLlm,
  testTts,
} from "../services/voiceModuleTest.service.js";

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function registerVoiceModuleTestRoutes(server: FastifyInstance): Promise<void> {
  server.post("/api/development/module-tests/llm", async (request) => {
    const result = await testLlm(request.body);
    const deviceId = z.object({ deviceId: z.string().min(1) }).parse(request.body).deviceId;
    if (result.conversationId) {
      await appendVoiceHistoryTurn({
        conversationId: result.conversationId,
        deviceId,
        channel: 'llm-test',
        turn: {
          text: result.inputText,
          reply: result.aiResult.speak,
          route: 'LLM',
          error: result.error,
          latencyMs: result.latencyMs,
          costCny: result.usage.costCny ?? null,
        },
      });
    }
    return result;
  });
  server.post("/api/development/module-tests/tts", async (request) => testTts(request.body));
  server.get("/api/development/audio-tests/:id", async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    return getAudioTest(id);
  });
  server.post("/api/development/audio-tests/:id/stop", async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    return stopAudioTest(id);
  });
  server.get("/api/device/v1/audio-tests/:id/pcm", async (request, reply) => {
    const { id } = ParamsSchema.parse(request.params);
    const deviceId = request.headers['x-device-id'];
    const pcm = getAudioTestPcm(id, typeof deviceId === 'string' ? deviceId : undefined);
    return reply
      .header('Cache-Control', 'private, no-store')
      .header("X-Audio-Sample-Rate", "16000")
      .header("X-Audio-Bits-Per-Sample", "16")
      .header("X-Audio-Channels", "1")
      .type("application/octet-stream")
      .send(pcm);
  });
}
