import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { csvLine, parseArguments, parseDataset, runEvaluation } from './run-llm-evaluation.mjs';
import { summarizeEvaluation } from './summarize-llm-evaluation.mjs';

const prompt = { id: 'fixture-prompt', version: 3, status: 'ACTIVE', systemPrompt: 'Fixture prompt' };
const provider = { id: 'fixture-llm', name: 'Fixture LLM', model: 'fixture-model', type: 'OPENAI_COMPATIBLE',
  serviceType: 'LLM', enabled: true, inputPricePerMTokens: 0.2, outputPricePerMTokens: 0.8, maxOutputTokens: 512 };
const cases = [
  { id: 'C001', category: 'control', tags: ['first'], turns: [{ inputText: '=开灯',
    expected: { resultTypes: ['DEVICE_CONTROL'], intent: 'LIGHT_ON', actionProposal: true } }] },
  { id: 'C002', category: 'multi_turn', turns: [
    { inputText: '我的名字是小林', expected: { resultTypes: ['CHAT'], intent: null, actionProposal: false } },
    { inputText: '我叫什么', expected: { resultTypes: ['CHAT'], intent: null, actionProposal: false } },
  ] },
];

function fixtureFetch({ missingUsage = false, callBodies = [], badConversationId = false,
  modelProvider = provider, modelErrorOnText = null, modelErrorMessage = 'Fixture model format error' } = {}) {
  const paths = [];
  const conversationId = randomUUID();
  const fetchImpl = async (rawUrl, options = {}) => {
    const url = new URL(rawUrl);
    paths.push(url.pathname);
    if (url.pathname === '/api/development/ai-services') return Response.json({
      defaults: { LLM: modelProvider.id }, providers: [modelProvider], secrets: [{ providerId: modelProvider.id, isConfigured: true }],
    });
    if (url.pathname === '/api/prompts') return Response.json([prompt]);
    assert.equal(url.pathname, '/api/development/llm-evaluation');
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    callBodies.push(body);
    assert.match(body.deviceId, /^DX-EVAL-[0-9a-f-]{36}$/);
    assert.deepEqual(body.deviceStatePatch, { isOnline: true, faultCode: null });
    assert.equal(body.promptId, prompt.id);
    const isControl = body.text === '=开灯';
    const aiResult = { resultType: isControl ? 'DEVICE_CONTROL' : 'CHAT',
      intent: isControl ? 'LIGHT_ON' : null, confidence: 0.95, slots: {}, requiresConfirm: false,
      speak: isControl ? '好的，准备打开照明。' : '我记得你叫小林。' };
    return Response.json({ providerId: provider.id, promptId: prompt.id, promptVersion: prompt.version,
      conversationId: badConversationId ? 'not-uuid' : conversationId,
      aiResult, rawResponse: aiResult, evaluatedDeviceState: { isOnline: true, faultCode: null },
      safetyResult: { decision: isControl ? 'APPROVED' : 'NO_ACTION', commands: isControl ? ['LIGHT_ON'] : [] },
      usage: { inputTokens: 100, outputTokens: 30, costCny: missingUsage ? null : 0.001, isEstimated: false },
      latencyMs: 12, error: body.text === modelErrorOnText ? modelErrorMessage : null });
  };
  return { fetchImpl, paths, callBodies };
}

async function withDataset(callback, items = cases) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dongxin-llm-eval-'));
  const datasetPath = path.join(root, 'cases.jsonl');
  await writeFile(datasetPath, items.map((item) => JSON.stringify(item)).join('\n') + '\n', 'utf8');
  try { await callback({ root, datasetPath }); }
  finally { await rm(root, { recursive: true, force: true }); }
}

function options(root, datasetPath, extra = []) {
  return parseArguments(['--dataset', datasetPath, '--output-root', root, '--execute',
    ...(!extra.includes('--max-calls') ? ['--max-calls', '3'] : []),
    ...(!extra.includes('--max-cost-cny') ? ['--max-cost-cny', '1'] : []),
    '--interval-ms', '0', ...extra]);
}

test('dataset validation and dry-run never call the model or create a batch', async () => {
  await withDataset(async ({ root, datasetPath }) => {
    const parsed = parseDataset(await readFile(datasetPath, 'utf8'));
    assert.equal(parsed.length, 2);
    const preview = await runEvaluation(parseArguments(['--dataset', datasetPath, '--output-root', root]), {
      fetchImpl: async () => { throw new Error('Network call during dry-run'); },
    });
    assert.equal(preview.plannedCalls, 3);
    assert.equal(preview.dryRun, true);
    assert.equal(preview.datasetSha256, createHash('sha256').update(await readFile(datasetPath)).digest('hex'));
    assert.throws(() => parseArguments(['--dataset', datasetPath, '--execute', '--max-calls', '5', '--max-cost-cny', '51']));
    assert.throws(() => parseArguments(['--dataset', datasetPath, '--execute', '--max-calls', '5', '--max-cost-cny', '1', '--max-output-tokens', '1']));
    assert.throws(() => parseArguments(['--dataset', datasetPath, '--base-url', 'http://example.com']));
  });
});

