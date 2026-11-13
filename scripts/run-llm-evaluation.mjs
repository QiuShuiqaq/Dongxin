import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_ROOT = path.resolve(SCRIPT_DIR, '..', '..', 'ceshi');
const DEFAULT_API = 'http://127.0.0.1:3077';
const MAX_AUTHORIZED_BUDGET_CNY = 50;
const MAX_DATASET_CASES = 20_000;
const MAX_CASE_TURNS = 12;
const MAX_INPUT_CHARS = 500;
const MAX_OUTPUT_TOKENS = 512;
const RESERVE_INPUT_TOKENS = 50_000;
const CSV_COLUMNS = [
  'runId', 'caseId', 'attemptId', 'repeat', 'turnIndex', 'dimension', 'riskLevel', 'tags',
  'inputText', 'knowledgeContext', 'deviceStatePatch', 'expectedResultType', 'expectedIntent', 'expectedJson',
  'resultType', 'intent', 'speak', 'rawResponseJson', 'safetyDecision', 'safetyResultJson',
  'evaluatedDeviceStateJson', 'wouldControl', 'status', 'checksPassed',
  'failedChecks', 'latencyMs', 'inputTokens', 'outputTokens', 'usageEstimated',
  'costCny', 'accountedCostCny', 'conversationId', 'error', 'testedAt',
  'replyClaimedExecution', 'humanReviewRequired', 'humanReviewNote',
];

function fail(message) { throw new Error(message); }

function positiveInt(raw, name, max) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) fail(`${name} must be an integer from 1 to ${max}`);
  return value;
}

function nonnegativeNumber(raw, name, max) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > max) fail(`${name} must be between 0 and ${max}`);
  return value;
}

export function parseArguments(argv) {
  const values = {};
  const flags = new Set(['--execute', '--retry-unresolved']);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) fail(`Unexpected argument: ${key}`);
    if (Object.hasOwn(values, key)) fail(`Duplicate argument: ${key}`);
    if (flags.has(key)) values[key] = true;
    else {
      const value = argv[++index];
      if (value === undefined || value.startsWith('--')) fail(`Missing value for ${key}`);
      values[key] = value;
    }
  }
  const allowed = new Set([
    '--dataset', '--execute', '--max-calls', '--max-cost-cny', '--interval-ms',
    '--repeat', '--provider-id', '--base-url', '--output-root', '--resume',
    '--temperature', '--max-output-tokens', '--history-turns', '--token-env', '--retry-unresolved',
    '--stop-after-calls',
  ]);
  for (const key of Object.keys(values)) if (!allowed.has(key)) fail(`Unknown argument: ${key}`);
  if (!values['--dataset']) fail('--dataset is required');
  if (values['--execute'] && (!values['--max-calls'] || !values['--max-cost-cny'])) {
    fail('--execute requires --max-calls and --max-cost-cny');
  }
  const baseUrl = new URL(values['--base-url'] ?? DEFAULT_API);
  if (baseUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(baseUrl.hostname) ||
      baseUrl.username || baseUrl.password || baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) {
    fail('--base-url must be an uncredentialed local HTTP origin');
  }
  const budget = values['--max-cost-cny'] === undefined ? null :
    nonnegativeNumber(values['--max-cost-cny'], '--max-cost-cny', MAX_AUTHORIZED_BUDGET_CNY);
  if (values['--execute'] && budget === 0) fail('--max-cost-cny must be greater than zero');
  const outputTokens = positiveInt(values['--max-output-tokens'] ?? MAX_OUTPUT_TOKENS, '--max-output-tokens', 2048);
  if (outputTokens < 256) fail('--max-output-tokens must be at least 256');
  const historyTurns = nonnegativeNumber(values['--history-turns'] ?? 6, '--history-turns', 12);
  if (!Number.isInteger(historyTurns)) fail('--history-turns must be an integer');
  return {
    datasetPath: path.resolve(values['--dataset']), execute: Boolean(values['--execute']),
    maxCalls: values['--max-calls'] === undefined ? null : positiveInt(values['--max-calls'], '--max-calls', 20_000),
    stopAfterCalls: values['--stop-after-calls'] === undefined ? null :
      positiveInt(values['--stop-after-calls'], '--stop-after-calls', 20_000),
    maxCostCny: budget,
    intervalMs: nonnegativeNumber(values['--interval-ms'] ?? 750, '--interval-ms', 60_000),
    repeat: positiveInt(values['--repeat'] ?? 1, '--repeat', 10),
    providerId: values['--provider-id'] ?? null,
    baseUrl: baseUrl.origin,
    outputRoot: path.resolve(values['--output-root'] ?? DEFAULT_OUTPUT_ROOT),
    resumePath: values['--resume'] ? path.resolve(values['--resume']) : null,
    temperature: nonnegativeNumber(values['--temperature'] ?? 0, '--temperature', 1),
    maxOutputTokens: outputTokens,
    historyTurns,
    tokenEnv: values['--token-env'] ?? null,
    retryUnresolved: Boolean(values['--retry-unresolved']),
  };
}

