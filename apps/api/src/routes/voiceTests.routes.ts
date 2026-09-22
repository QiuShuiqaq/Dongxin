import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getVoiceTestSession,
  getVoiceTestSessions,
  startVoiceTest,
  stopVoiceTest,
} from "../services/voiceTest.service.js";

const SessionParamsSchema = z.object({ id: z.string().uuid() });
const SessionQuerySchema = z.object({ deviceId: z.string().min(1).optional() });

export async function registerVoiceTestRoutes(server: FastifyInstance): Promise<void> {
  server.post("/api/development/voice-tests", async (request) =>
    startVoiceTest(request.body)
  );
  server.post("/api/development/voice-tests/:id/stop", async (request) => {
    const { id } = SessionParamsSchema.parse(request.params);
    return stopVoiceTest(id);
  });
  server.get("/api/development/voice-tests/:id", async (request) => {
    const { id } = SessionParamsSchema.parse(request.params);
    return getVoiceTestSession(id);
  });
  server.get("/api/development/voice-tests", async (request) => {
    const { deviceId } = SessionQuerySchema.parse(request.query);
    return getVoiceTestSessions(deviceId);
  });
}
