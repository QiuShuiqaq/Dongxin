import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AiResult } from '@dongxin/shared';
import { ConversationStore, isConversationEnd } from './conversation.service.js';

const scope = { deviceId: 'test-device', channel: 'pipeline' as const };
const aiResult: AiResult = { resultType: 'CHAT', intent: null, confidence: 1, slots: {}, requiresConfirm: false, speak: '记住了' };
const turn = (text: string) => ({ text, aiResult, replyText: aiResult.speak });

test('context continues within device and channel, then resets or expires', async () => {
  let now = 0;
  const store = new ConversationStore(() => now, 100);
  const id = await store.run(scope, {}, async (ctx) => ({ value: ctx.id, turn: turn('我叫小林') }));
  await store.run(scope, { conversationId: id }, async (ctx) => {
    assert.equal(ctx.messages[0].content, '我叫小林');
    assert.equal(JSON.parse(ctx.messages[1].content).executionStatus, 'NOT_EXECUTED');
    return { value: null };
  });
  await assert.rejects(store.run({ ...scope, deviceId: 'other' }, { conversationId: id }, async () => ({ value: null })), /不属于/);
  const llmId = await store.run({ ...scope, channel: 'llm-test' }, {}, async (ctx) => ({ value: ctx.id }));
  assert.notEqual(llmId, id);
  store.reset(scope);
  const newId = await store.run(scope, { conversationId: id }, async (ctx) => {
    assert.equal(ctx.messages.length, 0);
    return { value: ctx.id };
  });
  assert.notEqual(newId, id);
  now = 101;
  await store.run(scope, { conversationId: newId }, async (ctx) => {
    assert.notEqual(ctx.id, newId);
    assert.equal(ctx.messages.length, 0);
    return { value: null };
  });
});

test('device auto-resume uses recent turns, with a bounded twelve-turn window', async () => {
  const store = new ConversationStore();
  const id = await store.run(scope, {}, async (ctx) => ({ value: ctx.id }));
  for (let i = 0; i < 14; i++) {
    await store.run(scope, { resumeLatest: true }, async (ctx) => ({ value: null, turn: turn(`第${i}轮`) }));
  }
  await store.run(scope, { conversationId: id }, async (ctx) => {
    assert.equal(ctx.messages.length, 24);
    assert.equal(ctx.messages[0].content, '第2轮');
    return { value: null, end: true };
  });
  await store.run(scope, { resumeLatest: true }, async (ctx) => {
    assert.notEqual(ctx.id, id);
    assert.equal(ctx.messages.length, 0);
    return { value: null };
  });
  assert.ok(isConversationEnd('再见。'));
  assert.equal(isConversationEnd('再见之前告诉我怎么清洁'), false);
});

test('same-conversation requests serialize; failed turns do not poison history', async () => {
  const store = new ConversationStore();
  const id = await store.run(scope, {}, async (ctx) => ({ value: ctx.id }));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = store.run(scope, { conversationId: id }, async () => { await gate; return { value: 1, turn: turn('第一句') }; });
  const second = store.run(scope, { conversationId: id }, async (ctx) => {
    assert.equal(ctx.messages[0].content, '第一句');
    return { value: 2 };
  });
  release();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  await assert.rejects(store.run(scope, { conversationId: id }, async () => { throw new Error('fixture failure'); }));
  await store.run(scope, { conversationId: id }, async (ctx) => {
    assert.equal(ctx.messages.length, 2);
    return { value: null };
  });
});

test('reset during an in-flight request cannot restore the old conversation', async () => {
  const store = new ConversationStore();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const running = store.run(scope, {}, async (ctx) => { entered(); await gate; return { value: ctx.id, turn: turn('旧内容') }; });
  await started;
  store.reset(scope);
  release();
  const oldId = await running;
  await store.run(scope, { resumeLatest: true }, async (ctx) => {
    assert.notEqual(ctx.id, oldId);
    assert.deepEqual(ctx.messages, []);
    return { value: null };
  });
});
