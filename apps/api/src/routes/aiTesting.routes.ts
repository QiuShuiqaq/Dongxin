import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  addAsrDatasetItem,
  cancelBatchTest,
  createAsrDataset,
  deleteAsrDataset,
  deleteBatchTestRun,
  diagnoseProvider,
  exportBatchTestRun,
  getAiServiceConfiguration,
  getBatchTestRun,
  getTestArtifact,
  listAsrDatasets,
  listBatchTestRuns,
  retryFailedBatchTest,
  setDefaultProvider,
  startBatchTest,
} from "../services/aiTesting.service.js";

const IdParamsSchema = z.object({ id: z.string().uuid() });
const ServiceParamsSchema = z.object({ serviceType: z.enum(["LLM", "ASR", "TTS"]) });
const ExportParamsSchema = z.object({ id: z.string().uuid(), format: z.enum(["json", "csv", "html"]) });
const ArtifactParamsSchema = z.object({ path: z.string().min(1) });

export async function registerAiTestingRoutes(server: FastifyInstance): Promise<void> {
  server.get("/api/development/ai-services", async () => getAiServiceConfiguration());
  server.put("/api/development/ai-services/defaults/:serviceType", async (request) => {
    const { serviceType } = ServiceParamsSchema.parse(request.params);
    return setDefaultProvider(serviceType, request.body);
  });
  server.post("/api/development/ai-services/diagnose", async (request) =>
    diagnoseProvider(request.body),
  );

  server.get("/api/development/asr-datasets", async () => listAsrDatasets());
  server.post("/api/development/asr-datasets", async (request) => createAsrDataset(request.body));
  server.post("/api/development/asr-datasets/:id/items", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    return addAsrDatasetItem(id, request.body);
  });
  server.delete("/api/development/asr-datasets/:id", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    await deleteAsrDataset(id);
    return { success: true };
  });

  server.get("/api/development/batch-tests", async () => listBatchTestRuns());
  server.post("/api/development/batch-tests", async (request) => startBatchTest(request.body));
  server.get("/api/development/batch-tests/:id", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    return getBatchTestRun(id);
  });
  server.delete("/api/development/batch-tests/:id", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    await deleteBatchTestRun(id);
    return { success: true };
  });
  server.post("/api/development/batch-tests/:id/cancel", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    return cancelBatchTest(id);
  });
  server.post("/api/development/batch-tests/:id/retry", async (request) => {
    const { id } = IdParamsSchema.parse(request.params);
    return retryFailedBatchTest(id);
  });
  server.get("/api/development/batch-tests/:id/export/:format", async (request, reply) => {
    const { id, format } = ExportParamsSchema.parse(request.params);
    const exported = await exportBatchTestRun(id, format);
    return reply
      .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(exported.fileName)}`)
      .type(exported.contentType)
      .send(exported.body);
  });
  server.get("/api/development/test-artifacts/:path", async (request, reply) => {
    const { path } = ArtifactParamsSchema.parse(request.params);
    const artifact = await getTestArtifact(path);
    return reply.type(artifact.mimeType).send(artifact.data);
  });
}
