import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { appendVoiceHistoryTurn, assertVoiceHistoryConfiguration, listVoiceHistory,
  setVoiceHistoryPool, updateVoiceHistorySessions } from './voiceHistory.repository.js';

const input = {
  conversationId: 'conversation-1', deviceId: 'board-1', channel: 'llm-test' as const,
  turn: { text: '你好', reply: '我在', route: 'LLM', error: null, latencyMs: 120, costCny: 0.001 },
};

test('voice history keeps completed turns after a new conversation starts', () => {
  const first = updateVoiceHistorySessions([], input, '2026-10-27T00:00:00.000Z');
  const second = updateVoiceHistorySessions(first, { ...input, turn: { ...input.turn, text: '继续', reply: '继续说' } }, '2026-10-27T00:01:00.000Z');
  const third = updateVoiceHistorySessions(second, { ...input, conversationId: 'conversation-2' }, '2026-10-27T00:02:00.000Z');
  assert.equal(first[0].turns.length, 1);
  assert.deepEqual(third.map((session) => session.turns.length), [2, 1]);
  assert.equal(third[0].turns[1].text, '继续');
  assert.equal(third[0].turns[0].text, '你好');
});

test('voice history rejects cross-device reuse and prunes records older than 90 days', () => {
  const first = updateVoiceHistorySessions([], input, '2026-01-01T00:00:00.000Z');
  assert.throws(() => updateVoiceHistorySessions(first, { ...input, deviceId: 'board-2' }, '2026-01-02T00:00:00.000Z'), /scope mismatch/);
  const next = updateVoiceHistorySessions(first, { ...input, conversationId: 'conversation-2' }, '2026-10-27T00:00:00.000Z');
  assert.deepEqual(next.map((session) => session.id), ['conversation-2']);
});

test('PostgreSQL voice history fails closed without an initialized pool', async () => {
  const previous = process.env.VOICE_HISTORY_BACKEND;
  const previousUrl = process.env.DATABASE_URL;
  const previousCa = process.env.DATABASE_CA_FILE;
  const previousTls = process.env.DATABASE_TLS_MODE;
  process.env.VOICE_HISTORY_BACKEND = 'postgres';
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_CA_FILE;
  delete process.env.DATABASE_TLS_MODE;
  setVoiceHistoryPool(null);
  try {
    assert.throws(() => assertVoiceHistoryConfiguration(), /DATABASE_URL is required/);
    process.env.DATABASE_URL = 'postgresql://fixture:secret@127.0.0.1/dongxin';
    process.env.DATABASE_TLS_MODE = 'local';
    assert.doesNotThrow(assertVoiceHistoryConfiguration);
    await assert.rejects(listVoiceHistory('board-1'), /not initialized/);
    await assert.rejects(appendVoiceHistoryTurn(input), /not initialized/);
  } finally {
    if (previous === undefined) delete process.env.VOICE_HISTORY_BACKEND;
    else process.env.VOICE_HISTORY_BACKEND = previous;
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousCa === undefined) delete process.env.DATABASE_CA_FILE;
    else process.env.DATABASE_CA_FILE = previousCa;
    if (previousTls === undefined) delete process.env.DATABASE_TLS_MODE;
    else process.env.DATABASE_TLS_MODE = previousTls;
  }
});

test('PostgreSQL voice history reads a bounded page and stores only text metrics', async () => {
  const previous = process.env.VOICE_HISTORY_BACKEND;
  process.env.VOICE_HISTORY_BACKEND = 'postgres';
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const sessionId = '498af7d8-47db-446a-99d5-82f2ea6080c3';
  const at = new Date('2026-10-31T12:00:00.000Z');
  const responses: Array<unknown[]> = [[], [{ id: sessionId }], [{
    id: '269d9a5e-4576-4a32-a897-928ad0f6bd3f', session_id: sessionId,
    input_text: '你好', reply_text: '我在', route: 'LLM',
    usage: { latencyMs: 120, costCny: 0.001 }, created_at: at,
  }], [], [{ id: sessionId, device_id: 'board-1', channel: 'llm-test', created_at: at, updated_at: at }], [{
    id: '269d9a5e-4576-4a32-a897-928ad0f6bd3f', session_id: sessionId,
    input_text: '你好', reply_text: '我在', route: 'LLM',
    usage: { latencyMs: 120, costCny: 0.001 }, created_at: at,
  }]];
  const client = { query: async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    return { rows: responses.shift() ?? [] };
  }, release: () => undefined };
  setVoiceHistoryPool({ query: client.query, connect: async () => client } as unknown as Pool);
  try {
    await appendVoiceHistoryTurn({ ...input, conversationId: sessionId });
    const sessions = await listVoiceHistory('board-1', 10, 5);
    assert.equal(sessions[0]?.turns[0]?.reply, '我在');
    assert.deepEqual(calls[4]?.values, ['board-1', 10, 5]);
    assert.equal(calls[2]?.values?.[2], '你好');
    assert.deepEqual(JSON.parse(String(calls[2]?.values?.[5])), { latencyMs: 120, costCny: 0.001 });
  } finally {
    setVoiceHistoryPool(null);
    if (previous === undefined) delete process.env.VOICE_HISTORY_BACKEND;
    else process.env.VOICE_HISTORY_BACKEND = previous;
  }
});