test('pause at case boundary, resume without re-running completed case, preserve multi-turn context', async () => {
  await withDataset(async ({ root, datasetPath }) => {
    const mock = fixtureFetch();
    const first = await runEvaluation(options(root, datasetPath, ['--stop-after-calls', '1']), { fetchImpl: mock.fetchImpl });
    assert.equal(first.status, 'PAUSED_FOR_REVIEW');
    assert.equal(first.callsMade, 1);
    const second = await runEvaluation({ ...options(root, datasetPath), resumePath: first.runDir }, { fetchImpl: mock.fetchImpl });
    assert.equal(second.status, 'COMPLETE');
    assert.equal(second.callsMade, 3);
    assert.equal(mock.callBodies.length, 3);
    assert.equal(mock.callBodies[0].conversationId, undefined);
    assert.equal(mock.callBodies[1].conversationId, undefined);
    assert.match(mock.callBodies[2].conversationId, /^[0-9a-f-]{36}$/);
    assert.ok(mock.paths.every((entry) => ['/api/development/ai-services', '/api/prompts', '/api/development/llm-evaluation'].includes(entry)));
    const records = (await readFile(path.join(first.runDir, 'results.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(records.filter((item) => item.type === 'call_reserved').length, 3);
    assert.equal(records.filter((item) => item.type === 'turn').length, 3);
    assert.equal(records.filter((item) => item.type === 'case_completed').length, 2);
    assert.equal(records.find((item) => item.type === 'turn').evaluation.status, 'PASS');
    assert.ok(records.filter((item) => item.type === 'turn').every((item) => item.deviceControlDispatched === false && item.audioGenerated === false));
    const csv = await readFile(path.join(first.runDir, 'results.csv'), 'utf8');
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.match(csv, /'=开灯/);
    const manifest = JSON.parse(await readFile(path.join(first.runDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.promptSha256, createHash('sha256').update(prompt.systemPrompt).digest('hex'));
    assert.equal(manifest.completedCases, 2);
  });
});

test('missing reported usage spends the full reservation and stops before budget overrun', async () => {
  await withDataset(async ({ root, datasetPath }) => {
    const mock = fixtureFetch({ missingUsage: true });
    const result = await runEvaluation(options(root, datasetPath, ['--max-cost-cny', '0.05']), { fetchImpl: mock.fetchImpl });
    assert.equal(result.status, 'COST_LIMIT');
    assert.equal(result.callsMade, 1);
    assert.equal(mock.callBodies.length, 1);
    assert.ok(result.accountedCostCny > 0.03 && result.accountedCostCny < 0.05);
    const turn = (await readFile(path.join(result.runDir, 'results.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
      .find((item) => item.type === 'turn');
    assert.equal(turn.costCny, null);
    assert.ok(turn.accountedCostCny > 0);
  });
});

test('an unresolved pre-call reservation blocks automatic replay on resume', async () => {
  await withDataset(async ({ root, datasetPath }) => {
    const mock = fixtureFetch();
    const first = await runEvaluation(options(root, datasetPath, ['--stop-after-calls', '1']), { fetchImpl: mock.fetchImpl });
    const unresolved = { type: 'call_reserved', callId: randomUUID(), runId: randomUUID(),
      caseId: 'C002', attemptId: randomUUID(), repeat: 1, turnIndex: 1,
      inputText: '我的名字是小林', reservationCny: 0.0312, testedAt: new Date().toISOString() };
    await writeFile(path.join(first.runDir, 'results.jsonl'),
      (await readFile(path.join(first.runDir, 'results.jsonl'), 'utf8')) + JSON.stringify(unresolved) + '\n');
    await assert.rejects(runEvaluation({ ...options(root, datasetPath), resumePath: first.runDir }, { fetchImpl: mock.fetchImpl }),
      /may have been billed/);
    assert.equal(mock.callBodies.length, 1);
  });
});

test('resuming with changed provider pricing is rejected before a model request', async () => {
  await withDataset(async ({ root, datasetPath }) => {
    const firstMock = fixtureFetch();
    const first = await runEvaluation(options(root, datasetPath, ['--stop-after-calls', '1']), { fetchImpl: firstMock.fetchImpl });
    const changed = fixtureFetch({ modelProvider: { ...provider, inputPricePerMTokens: 0.1 } });
    await assert.rejects(runEvaluation({ ...options(root, datasetPath), resumePath: first.runDir }, { fetchImpl: changed.fetchImpl }),
      /provider pricing or reservation changed/);
    assert.equal(changed.callBodies.length, 0);
  });
});

test('invalid conversation ID is recorded as an error and does not silently flatten multi-turn dialogue', async () => {
  await withDataset(async ({ root, datasetPath }) => {
    const mock = fixtureFetch({ badConversationId: true });
    const result = await runEvaluation(options(root, datasetPath), { fetchImpl: mock.fetchImpl });
    assert.equal(result.status, 'ERROR');
    assert.equal(result.callsMade, 1);
    assert.equal(mock.callBodies.length, 1);
    const records = (await readFile(path.join(result.runDir, 'results.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.match(records.find((item) => item.type === 'turn').error, /conversationId/);
  });
});

test('a model-level error is recorded as a failed case while later cases continue', async () => {
  await withDataset(async ({ root, datasetPath }) => {
    const mock = fixtureFetch({ modelErrorOnText: '=开灯' });
    const result = await runEvaluation(options(root, datasetPath), { fetchImpl: mock.fetchImpl });
    assert.equal(result.status, 'COMPLETE');
    assert.equal(result.callsMade, 3);
    const records = (await readFile(path.join(result.runDir, 'results.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(records.find((item) => item.type === 'case_aborted' && item.caseId === 'C001').status, 'MODEL_ERROR');
    assert.equal(records.filter((item) => item.type === 'case_completed').length, 1);
    assert.equal(records.find((item) => item.type === 'turn' && item.caseId === 'C001').evaluation.status, 'ERROR');
  });
});

test('a non-retryable provider quota error stops after one failed case without replaying it', async () => {
  await withDataset(async ({ root, datasetPath }) => {
    const quotaError = 'Provider fixture-llm returned 403: ' + JSON.stringify({
      error: { code: 'AllocationQuota.FreeTierOnly', message: 'Free quota exhausted' },
    });
    const mock = fixtureFetch({ modelErrorOnText: cases[0].turns[0].inputText, modelErrorMessage: quotaError });
    const first = await runEvaluation(options(root, datasetPath), { fetchImpl: mock.fetchImpl });
    assert.equal(first.status, 'NON_RETRYABLE_QUOTA');
    assert.equal(first.callsMade, 1);
    assert.equal(mock.callBodies.length, 1);
    const records = (await readFile(path.join(first.runDir, 'results.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(records.filter((item) => item.type === 'case_aborted').length, 1);
    assert.equal(records.find((item) => item.type === 'case_aborted').caseId, 'C001');
    assert.equal(records.find((item) => item.type === 'case_aborted').status, 'MODEL_ERROR');
    const recovered = fixtureFetch({ callBodies: mock.callBodies });
    const resumed = await runEvaluation({ ...options(root, datasetPath), resumePath: first.runDir },
      { fetchImpl: recovered.fetchImpl });
    assert.equal(resumed.status, 'COMPLETE');
    assert.equal(resumed.callsMade, 3);
    assert.deepEqual(mock.callBodies.map((body) => body.text), [
      cases[0].turns[0].inputText, ...cases[1].turns.map((turn) => turn.inputText),
    ]);
  });
});

test('an unrelated 403 model error does not trigger the quota stop', async () => {
  await withDataset(async ({ root, datasetPath }) => {
    const mock = fixtureFetch({ modelErrorOnText: cases[0].turns[0].inputText,
      modelErrorMessage: 'Provider fixture-llm returned 403: ' + JSON.stringify({ error: { code: 'InvalidApiKey' } }) });
    const result = await runEvaluation(options(root, datasetPath), { fetchImpl: mock.fetchImpl });
    assert.equal(result.status, 'COMPLETE');
    assert.equal(result.callsMade, 3);
  });
});

test('a transient 429 quota error remains subject to the ordinary model-error threshold', async () => {
  await withDataset(async ({ root, datasetPath }) => {
    const mock = fixtureFetch({ modelErrorOnText: cases[0].turns[0].inputText,
      modelErrorMessage: 'Provider fixture-llm returned 429: ' + JSON.stringify({ error: { code: 'RateLimitExceeded' } }) });
    const result = await runEvaluation(options(root, datasetPath), { fetchImpl: mock.fetchImpl });
    assert.equal(result.status, 'COMPLETE');
    assert.equal(result.callsMade, 3);
  });
});

test('a multi-turn model error aborts the case and resume does not replay billed turns', async () => {
  await withDataset(async ({ root, datasetPath }) => {
    const mock = fixtureFetch({ modelErrorOnText: cases[1].turns[1].inputText });
    const result = await runEvaluation(options(root, datasetPath), { fetchImpl: mock.fetchImpl });
    assert.equal(result.status, 'COMPLETE');
    assert.equal(result.callsMade, 3);
    const records = (await readFile(path.join(result.runDir, 'results.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    const aborted = records.find((item) => item.type === 'case_aborted' && item.caseId === 'C002');
    assert.equal(aborted.completedTurns, 1);
    assert.equal(aborted.plannedTurns, 2);
    assert.equal(records.filter((item) => item.type === 'case_completed').length, 1);
    const manifest = JSON.parse(await readFile(path.join(result.runDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.completedCases, 1);
    assert.equal(manifest.abortedCases, 1);
    const summary = summarizeEvaluation(manifest, records);
    assert.equal(summary.completeCaseTurns, 1);
    assert.equal(summary.partialOrSupersededTurns, 2);
    assert.equal(summary.abortedCases, 1);
    assert.equal(summary.attemptedErrors, 1);
    const resumed = await runEvaluation({ ...options(root, datasetPath), resumePath: result.runDir }, { fetchImpl: mock.fetchImpl });
    assert.equal(resumed.callsMade, 3);
    assert.equal(mock.callBodies.length, 3);
  });
});

test('manual stop inside a multi-turn case records an abort and resume does not replay it', async () => {
  await withDataset(async ({ root, datasetPath }) => {
    const mock = fixtureFetch();
    const result = await runEvaluation(options(root, datasetPath), {
      fetchImpl: mock.fetchImpl, shouldStop: () => mock.callBodies.length >= 2,
    });
    assert.equal(result.status, 'STOPPED');
    assert.equal(result.callsMade, 2);
    const records = (await readFile(path.join(result.runDir, 'results.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    const aborted = records.find((item) => item.type === 'case_aborted' && item.caseId === 'C002');
    assert.equal(aborted.status, 'STOPPED');
    assert.equal(aborted.completedTurns, 1);
    assert.equal(aborted.attemptedTurns, 1);
    const resumed = await runEvaluation({ ...options(root, datasetPath), resumePath: result.runDir }, { fetchImpl: mock.fetchImpl });
    assert.equal(resumed.callsMade, 2);
    assert.equal(mock.callBodies.length, 2);
  });
});

for (const [limitArgs, expectedStatus] of [
  [['--max-calls', '2'], 'CALL_LIMIT'],
  [['--max-cost-cny', '0.09'], 'COST_LIMIT'],
]) {
  test(`${expectedStatus} inside a multi-turn case records an abort before stopping`, async () => {
    await withDataset(async ({ root, datasetPath }) => {
      const mock = fixtureFetch();
      const result = await runEvaluation(options(root, datasetPath, limitArgs), { fetchImpl: mock.fetchImpl });
      assert.equal(result.status, expectedStatus);
      assert.equal(result.callsMade, 2);
      const records = (await readFile(path.join(result.runDir, 'results.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
      const aborted = records.find((item) => item.type === 'case_aborted' && item.caseId === 'C002');
      assert.equal(aborted.status, expectedStatus);
      assert.equal(aborted.completedTurns, 1);
      const resumed = await runEvaluation({ ...options(root, datasetPath, limitArgs), resumePath: result.runDir },
        { fetchImpl: mock.fetchImpl });
      assert.equal(resumed.callsMade, 2);
      assert.equal(mock.callBodies.length, 2);
    });
  });
}

test('legacy partial case without a terminal record blocks automatic replay on resume', async () => {
  await withDataset(async ({ root, datasetPath }) => {
    const mock = fixtureFetch();
    const result = await runEvaluation(options(root, datasetPath), {
      fetchImpl: mock.fetchImpl, shouldStop: () => mock.callBodies.length >= 2,
    });
    const resultsPath = path.join(result.runDir, 'results.jsonl');
    const records = (await readFile(resultsPath, 'utf8')).trim().split('\n').map(JSON.parse);
    await writeFile(resultsPath, records.filter((item) => item.type !== 'case_aborted')
      .map((item) => JSON.stringify(item)).join('\n') + '\n');
    await assert.rejects(runEvaluation({ ...options(root, datasetPath), resumePath: result.runDir },
      { fetchImpl: mock.fetchImpl }), /partial case\(s\) have billed turns/);
    assert.equal(mock.callBodies.length, 2);
  });
});

test('CSV cells guard spreadsheet formula prefixes', () => {
  assert.equal(csvLine(['=SUM(1,1)', '+1', '-2', '@test', ' safe', 'line\nbreak']),
    '"\'=SUM(1,1)","\'+1","\'-2","\'@test"," safe","line\nbreak"\n');
});