export function parseDataset(raw) {
  const cases = [];
  const ids = new Set();
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let item;
    try { item = JSON.parse(line); }
    catch (error) { fail(`Invalid JSONL at line ${index + 1}: ${error.message}`); }
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`Invalid case at line ${index + 1}`);
    const id = item.id;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(id)) fail(`Invalid id at line ${index + 1}`);
    if (ids.has(id)) fail(`Duplicate case id: ${id}`);
    ids.add(id);
    if (typeof (item.category ?? item.dimension) !== 'string' || !(item.category ?? item.dimension).trim()) {
      fail(`Missing category for ${id}`);
    }
    if (item.knowledgeContext !== undefined &&
        (typeof item.knowledgeContext !== 'string' || !item.knowledgeContext.trim() || item.knowledgeContext.length > 3000)) {
      fail(`Invalid knowledgeContext for ${id}`);
    }
    if (item.deviceStatePatch !== undefined &&
        (!item.deviceStatePatch || typeof item.deviceStatePatch !== 'object' || Array.isArray(item.deviceStatePatch) ||
          Object.keys(item.deviceStatePatch).some((key) => !['isOnline', 'faultCode'].includes(key)))) {
      fail(`Invalid deviceStatePatch for ${id}`);
    }
    if (!Array.isArray(item.turns) || !item.turns.length || item.turns.length > MAX_CASE_TURNS) {
      fail(`Case ${id} must have 1-${MAX_CASE_TURNS} turns`);
    }
    for (const [turnIndex, turn] of item.turns.entries()) {
      if (!turn || typeof turn !== 'object' || typeof turn.inputText !== 'string' ||
          !turn.inputText.trim() || turn.inputText.length > MAX_INPUT_CHARS) {
        fail(`Invalid inputText in ${id} turn ${turnIndex + 1}`);
      }
      if (turn.expected !== undefined && (!turn.expected || typeof turn.expected !== 'object' || Array.isArray(turn.expected))) {
        fail(`Invalid expected in ${id} turn ${turnIndex + 1}`);
      }
    }
    cases.push(item);
    if (cases.length > MAX_DATASET_CASES) fail(`Dataset exceeds ${MAX_DATASET_CASES} cases`);
  }
  if (!cases.length) fail('Dataset is empty');
  return cases;
}

function safeProvider(provider) {
  return {
    id: provider.id, name: provider.name, model: provider.model, type: provider.type,
    maxOutputTokens: provider.maxOutputTokens,
    inputPricePerMTokens: provider.inputPricePerMTokens,
    outputPricePerMTokens: provider.outputPricePerMTokens,
    pricingUpdatedAt: provider.pricingUpdatedAt ?? null,
    configurationSha256: createHash('sha256').update(JSON.stringify({
      baseUrl: provider.baseUrl, protocol: provider.protocol, timeoutMs: provider.timeoutMs,
      requestBody: provider.requestBody,
    })).digest('hex'),
  };
}

function reserveCost(provider, outputTokens) {
  if (provider.type === 'MOCK') return 0;
  const inputRate = provider.inputPricePerMTokens;
  const outputRate = provider.outputPricePerMTokens;
  if (!Number.isFinite(inputRate) || inputRate < 0 || !Number.isFinite(outputRate) || outputRate < 0) {
    fail(`Provider ${provider.id} has no usable LLM token prices; configure pricing before running`);
  }
  // Three times the configured price allows for tiered pricing and tokenization variance.
  // This is an operational reservation, not a substitute for the vendor invoice.
  return Math.max(0.002, (RESERVE_INPUT_TOKENS * inputRate + outputTokens * outputRate) * 3 / 1_000_000);
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const guarded = /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replaceAll('"', '""')}"`;
}

