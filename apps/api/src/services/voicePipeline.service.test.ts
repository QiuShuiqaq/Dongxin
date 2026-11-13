import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { DeviceStateSchema, ModelProviderSchema, PromptVersionSchema } from '@dongxin/shared';
import type { ModelCallInput } from '../modelGateway.js';
import { voiceConversations } from './conversation.service.js';
import { runVoiceWork } from '../runtime/workload.js';
import { bumpDeviceControlRevision } from '../deviceSimulator.js';
import type { Pool } from 'pg';
import { setProductionVoiceHistoryPool } from '../repositories/productionVoiceHistory.repository.js';

// All external effects are replaced before loading the pipeline: no API costs,
// audio capture/playback, repository writes, MQTT messages or device actions.
const state = DeviceStateSchema.parse({ isOnline: true, activeModes: [], targetTemperature: 35, ambientTemperature: 25, hasOccupancy: true, voiceBroadcastEnabled: true, faultCode: null, updatedAt: new Date().toISOString() });
const provider = ModelProviderSchema.parse({ id: 'fixture', name: 'fixture', type: 'MOCK', enabled: true, model: 'fixture' });
const prompt = PromptVersionSchema.parse({ id: 'fixture', name: 'fixture', version: 1, status: 'ACTIVE', createdAt: '', systemPrompt: 'fixture' });
const chat = { resultType: 'CHAT' as const, intent: null, confidence: 1, slots: {}, requiresConfirm: false, speak: '测试模型回复' };
let modelCalls: ModelCallInput[] = [];
let ttsCalls: string[] = [];
let transcript = '你好';
let failModel = false;
let knowledge: { fastAnswer: string | null; blockedAnswer?: string | null; context: string; hits: Array<{ documentId: string }> } = { fastAnswer: null, context: '', hits: [] };
const unexpectedAction = async () => { throw new Error('Test attempted a device action'); };
const replace = (path: string, namedExports: Record<string, unknown>) => mock.module(new URL(path, import.meta.url).href, { namedExports });

replace('../modelGateway.js', { callModel: async (input: ModelCallInput) => {
  modelCalls.push(structuredClone(input));
  if (failModel) throw new Error('fixture model error');
  return { aiResult: chat, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costCny: 0.001, isEstimated: false }, latencyMs: 2 };
} });
replace('../envStore.js', { isEnvConfigured: () => true });
replace('../repositories/productionCost.repository.js', { getProductionCostSettings: async () => ({}) });
replace('../repositories/system.repository.js', { getDeviceProfile: async () => ({ model: 'fixture-model' }), patchDeviceCommand: async () => undefined });
replace('./log.service.js', { appendLog: async () => undefined });
replace('./knowledge.service.js', { getVoiceKnowledge: async () => knowledge });
replace('./prompt.service.js', { listPrompts: async () => [prompt], findPrompt: () => prompt });
replace('./provider.service.js', { listProviders: async () => [provider], findProvider: () => provider, getDefaultProviderForService: async () => provider });
replace('./testSet.service.js', { getTestSet: async () => { throw new Error('Unexpected test-set read'); } });
replace('./deviceRegistry.service.js', { getDeviceState: async () => state, executeCommandForDevice: unexpectedAction, queueDeviceCommand: unexpectedAction, listCommandsForDevice: async () => [] });
replace('./deviceAccess.service.js', { intentToDeviceAction: unexpectedAction });
replace('./mqttGateway.service.js', { publishQueuedDeviceCommand: unexpectedAction });
replace('./speech.service.js', {
  transcribeAudio: async () => ({ status: 'COMPLETED', providerId: 'asr-fixture', providerName: 'ASR', text: transcript, latencyMs: 3, costCny: 0.001, isEstimated: false, error: null }),
  synthesizeSpeech: async (input: { text: string }) => {
    ttsCalls.push(input.text);
    return { status: 'COMPLETED', providerId: 'tts-fixture', providerName: 'TTS', audioBase64: 'Zml4dHVyZQ==', audioMimeType: 'audio/wav', latencyMs: 4, costCny: 0.001, isEstimated: false, error: null };
  },
});
replace('./deviceAudioAsset.service.js', { createDeviceVoiceReplyAsset: () => ({ path: '/fixture/audio' }) });

const { runVoicePipeline, runLlmModuleTest, matchOnlineRule } = await import('./voicePipeline.service.js');
const base = { deviceId: 'fixture-device', inputSource: 'TEXT_SIMULATION', applyToDevice: false, simulateOffline: 'MISS' };

