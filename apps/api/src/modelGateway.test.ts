import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { DeviceStateSchema, ModelProviderSchema, PromptVersionSchema } from '@dongxin/shared';
import { callModel, MODEL_OUTPUT_CONTRACT, parseAiResult } from './modelGateway.js';

const chat = { resultType: 'CHAT', intent: null, confidence: 0.9, slots: {}, requiresConfirm: false, speak: '我在' };
const state = DeviceStateSchema.parse({ isOnline: true, activeModes: [], targetTemperature: 35, ambientTemperature: 25, hasOccupancy: true, voiceBroadcastEnabled: true, faultCode: null, updatedAt: new Date().toISOString() });
const provider = ModelProviderSchema.parse({ id: 'test', name: 'test', type: 'OPENAI_COMPATIBLE', enabled: true, model: 'test-model', baseUrl: 'https://test.invalid/v1', apiKeyEnv: 'DX_GATEWAY_TEST_KEY', maxOutputTokens: 128, requestBody: { model: 'wrong', messages: [], max_tokens: 1, temperature: 2, response_format: { type: 'text' } } });
const prompt = PromptVersionSchema.parse({ id: 'test', name: 'test', version: 1, status: 'ACTIVE', createdAt: new Date().toISOString(), systemPrompt: '原有设备提示词' });
const originalFetch = globalThis.fetch;
const originalKey = process.env.DX_GATEWAY_TEST_KEY;
process.env.DX_GATEWAY_TEST_KEY = 'fixture-only';
after(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.DX_GATEWAY_TEST_KEY;
  else process.env.DX_GATEWAY_TEST_KEY = originalKey;
});

test('non-control replies normalize intent and cannot retain a command or slots', () => {
  for (const intent of ['CHAT', 'NONE', 'null', '', 'LIGHT_ON', null, undefined]) {
    assert.deepEqual(parseAiResult({ ...chat, intent, slots: { temperature: 40 }, requiresConfirm: true }), chat);
  }
  for (const resultType of ['NEED_CLARIFY', 'NO_ACTION', 'REJECT']) {
    assert.equal(parseAiResult({ ...chat, resultType, intent: 'LIGHT_ON' }).intent, null);
  }
});

test('invalid or missing control intent is rejected without mapping to a command', () => {
  assert.equal(parseAiResult({ ...chat, resultType: 'DEVICE_CONTROL', intent: 'LIGHT_ON' }).intent, 'LIGHT_ON');
  for (const intent of ['TURN_ON_LIGHT', 'CHAT', null, undefined]) {
    assert.throws(() => parseAiResult({ ...chat, resultType: 'DEVICE_CONTROL', intent }), /设备指令未执行/);
  }
  assert.throws(() => parseAiResult({ ...chat, resultType: 'UNKNOWN' }), /resultType/);
  assert.throws(() => parseAiResult({ ...chat, confidence: 'high' }), /confidence/);
});

test('gateway sends history and knowledge with an enforced JSON contract', async () => {
  let body: any;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ message: { content: JSON.stringify({ ...chat, intent: 'CHAT' }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 42, completion_tokens: 20 } });
  };
  const history = [{ role: 'user' as const, content: '我叫小林' }, { role: 'assistant' as const, content: JSON.stringify(chat) }];
  const result = await callModel({ provider, prompt, deviceState: state, inputText: '我叫什么', history, knowledgeContext: '测试产品资料' });
  assert.equal(result.aiResult.intent, null);
  assert.equal(body.model, 'test-model');
  assert.equal(body.temperature, 0);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.ok(body.max_tokens >= 256);
  assert.ok(body.messages[0].content.includes(MODEL_OUTPUT_CONTRACT));
  assert.deepEqual(body.messages.slice(1, 3), history);
  assert.equal(JSON.parse(body.messages[3].content).knowledgeContext, '测试产品资料');
  assert.equal(result.usage.totalTokens, 62);
});

test('truncated and non-JSON model replies fail with readable errors', async () => {
  globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{' } }] });
  await assert.rejects(callModel({ provider, prompt, deviceState: state, inputText: '你好' }), /输出长度上限/);
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: 'plain text' } }] });
  await assert.rejects(callModel({ provider, prompt, deviceState: state, inputText: '你好' }), /完整的 JSON 对象/);
});

test('development-only decoding overrides reach the provider without changing defaults', async () => {
  let body: any;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ message: { content: JSON.stringify(chat) }, finish_reason: 'stop' }] });
  };
  await callModel({ provider, prompt, deviceState: state, inputText: '测试', temperature: 0.6, maxOutputTokens: 768 });
  assert.equal(body.temperature, 0.6);
  assert.equal(body.max_tokens, 768);
  await callModel({ provider, prompt, deviceState: state, inputText: '测试' });
  assert.equal(body.temperature, 0);
});
