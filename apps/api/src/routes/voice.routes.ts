import type { FastifyInstance } from "fastify";
import { handleVoiceTurn } from "../services/voice.service.js";
import {
  runVoicePipeline,
  runVoicePipelineBatch,
} from "../services/voicePipeline.service.js";

export async function registerVoiceRoutes(
  server: FastifyInstance,
): Promise<void> {
  server.post("/api/voice/turn", async (request) =>
    handleVoiceTurn(request.body),
  );
  server.post("/api/voice/pipeline/test", async (request) =>
    runVoicePipeline(request.body),
  );
  server.post("/api/voice/pipeline/batch", async (request) =>
    runVoicePipelineBatch(request.body),
  );
}
