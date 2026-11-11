import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import Fastify from 'fastify';
import { ApiError } from '../http/apiError.js';

let previewCalls = 0;
let batchCalls: unknown[] = [];
let pipelineCalls: unknown[] = [];
const replace = (path: string, namedExports: Record<string, unknown>) =>
  mock.module(new URL(path, import.meta.url).href, { namedExports });

replace('../services/operationsAuth.service.js', {
  requireOperationsRole: (authorization: string | undefined, roles: string[]) => {
    const role = authorization === 'admin' ? 'ADMIN' : authorization === 'viewer' ? 'REVIEWER' : null;
    if (!role || !roles.includes(role)) throw new ApiError(403, 'FORBIDDEN', '无权限');
    return { username: role.toLowerCase(), role };
  },
});
replace('../services/aiTesting.service.js', {
  cancelBatchTest: async () => ({ id: 'fixture', status: 'CANCELLED' }),
  exportBatchTestRun: async () => ({ fileName: 'fixture.csv', contentType: 'text/csv', body: 'test' }),
  getBatchTestRun: async () => ({ id: 'fixture', kind: 'LLM', status: 'COMPLETED' }),
  listBatchTestRuns: async () => [],
  startBatchTest: async (input: { kind: string }) => { batchCalls.push(input); return { id: 'fixture', kind: input.kind, status: 'QUEUED' }; },
});
replace('../services/testSet.service.js', { listTestSetSummaries: async () => [{ id: 'standard', name: '标准测试集' }] });
replace('../services/log.service.js', { appendLog: async () => ({ id: 'audit-fixture' }) });
replace('../services/voicePipeline.service.js', {
  runVoicePipeline: async (input: unknown) => {
    pipelineCalls.push(input);
    return { aiResult: { resultType: 'DEVICE_CONTROL', intent: 'LIGHT_ON', speak: '测试' }, safetyResult: { decision: 'APPROVED', commands: [] }, stages: [], totalLatencyMs: 10, cost: { totalCny: 0 }, route: 'ONLINE_RULE', replyText: '测试', commandRecord: null };
  },
  runLlmModuleTest: async () => {
    previewCalls++;
    return { aiResult: { resultType: 'DEVICE_CONTROL', intent: 'LIGHT_ON', speak: '测试' }, safetyResult: { decision: 'APPROVED', commands: [] }, latencyMs: 10, usage: { costCny: 0.01 }, error: null };
  },
});

const { registerOperationsAiValidationRoutes } = await import('./operationsAiValidation.routes.js');

test('operations preview defaults to a safe full-pipeline text preview', async () => {
  const server = Fastify();
  await server.register(registerOperationsAiValidationRoutes);
  try {
    previewCalls = 0;
    pipelineCalls = [];
    const denied = await server.inject({ method: 'POST', url: '/api/operations/ai-validation/preview', headers: { authorization: 'viewer' }, payload: { text: '开灯', providerId: 'llm' } });
    assert.equal(denied.statusCode, 403);
    assert.equal(previewCalls, 0);
    assert.equal(pipelineCalls.length, 0);
    const allowed = await server.inject({ method: 'POST', url: '/api/operations/ai-validation/preview', headers: { authorization: 'admin' }, payload: { text: '开灯', providerId: 'llm', applyToDevice: true, synthesizeSpeech: true } });
    assert.equal(allowed.statusCode, 200);
    assert.equal(previewCalls, 0);
    assert.deepEqual(pipelineCalls, [{ deviceId: 'DX-OPS-TEST', inputSource: 'TEXT_SIMULATION', text: '开灯', providerId: 'llm', applyToDevice: false, synthesizeSpeech: false, simulateOffline: 'MISS', requireWakeWord: false }]);
    assert.equal(allowed.json().deviceCommandDispatched, false);
    assert.equal(allowed.json().auditRecorded, true);
    assert.equal(allowed.json().mode, 'PIPELINE');
    const llm = await server.inject({ method: 'POST', url: '/api/operations/ai-validation/preview', headers: { authorization: 'admin' }, payload: { text: '开灯', providerId: 'llm', mode: 'LLM' } });
    assert.equal(llm.statusCode, 200);
    assert.equal(previewCalls, 1);
  } finally { await server.close(); }
});

test('operations batch defaults to full pipeline and bounds a paid task to 50 cases', async () => {
  const server = Fastify();
  await server.register(registerOperationsAiValidationRoutes);
  try {
    batchCalls = [];
    const path = '/api/operations/ai-validation/runs';
    const body = { name: '合同测试', providerId: 'llm', testSetId: 'standard', maxCases: 50 };
    assert.equal((await server.inject({ method: 'POST', url: path, headers: { authorization: 'viewer' }, payload: body })).statusCode, 403);
    assert.equal(batchCalls.length, 0);
    assert.notEqual((await server.inject({ method: 'POST', url: path, headers: { authorization: 'admin' }, payload: { ...body, maxCases: 51 } })).statusCode, 200);
    assert.equal(batchCalls.length, 0);
    assert.equal((await server.inject({ method: 'POST', url: path, headers: { authorization: 'admin' }, payload: body })).statusCode, 200);
    assert.deepEqual(batchCalls, [{ ...body, kind: 'PIPELINE', repeatCount: 1, caseIds: [] }]);
    assert.equal((await server.inject({ method: 'POST', url: path, headers: { authorization: 'admin' }, payload: { ...body, mode: 'LLM' } })).statusCode, 200);
    assert.deepEqual(batchCalls[1], { ...body, kind: 'LLM', repeatCount: 1, caseIds: [] });
  } finally { await server.close(); }
});