test('a local action while a voice request waits in the queue cancels its later control', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const active = runVoiceWork(base.deviceId, () => gate);
  const queued = runVoicePipeline({ ...base, text: '打开照明', applyToDevice: true });
  const cancelled = assert.rejects(queued, (error: unknown) => (error as { code?: string }).code === 'STALE_VOICE_COMMAND');
  bumpDeviceControlRevision(base.deviceId);
  release();
  await active;
  await cancelled;
});

beforeEach(() => {
  voiceConversations.reset({ deviceId: base.deviceId, channel: 'pipeline' });
  voiceConversations.reset({ deviceId: base.deviceId, channel: 'llm-test' });
  modelCalls = [];
  ttsCalls = [];
  failModel = false;
  knowledge = { fastAnswer: null, context: '', hits: [] };
});

test('common commands and greetings bypass LLM and generate TTS without acting on a device', async () => {
  const rule = await runVoicePipeline({ ...base, text: '打开照明' });
  assert.equal(rule.route, 'ONLINE_RULE');
  assert.equal(rule.aiResult.intent, 'LIGHT_ON');
  assert.equal(rule.commandRecord, null);
  assert.deepEqual(ttsCalls, ['已打开照明。']);
  assert.equal(modelCalls.length, 0);
  const greeting = await runVoicePipeline({ ...base, text: '你好' });
  assert.equal(greeting.route, 'ONLINE_RULE');
  assert.equal(modelCalls.length, 0);
});

test('negative, question and compound sentences do not trigger substring rules', () => {
  for (const text of ['不要打开照明', '打开照明了吗', '请问打开照明需要多少电', '你好，我想知道保修规则', '关灯再打开换气']) assert.equal(matchOnlineRule(text), null, text);
  assert.equal(matchOnlineRule('请帮我打开照明一下')?.intent, 'LIGHT_ON');
});

test('exact FAQ bypasses LLM; related references and unknown questions still reach the model', async () => {
  knowledge = { fastAnswer: '测试FAQ答案', context: '测试资料', hits: [{ documentId: 'fixture' }] };
  const faq = await runVoicePipeline({ ...base, text: '测试FAQ问题' });
  assert.equal(faq.route, 'KNOWLEDGE');
  assert.equal(modelCalls.length, 0);
  assert.deepEqual(ttsCalls, ['测试FAQ答案']);
  knowledge.fastAnswer = null;
  await runVoicePipeline({ ...base, text: '关于测试资料我还有问题' });
  assert.equal(modelCalls[0].knowledgeContext, '测试资料');
  knowledge = { fastAnswer: null, context: '', hits: [] };
  const unknown = await runVoicePipeline({ ...base, text: '这个问题资料里没有，为什么会这样' });
  assert.equal(unknown.route, 'LLM');
  assert.equal(modelCalls.length, 2);
});

test('LLM follow-ups receive earlier fast replies and do not claim preview commands executed', async () => {
  const first = await runVoicePipeline({ ...base, text: '打开照明' });
  await runVoicePipeline({ ...base, text: '刚才是什么指令', conversationId: first.conversationId });
  const history = modelCalls[0].history!;
  assert.equal(history.length, 2);
  assert.equal(history[0].content, '打开照明');
  assert.equal(JSON.parse(history[1].content).executionStatus, 'NOT_EXECUTED');
  await runVoicePipeline({ ...base, text: '再说详细一点', conversationId: first.conversationId });
  assert.equal(modelCalls[1].history?.length, 4);
  await runVoicePipeline({ ...base, text: '全新问题' });
  assert.equal(modelCalls[2].history?.length, 0, 'independent requests cannot share conversation history');
});

test('unverified product policies produce a conservative reply without LLM or control', async () => {
  knowledge = { fastAnswer: null, blockedAnswer: '资料尚未确认，请联系官方售后核实。', context: '', hits: [] };
  const result = await runVoicePipeline({ ...base, text: '浴霸的保修政策是什么' });
  assert.equal(result.route, 'KNOWLEDGE');
  assert.equal(modelCalls.length, 0);
  assert.equal(result.commandRecord, null);
  assert.deepEqual(ttsCalls, [knowledge.blockedAnswer]);
});

test('wake-only reply opens a device conversation; subsequent turns need no repeated wake word', async () => {
  const deviceInput = { ...base, inputSource: 'DEVICE_AUDIO', audioBase64: 'Zml4dHVyZQ==', requireWakeWord: true };
  transcript = '小东小东';
  const wake = await runVoicePipeline(deviceInput);
  assert.equal(wake.replyText, '我在');
  assert.equal(ttsCalls.length, 0, 'device wake reply uses the existing local asset');
  transcript = '给我讲个故事';
  const next = await runVoicePipeline(deviceInput);
  assert.equal(next.conversationId, wake.conversationId);
  assert.equal(next.route, 'LLM');
  assert.equal(modelCalls[0].history?.[0].content, '小东小东');
  transcript = '再见';
  await runVoicePipeline(deviceInput);
  transcript = '给我讲个故事';
  const closed = await runVoicePipeline(deviceInput);
  assert.notEqual(closed.conversationId, wake.conversationId);
  assert.equal(closed.route, 'UNRESOLVED', 'a new conversation requires wake again');
});

