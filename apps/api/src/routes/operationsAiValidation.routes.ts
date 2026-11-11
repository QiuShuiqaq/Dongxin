import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../http/apiError.js';
import {
  cancelBatchTest,
  exportBatchTestRun,
  getBatchTestRun,
  listBatchTestRuns,
  startBatchTest,
} from '../services/aiTesting.service.js';
import { requireOperationsRole } from '../services/operationsAuth.service.js';
import { listTestSetSummaries } from '../services/testSet.service.js';
import { runLlmModuleTest, runVoicePipeline } from '../services/voicePipeline.service.js';
import { appendLog } from '../services/log.service.js';

const previewSchema = z.object({
  text: z.string().trim().min(1).max(500),
  providerId: z.string().min(1),
  deviceId: z.string().min(1).optional(),
  mode: z.enum(['PIPELINE', 'LLM']).default('PIPELINE'),
});
const batchSchema = z.object({
  name: z.string().trim().min(1).max(100),
  providerId: z.string().min(1),
  testSetId: z.string().min(1),
  deviceId: z.string().min(1).optional(),
  maxCases: z.number().int().min(1).max(50),
  mode: z.enum(['PIPELINE', 'LLM']).default('PIPELINE'),
});
const idSchema = z.object({ id: z.string().uuid() });

export async function registerOperationsAiValidationRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/operations/ai-validation/test-sets', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    return listTestSetSummaries();
  });

  // Both modes are text-only: no device command, audio generation or playback.
  server.post('/api/operations/ai-validation/preview', async (request) => {
    const actor = requireOperationsRole(request.headers.authorization, ['ADMIN']);
    const body = previewSchema.parse(request.body);
    const deviceId = body.deviceId ?? 'DX-OPS-TEST';
    try {
      const result = body.mode === 'PIPELINE'
        ? await runVoicePipeline({
            deviceId, inputSource: 'TEXT_SIMULATION', text: body.text,
            providerId: body.providerId, applyToDevice: false,
            synthesizeSpeech: false, simulateOffline: 'MISS', requireWakeWord: false,
          })
        : await runLlmModuleTest({ text: body.text, providerId: body.providerId, deviceId });
      const costCny = 'cost' in result ? result.cost.totalCny : result.usage.costCny ?? 0;
      const latencyMs = 'totalLatencyMs' in result ? result.totalLatencyMs : result.latencyMs;
      const inputTokens = 'cost' in result ? result.cost.inputTokens : result.usage.inputTokens;
      const outputTokens = 'cost' in result ? result.cost.outputTokens : result.usage.outputTokens;
      const failed = 'stages' in result
        ? result.stages.some((stage) => stage.status === 'FAILED') : Boolean(result.error);
      const auditRecorded = await appendLog({ type: 'AI', summary: '运营单条 AI 验证', payload: {
        actor: actor.username, mode: body.mode, inputText: body.text, providerId: body.providerId, deviceId,
        resultType: result.aiResult.resultType, intent: result.aiResult.intent,
        safetyDecision: result.safetyResult.decision, latencyMs,
        inputTokens, outputTokens, costCny,
        route: 'route' in result ? result.route : 'LLM_ONLY',
        status: failed ? 'FAILED' : 'COMPLETED',
        deviceCommandDispatched: false,
      } }).then(() => true).catch((error) => { request.log.error(error, 'AI preview audit failed'); return false; });
      return { ...result, mode: body.mode, deviceCommandDispatched: false, auditRecorded };
    } catch (error) {
      await appendLog({ type: 'AI', summary: '运营单条 AI 验证失败', payload: {
        actor: actor.username, mode: body.mode, inputText: body.text, providerId: body.providerId, deviceId,
        status: 'FAILED', deviceCommandDispatched: false,
      } }).catch((auditError) => request.log.error(auditError, 'AI preview failure audit failed'));
      throw error;
    }
  });

  server.get('/api/operations/ai-validation/runs', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    return (await listBatchTestRuns()).filter((run) => run.kind === 'LLM' || run.kind === 'PIPELINE');
  });
  server.get('/api/operations/ai-validation/runs/:id', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    const run = await getBatchTestRun(idSchema.parse(request.params).id);
    if (run.kind !== 'LLM' && run.kind !== 'PIPELINE') throw new ApiError(404, 'BATCH_RUN_NOT_FOUND', '批量任务不存在');
    return run;
  });
  server.post('/api/operations/ai-validation/runs', async (request) => {
    const actor = requireOperationsRole(request.headers.authorization, ['ADMIN']);
    const body = batchSchema.parse(request.body);
    const { mode, ...options } = body;
    const run = await startBatchTest({ ...options, kind: mode, repeatCount: 1, caseIds: [] });
    const auditRecorded = await appendLog({ type: 'AI', summary: '运营批量 AI 验证已启动', payload: {
      actor: actor.username, mode, runId: run.id, providerId: body.providerId,
      testSetId: body.testSetId, maxCases: body.maxCases,
    } }).then(() => true).catch((error) => { request.log.error(error, 'AI batch audit failed'); return false; });
    return { ...run, auditRecorded };
  });
  server.post('/api/operations/ai-validation/runs/:id/cancel', async (request) => {
    const actor = requireOperationsRole(request.headers.authorization, ['ADMIN']);
    const run = await getBatchTestRun(idSchema.parse(request.params).id);
    if (run.kind !== 'LLM' && run.kind !== 'PIPELINE') throw new ApiError(404, 'BATCH_RUN_NOT_FOUND', '批量任务不存在');
    const cancelled = await cancelBatchTest(run.id);
    await appendLog({ type: 'AI', summary: '运营批量 AI 验证已停止', payload: {
      actor: actor.username, runId: run.id,
    } }).catch((error) => request.log.error(error, 'AI batch cancellation audit failed'));
    return cancelled;
  });
  server.get('/api/operations/ai-validation/runs/:id/export', async (request, reply) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    const run = await getBatchTestRun(idSchema.parse(request.params).id);
    if (run.kind !== 'LLM' && run.kind !== 'PIPELINE') throw new ApiError(404, 'BATCH_RUN_NOT_FOUND', '批量任务不存在');
    const exported = await exportBatchTestRun(run.id, 'csv');
    return reply
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(exported.fileName)}`)
      .type(exported.contentType)
      .send(exported.body);
  });
}