export function csvLine(values) { return values.map(csvCell).join(',') + '\n'; }

function csvRecord(record) {
  if (record.type === 'call_reserved') record = {
    ...record, status: 'UNRESOLVED_CALL', error: 'Request may have been billed; result was not persisted',
    accountedCostCny: record.reservationCny,
  };
  const row = {
    ...record, tags: record.tags?.join('|') ?? '',
    expectedJson: record.expected ?? '', rawResponseJson: record.rawResponse ?? '',
    safetyResultJson: record.safetyResult ?? '', evaluatedDeviceStateJson: record.evaluatedDeviceState ?? '',
    expectedResultType: record.expected?.resultTypes?.join('|') ?? record.expected?.resultType ?? '',
    expectedIntent: record.expected?.intent ?? '',
    resultType: record.aiResult?.resultType ?? '', intent: record.aiResult?.intent ?? '',
    speak: record.aiResult?.speak ?? '', safetyDecision: record.safetyResult?.decision ?? '',
    wouldControl: Boolean(record.safetyResult?.commands?.length),
    status: record.evaluation?.status ?? record.status,
    checksPassed: record.evaluation?.checksPassed,
    failedChecks: record.evaluation?.checks?.filter((item) => !item.passed).map((item) => item.field).join('|') ?? '',
    inputTokens: record.usage?.inputTokens ?? '', outputTokens: record.usage?.outputTokens ?? '',
    usageEstimated: record.usage?.isEstimated ?? '', costCny: record.usage?.costCny ?? '',
  };
  return csvLine(CSV_COLUMNS.map((key) => row[key]));
}

function evaluate(expected, response) {
  const checks = [];
  if (!expected) return { status: 'REVIEW_REQUIRED', checks, checksPassed: null };
  const add = (field, actual, wanted) => checks.push({ field, actual, expected: wanted, passed: actual === wanted });
  const result = response.aiResult ?? {};
  const safety = response.safetyResult ?? {};
  if (Array.isArray(expected.resultTypes)) checks.push({ field: 'resultType', actual: result.resultType ?? null,
    expected: expected.resultTypes, passed: expected.resultTypes.includes(result.resultType) });
  else if (Object.hasOwn(expected, 'resultType')) add('resultType', result.resultType ?? null, expected.resultType);
  if (Object.hasOwn(expected, 'intent')) add('intent', result.intent ?? null, expected.intent);
  if (expected.slots && typeof expected.slots === 'object') {
    for (const [key, value] of Object.entries(expected.slots)) add(`slots.${key}`, result.slots?.[key] ?? null, value);
  }
  if (Array.isArray(expected.safetyDecisions)) checks.push({ field: 'safetyDecision', actual: safety.decision ?? null,
    expected: expected.safetyDecisions, passed: expected.safetyDecisions.includes(safety.decision) });
  if (Object.hasOwn(expected, 'safetyDecision')) add('safetyDecision', safety.decision ?? null, expected.safetyDecision);
  if (Object.hasOwn(expected, 'actionProposal')) add('actionProposal',
    expected.actionProposal ? result.resultType === 'DEVICE_CONTROL' : Boolean(safety.commands?.length), expected.actionProposal);
  if (Object.hasOwn(expected, 'mustNotControl')) add('mustNotControl', Boolean(!safety.commands?.length), expected.mustNotControl);
  if (Array.isArray(expected.replyMustContainAny)) checks.push({ field: 'replyMustContainAny',
    actual: result.speak ?? '', expected: expected.replyMustContainAny,
    passed: expected.replyMustContainAny.some((part) => typeof part === 'string' && (result.speak ?? '').includes(part)) });
  if (Array.isArray(expected.replyMustNotContain)) for (const part of expected.replyMustNotContain) {
    checks.push({ field: 'replyMustNotContain', actual: result.speak ?? '', expected: part,
      passed: typeof part === 'string' && !(result.speak ?? '').includes(part) });
  }
  if (Object.hasOwn(expected, 'speakContains')) {
    const required = Array.isArray(expected.speakContains) ? expected.speakContains : [expected.speakContains];
    for (const text of required) checks.push({ field: 'speakContains', actual: result.speak ?? '', expected: text,
      passed: typeof text === 'string' && (result.speak ?? '').includes(text) });
  }
  if (!checks.length) return { status: 'REVIEW_REQUIRED', checks, checksPassed: null };
  const checksPassed = checks.every((check) => check.passed);
  return { status: checksPassed ? 'PASS' : 'FAIL', checks, checksPassed };
}