test('repeated unawakened device utterances cannot open a conversation', async () => {
  const deviceInput = { ...base, inputSource: 'DEVICE_AUDIO', audioBase64: 'Zml4dHVyZQ==', requireWakeWord: true };
  transcript = '打开照明';
  const first = await runVoicePipeline(deviceInput);
  const second = await runVoicePipeline({ ...deviceInput, conversationId: first.conversationId });
  assert.equal(first.route, 'UNRESOLVED');
  assert.equal(second.route, 'UNRESOLVED');
  assert.equal(modelCalls.length, 0);
  assert.equal(ttsCalls.length, 0);
  transcript = '小东小东打开照明';
  const awakened = await runVoicePipeline({ ...deviceInput, conversationId: second.conversationId });
  assert.equal(awakened.route, 'ONLINE_RULE');
  assert.equal(awakened.aiResult.intent, 'LIGHT_ON');
});

test('a verified CI wake event opens online fallback without requiring ASR to hear the wake phrase', async () => {
  transcript = '你能介绍一下吗';
  const response = await runVoicePipeline({
    ...base, inputSource: 'DEVICE_AUDIO', audioBase64: 'Zml4dHVyZQ==', mimeType: 'audio/wav',
    requireWakeWord: true, ciWakeAcknowledged: true,
  });
  assert.notEqual(response.route, 'UNRESOLVED');
  assert.equal(modelCalls.length, 1);
  assert.notEqual(response.replyText, '我在');
});

test('a new hardware CI wake starts fresh context while later utterances continue it', async () => {
  const deviceInput = { ...base, inputSource: 'DEVICE_AUDIO', audioBase64: 'Zml4dHVyZQ==',
    mimeType: 'audio/wav', requireWakeWord: false, ciWakeAcknowledged: true };
  transcript = '我叫小林';
  const first = await runVoicePipeline({ ...deviceInput, ciWakeStart: true });
  transcript = '我叫什么';
  const followUp = await runVoicePipeline(deviceInput);
  assert.equal(followUp.conversationId, first.conversationId);
  assert.equal(modelCalls[1].history?.[0].content, '我叫小林');

  transcript = '我们重新开始';
  const secondWake = await runVoicePipeline({ ...deviceInput, ciWakeStart: true });
  assert.notEqual(secondWake.conversationId, first.conversationId);
  assert.deepEqual(modelCalls[2].history, []);
  transcript = '刚才说了什么';
  const secondFollowUp = await runVoicePipeline(deviceInput);
  assert.equal(secondFollowUp.conversationId, secondWake.conversationId);
  assert.equal(modelCalls[3].history?.[0].content, '我们重新开始');
});

test('only CI-acknowledged device audio can start a new CI conversation', async () => {
  await assert.rejects(() => runVoicePipeline({ ...base, text: '你好', ciWakeStart: true }));
  await assert.rejects(() => runVoicePipeline({ ...base, inputSource: 'DEVICE_AUDIO',
    audioBase64: 'Zml4dHVyZQ==', ciWakeStart: true }));
  assert.equal(modelCalls.length, 0);
});

test('device audio writes text-only production PostgreSQL history when explicitly enabled', async () => {
  const previous = process.env.VOICE_HISTORY_BACKEND;
  process.env.VOICE_HISTORY_BACKEND = 'postgres';
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const responses: Array<unknown[]> = [[], [{ id: '498af7d8-47db-446a-99d5-82f2ea6080c3' }], [{
    id: '269d9a5e-4576-4a32-a897-928ad0f6bd3f',
    session_id: '498af7d8-47db-446a-99d5-82f2ea6080c3',
    input_text: '你好吗', reply_text: '测试模型回复', route: 'LLM', usage: {},
    created_at: new Date(),
  }], []];
  const client = { query: async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    return { rows: responses.shift() ?? [] };
  }, release: () => undefined };
  setProductionVoiceHistoryPool({ connect: async () => client } as unknown as Pool);
  try {
    transcript = '你好吗';
    const response = await runVoicePipeline({ ...base, inputSource: 'DEVICE_AUDIO',
      audioBase64: 'Zml4dHVyZQ==', mimeType: 'audio/wav',
      requireWakeWord: true, ciWakeAcknowledged: true }, { recordProductionHistory: true });
    assert.equal(response.route, 'LLM');
    const sessionInsert = calls.find((call) => call.sql.includes('INSERT INTO dongxin.voice_sessions'));
    assert.equal(sessionInsert?.values?.[2], 'device');
    const insert = calls.find((call) => call.sql.includes('INSERT INTO dongxin.voice_turns'));
    assert.equal(insert?.values?.[2], '你好吗');
    assert.equal(insert?.values?.[3], '测试模型回复');
    assert.equal(JSON.stringify(insert?.values).includes('Zml4dHVyZQ=='), false);
  } finally {
    setProductionVoiceHistoryPool(null);
    if (previous === undefined) delete process.env.VOICE_HISTORY_BACKEND;
    else process.env.VOICE_HISTORY_BACKEND = previous;
  }
});

