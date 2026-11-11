import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { BatchTestRun } from '@dongxin/shared';

const replace = (path: string, namedExports: Record<string, unknown>) =>
  mock.module(new URL(path, import.meta.url).href, { namedExports });

const runs = new Map<string, BatchTestRun>();
const pipelineCalls: unknown[] = [];
const provider = { id: 'fixture-llm', name: 'Fixture LLM', serviceType: 'LLM', enabled: true };
replace('../repositories/aiTesting.repository.js', {
  saveBatchRun: async (run: BatchTestRun) => { runs.set(run.id, run); return run; },
  listBatchRuns: async () => [...runs.values()],
});
replace('./provider.service.js', {
  listProviders: async () => [provider],
  findProviderForService: (_providers: unknown, id: string, type: string) => {
    assert.equal(id, provider.id);
    assert.equal(type, 'LLM');
    return provider;
  },
  findProvider: () => provider,
  getDefaultProviderForService: async () => provider,
  listProviderSecretStatuses: async () => [],
  selectDefaultProvider: () => provider,
});
replace('./testSet.service.js', {
  getTestSet: async () => ({
    id: 'fixture-set', name: '测试集', cases: [{
      id: 'light-on', category: 'control', inputText: '打开照明',
      expectedIntent: 'LIGHT_ON', expectedResultType: 'DEVICE_CONTROL',
      expectedSlots: {}, expectedSafetyDecision: 'APPROVED',
      requiredKeywords: [], forbiddenKeywords: [], allowDeviceAction: true,
      riskLevel: 'LOW',
    }],
  }),
});
replace('./voicePipeline.service.js', {
  runLlmModuleTest: async () => { throw new Error('LLM-only path must not run'); },
  runVoicePipeline: async (input: unknown) => {
    pipelineCalls.push(input);
    return {
      aiResult: { resultType: 'DEVICE_CONTROL', intent: 'LIGHT_ON', speak: '已打开照明', slots: {} },
      safetyResult: { decision: 'APPROVED', commands: ['LIGHT_ON'] },
      stages: [], route: 'ONLINE_RULE', replyText: '已打开照明',
      totalLatencyMs: 12, cost: { totalCny: 0 }, commandRecord: null,
    };
  },
});

const { startBatchTest, getBatchTestRun } = await import('./aiTesting.service.js');

test('pipeline batch evaluates a text case without device dispatch or audio generation', async () => {
  runs.clear();
  pipelineCalls.length = 0;
  const queued = await startBatchTest({
    name: '完整链路', kind: 'PIPELINE', providerId: provider.id,
    testSetId: 'fixture-set', deviceId: 'DX-OPS-TEST', maxCases: 1,
  });
  let finished = await getBatchTestRun(queued.id);
  for (let attempt = 0; attempt < 50 && ['QUEUED', 'RUNNING'].includes(finished.status); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    finished = await getBatchTestRun(queued.id);
  }
  assert.equal(finished.status, 'COMPLETED');
  assert.equal(finished.summary.passed, 1);
  assert.equal(finished.items[0].actualIntent, 'LIGHT_ON');
  assert.deepEqual(pipelineCalls, [{
    deviceId: 'DX-OPS-TEST', inputSource: 'TEXT_SIMULATION',
    text: '打开照明', providerId: provider.id, applyToDevice: false,
    synthesizeSpeech: false, simulateOffline: 'MISS', requireWakeWord: false,
  }]);
});