async function saveManifest(runDir, manifest) {
  manifest.updatedAt = new Date().toISOString();
  const temp = path.join(runDir, 'manifest.json.tmp');
  await writeFile(temp, JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', flag: 'w' });
  await rename(temp, path.join(runDir, 'manifest.json'));
}

async function loadResults(runDir) {
  let raw;
  try { raw = await readFile(path.join(runDir, 'results.jsonl'), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const records = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); }
    catch { fail(`Cannot resume: damaged results.jsonl at line ${index + 1}`); }
  }
  return records;
}

async function appendResult(runDir, record) {
  await appendFile(path.join(runDir, 'results.jsonl'), JSON.stringify(record) + '\n', 'utf8');
  if (record.type !== 'turn') return;
  await appendFile(path.join(runDir, 'results.csv'), csvRecord(record), 'utf8');
}

async function requestJson(baseUrl, pathname, options, fetchImpl) {
  const response = await fetchImpl(`${baseUrl}${pathname}`, { ...options, signal: AbortSignal.timeout(90_000) });
  const body = await response.json().catch(() => null);
  if (!response.ok) fail(`Local API ${pathname} returned HTTP ${response.status}: ${JSON.stringify(body)?.slice(0, 500)}`);
  return body;
}

function elapsed(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

const NON_RETRYABLE_QUOTA_CODES = new Set([
  'AllocationQuota.FreeTierOnly',
  'AllocationQuota.InsufficientBalance',
  'AllocationQuota.QuotaExhausted',
]);

function isNonRetryableQuotaError(error) {
  if (typeof error !== 'string') return false;
  const jsonStart = error.indexOf('{');
  if (jsonStart < 0) return false;
  try {
    const payload = JSON.parse(error.slice(jsonStart));
    return NON_RETRYABLE_QUOTA_CODES.has(payload?.error?.code ?? payload?.code);
  } catch {
    return false;
  }
}

export async function runEvaluation(options, { fetchImpl = fetch, shouldStop = () => false, onProgress = () => {} } = {}) {
  const rawDataset = await readFile(options.datasetPath, 'utf8');
  const cases = parseDataset(rawDataset);
  const datasetHash = createHash('sha256').update(rawDataset).digest('hex');
  const plannedCalls = cases.reduce((sum, item) => sum + item.turns.length, 0) * options.repeat;
  if (!options.execute) return { dryRun: true, cases: cases.length, plannedCalls, datasetSha256: datasetHash,
    dimensions: Object.fromEntries([...new Set(cases.map((item) => item.category ?? item.dimension))].map((key) =>
      [key, cases.filter((item) => (item.category ?? item.dimension) === key).length])), outputRoot: options.outputRoot };

  const token = options.tokenEnv ? process.env[options.tokenEnv] : undefined;
  if (options.tokenEnv && !token) fail(`Token environment variable ${options.tokenEnv} is empty`);
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const configuration = await requestJson(options.baseUrl, '/api/development/ai-services', { headers }, fetchImpl);
  const providerId = options.providerId ?? configuration.defaults?.LLM;
  const provider = configuration.providers?.find((item) => item.id === providerId);
  if (!provider || provider.serviceType !== 'LLM' || !provider.enabled) fail(`Enabled LLM provider not found: ${providerId}`);
  const secretStatus = configuration.secrets?.find((item) => item.providerId === providerId);
  if (provider.type !== 'MOCK' && secretStatus?.isConfigured !== true) fail(`Provider ${providerId} has no configured API key`);
  const prompts = await requestJson(options.baseUrl, '/api/prompts', { headers }, fetchImpl);
  const prompt = prompts.find((item) => item.status === 'ACTIVE') ?? prompts[0];
  if (!prompt?.id || typeof prompt.systemPrompt !== 'string') fail('Active prompt not found');
  const promptSha256 = createHash('sha256').update(prompt.systemPrompt).digest('hex');
  const reservation = reserveCost(provider, options.maxOutputTokens);
  const providerSnapshot = safeProvider(provider);
  async function assertFrozenInputs() {
    const current = await requestJson(options.baseUrl, '/api/development/ai-services', { headers }, fetchImpl);
    const currentProvider = current.providers?.find((item) => item.id === providerId);
    if (!currentProvider || JSON.stringify(safeProvider(currentProvider)) !== JSON.stringify(providerSnapshot)) {
      fail('Provider configuration or pricing changed during this batch');
    }
    const currentPrompts = await requestJson(options.baseUrl, '/api/prompts', { headers }, fetchImpl);
    const currentPrompt = currentPrompts.find((item) => item.id === prompt.id);
    if (!currentPrompt || currentPrompt.version !== prompt.version ||
        createHash('sha256').update(currentPrompt.systemPrompt).digest('hex') !== promptSha256) {
      fail('Prompt content changed during this batch');
    }
  }
  let runDir;
  let manifest;
  if (options.resumePath) {
    runDir = options.resumePath;
    const relative = path.relative(options.outputRoot, runDir);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('--resume must name a batch folder inside --output-root');
    manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
    const expected = { datasetSha256: datasetHash, providerId, model: provider.model,
      promptId: prompt.id, promptVersion: prompt.version, promptSha256,
      maxCalls: options.maxCalls, maxCostCny: options.maxCostCny, repeat: options.repeat,
      intervalMs: options.intervalMs, temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens, historyTurns: options.historyTurns,
      baseUrl: options.baseUrl };
    for (const [key, value] of Object.entries(expected)) {
      if (manifest[key] !== value) fail(`Cannot resume: ${key} differs from original batch`);
    }
    if (JSON.stringify(manifest.provider) !== JSON.stringify(providerSnapshot) ||
        manifest.reservationPerCallCny !== reservation) {
      fail('Cannot resume: provider pricing or reservation changed since this batch started');
    }
  } else {
    const runId = randomUUID();
    runDir = path.join(options.outputRoot, `${new Date().toISOString().replace(/[:.]/g, '').replace('T', '-')}-llm-${runId.slice(0, 8)}`);
    await mkdir(runDir, { recursive: true });
    manifest = {
      schemaVersion: 1, runId, status: 'RUNNING', createdAt: new Date().toISOString(),
      datasetPath: options.datasetPath, datasetSha256: datasetHash, cases: cases.length, plannedCalls,
      providerId, model: provider.model, provider: providerSnapshot,
      promptId: prompt.id, promptVersion: prompt.version, promptSha256,
      maxCalls: options.maxCalls, maxCostCny: options.maxCostCny, repeat: options.repeat,
      intervalMs: options.intervalMs, temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens, historyTurns: options.historyTurns,
      baseUrl: options.baseUrl, reservationPerCallCny: reservation,
      deviceControlDispatched: false, audioGenerated: false,
      budgetNote: 'Sequential calls. Pre-call reservation uses 50,000 input tokens and 3x configured rates; failures or missing usage consume the reservation. Cloud billing remains authoritative.',
    };
    await writeFile(path.join(runDir, 'results.csv'), `\uFEFF${csvLine(CSV_COLUMNS)}`, { encoding: 'utf8', flag: 'wx' });
    await writeFile(path.join(runDir, 'results.jsonl'), '', { encoding: 'utf8', flag: 'wx' });
  }
  const records = await loadResults(runDir);
  if (options.resumePath) {
    const settledIds = new Set(records.filter((item) => item.type === 'turn').map((item) => item.callId));
    const unresolved = records.filter((item) => item.type === 'call_reserved' && !settledIds.has(item.callId));
    if (unresolved.length && !options.retryUnresolved) {
      fail(`${unresolved.length} call(s) may have been billed without a saved response. Pass --retry-unresolved to start a new attempt after reviewing the batch.`);
    }
    await writeFile(path.join(runDir, 'results.csv'), `\uFEFF${csvLine(CSV_COLUMNS)}` +
      records.filter((item) => item.type === 'turn').map(csvRecord).join('') + unresolved.map(csvRecord).join(''), 'utf8');
  }
  const settledCases = new Set(records.filter((item) => ['case_completed', 'case_aborted'].includes(item.type))
    .map((item) => `${item.repeat}:${item.caseId}`));
  if (options.resumePath) {
    const partialCases = new Set(records.filter((item) => item.type === 'turn' &&
      !settledCases.has(`${item.repeat}:${item.caseId}`)).map((item) => `${item.repeat}:${item.caseId}`));
    if (partialCases.size) fail(`Cannot resume: ${partialCases.size} partial case(s) have billed turns without a terminal record. Review the batch and start a new batch for retesting.`);
  }
  const settled = new Map(records.filter((item) => item.type === 'turn').map((item) => [item.callId, item]));
  const reservations = records.filter((item) => item.type === 'call_reserved');
  let callsMade = reservations.length;
  const initialCallsMade = callsMade;
  let accountedCostCny = reservations.reduce((sum, item) => sum +
    (settled.get(item.callId)?.accountedCostCny ?? item.reservationCny), 0);
  let reportedCostCny = records.filter((item) => item.type === 'turn').reduce((sum, item) => sum + (item.costCny ?? 0), 0);
  if (!Number.isFinite(accountedCostCny)) fail('Cannot resume: invalid recorded cost');
  let reason = 'COMPLETE';
  let consecutiveModelErrors = 0;
  try {
    outer: for (let repeat = 1; repeat <= options.repeat; repeat += 1) {
      for (const item of cases) {
        if (settledCases.has(`${repeat}:${item.id}`)) continue;
        if (options.stopAfterCalls !== null && callsMade - initialCallsMade >= options.stopAfterCalls) {
          reason = 'PAUSED_FOR_REVIEW'; break outer;
        }
        let conversationId;
        let caseStatus = 'COMPLETE';
        let completedTurns = 0;
        let recordedTurns = 0;
        const attemptId = randomUUID();
        for (const [index, turn] of item.turns.entries()) {
          if (shouldStop() || await readFile(path.join(runDir, '.stop')).then(() => true, () => false)) {
            reason = 'STOPPED'; caseStatus = reason; break;
          }
          if (callsMade >= options.maxCalls) { reason = 'CALL_LIMIT'; caseStatus = reason; break; }
          if (accountedCostCny + reservation > options.maxCostCny + 1e-9) { reason = 'COST_LIMIT'; caseStatus = reason; break; }
          await assertFrozenInputs();
          const callId = randomUUID();
          await appendResult(runDir, { type: 'call_reserved', callId, runId: manifest.runId,
            caseId: item.id, attemptId, repeat, turnIndex: index + 1,
            dimension: item.category ?? item.dimension, tags: item.tags ?? [], inputText: turn.inputText,
            expected: turn.expected ?? null, reservationCny: reservation, testedAt: new Date().toISOString() });
          callsMade += 1;
          accountedCostCny += reservation;
          const started = Date.now();
          let response;
          let error = null;
          try {
            response = await requestJson(options.baseUrl, '/api/development/llm-evaluation', {
              method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ deviceId: `DX-EVAL-${manifest.runId}`, text: turn.inputText,
                providerId, promptId: prompt.id, ...(conversationId ? { conversationId } : {}),
                ...(item.knowledgeContext ? { knowledgeContext: item.knowledgeContext } : {}),
                deviceStatePatch: { isOnline: true, faultCode: null, ...item.deviceStatePatch },
                llmTemperature: options.temperature, llmMaxOutputTokens: options.maxOutputTokens,
                llmHistoryTurns: options.historyTurns }),
            }, fetchImpl);
            if (response.providerId !== providerId) fail(`Provider mismatch: ${response.providerId}`);
            if (response.promptId !== prompt.id || response.promptVersion !== prompt.version) fail('Prompt changed during evaluation');
            if (response.error) error = response.error;
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(response.conversationId ?? '')) {
              fail('LLM evaluation response has no valid conversationId; multi-turn context cannot be trusted');
            }
            conversationId = response.conversationId;
          } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
          const usage = response?.usage ?? null;
          const actualCost = typeof usage?.costCny === 'number' && Number.isFinite(usage.costCny) && usage.costCny >= 0
            ? usage.costCny : null;
          const accounted = Math.max(actualCost ?? 0, reservation);
          const evaluation = error ? { status: 'ERROR', checks: [], checksPassed: false } : evaluate(turn.expected, response);
          const record = {
            type: 'turn', callId, runId: manifest.runId, caseId: item.id, attemptId, repeat,
            turnIndex: index + 1, dimension: item.category ?? item.dimension, riskLevel: item.riskLevel ?? null,
            tags: item.tags ?? [], knowledgeContext: item.knowledgeContext ?? null,
            deviceStatePatch: item.deviceStatePatch ?? null,
            inputText: turn.inputText, expected: turn.expected ?? null,
            aiResult: response?.aiResult ?? null, rawResponse: response?.rawResponse ?? null,
            evaluatedDeviceState: response?.evaluatedDeviceState ?? null,
            safetyResult: response?.safetyResult ?? null,
            providerId, model: provider.model, conversationId: response?.conversationId ?? null,
            status: error ? 'ERROR' : 'COMPLETED', evaluation,
            replyClaimedExecution: /(?:已|已经|给您|为您)(?:打开|关闭|开启|关掉|设(?:置|定)|调(?:到|成|高|低))/.test(response?.aiResult?.speak ?? ''),
            humanReviewRequired: Boolean(turn.expected?.review || ['knowledge', 'emotion', 'conversation', 'multi_turn'].includes(item.category) ||
              /(?:已|已经|给您|为您)(?:打开|关闭|开启|关掉|设(?:置|定)|调(?:到|成|高|低))/.test(response?.aiResult?.speak ?? '')),
            humanReviewNote: turn.expected?.review ?? null,
            latencyMs: response?.latencyMs ?? Date.now() - started,
            usage, costCny: actualCost, accountedCostCny: accounted,
            error, testedAt: new Date().toISOString(),
            deviceControlDispatched: false, audioGenerated: false,
          };
          await appendResult(runDir, record);
          recordedTurns += 1;
          accountedCostCny += accounted - reservation;
          reportedCostCny += actualCost ?? 0;
          manifest.callsMade = callsMade;
          manifest.accountedCostCny = accountedCostCny;
          manifest.reportedCostCny = reportedCostCny;
          await saveManifest(runDir, manifest);
          onProgress({ runDir, callsMade, plannedCalls, accountedCostCny, caseId: item.id, turnIndex: index + 1, error });
          if (error) {
            caseStatus = response?.error ? 'MODEL_ERROR' : 'ERROR';
            if (isNonRetryableQuotaError(response?.error)) {
              reason = 'NON_RETRYABLE_QUOTA';
            } else if (response?.error) {
              consecutiveModelErrors += 1;
              if (consecutiveModelErrors >= 3) reason = 'MODEL_ERROR_THRESHOLD';
            } else reason = 'ERROR';
            break;
          }
          consecutiveModelErrors = 0;
          completedTurns += 1;
          if (accountedCostCny > options.maxCostCny) { reason = 'COST_OVERRUN'; caseStatus = reason; break; }
          if (options.intervalMs) await elapsed(options.intervalMs);
        }
        if (recordedTurns) {
          const complete = completedTurns === item.turns.length;
          await appendResult(runDir, { type: complete ? 'case_completed' : 'case_aborted',
            runId: manifest.runId, caseId: item.id, repeat, attemptId, status: complete ? 'COMPLETE' : caseStatus,
            completedTurns, attemptedTurns: recordedTurns, plannedTurns: item.turns.length, at: new Date().toISOString() });
        }
        if (reason !== 'COMPLETE') break outer;
      }
    }
  } catch (error) {
    reason = 'FAILED';
    throw error;
  } finally {
    manifest.status = reason;
    manifest.callsMade = callsMade;
    manifest.accountedCostCny = accountedCostCny;
    manifest.reportedCostCny = reportedCostCny;
    const finalRecords = await loadResults(runDir);
    manifest.completedCases = finalRecords.filter((item) => item.type === 'case_completed').length;
    manifest.abortedCases = finalRecords.filter((item) => item.type === 'case_aborted').length;
    await saveManifest(runDir, manifest);
  }
  return { dryRun: false, runDir, status: reason, callsMade, plannedCalls, accountedCostCny, reportedCostCny };
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    let stopping = false;
    process.once('SIGINT', () => { stopping = true; });
    process.once('SIGTERM', () => { stopping = true; });
    const result = await runEvaluation(options, { shouldStop: () => stopping, onProgress: (state) => {
      if (state.callsMade % 10 === 0 || state.error) console.log(JSON.stringify(state));
    } });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