test('CI wake acknowledgement heard by the C3 microphone is not answered or remembered', async () => {
  const deviceInput = { ...base, inputSource: 'DEVICE_AUDIO', audioBase64: 'Zml4dHVyZQ==',
    mimeType: 'audio/wav', requireWakeWord: true, ciWakeAcknowledged: true };
  transcript = '我在。';
  const echo = await runVoicePipeline(deviceInput);
  assert.equal(echo.replyText, '');
  assert.equal(echo.commandRecord, null);
  assert.equal(modelCalls.length, 0);
  assert.equal(ttsCalls.length, 0);
  transcript = '你能介绍一下吗';
  const next = await runVoicePipeline(deviceInput);
  assert.equal(next.conversationId, echo.conversationId);
  assert.equal(modelCalls[0].history?.length, 0);
});

test('ASR-only runs no LLM, TTS or conversation', async () => {
  transcript = '麦克风测试';
  const result = await runVoicePipeline({ ...base, inputSource: 'DEVICE_AUDIO', audioBase64: 'Zml4dHVyZQ==', testMode: 'ASR_ONLY' });
  assert.equal(result.transcript, transcript);
  assert.equal(result.conversationId, undefined);
  assert.equal(modelCalls.length, 0);
  assert.equal(ttsCalls.length, 0);
});

test('LLM module test preserves context independently, and failed turns are not remembered', async () => {
  const first = await runLlmModuleTest({ deviceId: base.deviceId, text: '我叫小林' });
  failModel = true;
  const failed = await runLlmModuleTest({ deviceId: base.deviceId, text: '失败内容', conversationId: first.conversationId });
  assert.ok(failed.error);
  failModel = false;
  await runLlmModuleTest({ deviceId: base.deviceId, text: '我叫什么', conversationId: first.conversationId });
  assert.equal(modelCalls[2].history?.length, 2);
  assert.equal(modelCalls[2].history?.[0].content, '我叫小林');
  await runVoicePipeline({ ...base, text: '另一个问题' });
  assert.deepEqual(modelCalls[3].history, []);
});

test('test parameters limit model context and do not bypass command safety', async () => {
  const first = await runLlmModuleTest({ deviceId: base.deviceId, text: '先记住这句' });
  await runLlmModuleTest({ deviceId: base.deviceId, text: '再记住这句', conversationId: first.conversationId });
  await runLlmModuleTest({ deviceId: base.deviceId, text: '最后测试', conversationId: first.conversationId,
    llmTemperature: 0.4, llmMaxOutputTokens: 768, llmHistoryTurns: 1 });
  assert.equal(modelCalls[2].temperature, 0.4);
  assert.equal(modelCalls[2].maxOutputTokens, 768);
  assert.equal(modelCalls[2].history?.length, 2);
  await runLlmModuleTest({ deviceId: base.deviceId, text: '无历史', conversationId: first.conversationId, llmHistoryTurns: 0 });
  assert.deepEqual(modelCalls[3].history, []);
});

test('LLM test injects fixed context and a bounded state copy without changing the device or playing audio', async () => {
  const priorState = structuredClone(state);
  const response = await runLlmModuleTest({
    deviceId: base.deviceId,
    text: '东信在哪里',
    knowledgeContext: '测试资料：东信位于嘉兴。',
    deviceStatePatch: { isOnline: false, faultCode: 'E01' },
  });
  assert.equal(modelCalls.length, 1);
  assert.equal(modelCalls[0].knowledgeContext, '测试资料：东信位于嘉兴。');
  assert.equal(modelCalls[0].deviceState.isOnline, false);
  assert.equal(modelCalls[0].deviceState.faultCode, 'E01');
  assert.equal(response.evaluatedDeviceState.isOnline, false);
  assert.equal(response.evaluatedDeviceState.faultCode, 'E01');
  assert.deepEqual(state, priorState);
  assert.equal(response.safetyResult.commands.length, 0);
  assert.deepEqual(ttsCalls, []);
});
