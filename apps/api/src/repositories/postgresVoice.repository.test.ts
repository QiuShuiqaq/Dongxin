import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import {
  appendPostgresVoiceTurn,
  listPostgresVoiceTurns,
  pagePostgresDeviceVoiceTurns,
  pagePostgresVoiceSessions,
} from './postgresVoice.repository.js';

const sessionId = '498af7d8-47db-446a-99d5-82f2ea6080c3';
const turnId = '269d9a5e-4576-4a32-a897-928ad0f6bd3f';
const createdAt = new Date('2026-10-31T12:00:00.000Z');
const row = { id: turnId, session_id: sessionId, input_text: '你好', reply_text: '我在', route: 'RULE', usage: {}, created_at: createdAt };

function poolWith(responses: Array<unknown[]>) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return { rows: responses.shift() ?? [] };
    },
    release: () => undefined,
  };
  return { pool: { query: client.query, connect: async () => client } as unknown as Pool, calls };
}

test('voice text turn and session scope are committed in one transaction', async () => {
  const fixture = poolWith([[], [{ id: sessionId }], [row], []]);
  const saved = await appendPostgresVoiceTurn(fixture.pool, {
    sessionId, deviceId: 'DX-001', channel: 'pipeline', inputText: '你好', replyText: '我在', route: 'RULE',
  });
  assert.equal(saved.replyText, '我在');
  assert.equal(fixture.calls[0]?.sql, 'BEGIN');
  assert.match(fixture.calls[1]!.sql, /WHERE dongxin\.voice_sessions\.device_id = EXCLUDED\.device_id/);
  assert.match(fixture.calls[1]!.sql, /AND dongxin\.voice_sessions\.channel = EXCLUDED\.channel/);
  assert.equal(fixture.calls.at(-1)?.sql, 'COMMIT');
  assert.equal(fixture.calls[2]?.values?.[1], sessionId);
});

test('a cross-device session conflict rolls back before writing any turn', async () => {
  const fixture = poolWith([[], [], []]);
  await assert.rejects(appendPostgresVoiceTurn(fixture.pool, {
    sessionId, deviceId: 'DX-002', channel: 'pipeline', inputText: '你好', replyText: '我在', route: 'RULE',
  }), /scope mismatch/);
  assert.equal(fixture.calls.some((call) => call.sql.includes('INSERT INTO dongxin.voice_turns')), false);
  assert.equal(fixture.calls.at(-1)?.sql, 'ROLLBACK');
});

test('history queries are device scoped, bounded and chronological', async () => {
  const fixture = poolWith([[row]]);
  const turns = await listPostgresVoiceTurns(fixture.pool, 'DX-001', sessionId, 24);
  assert.equal(turns[0]?.inputText, '你好');
  assert.deepEqual(fixture.calls[0]?.values, [sessionId, 'DX-001', 24]);
  assert.match(fixture.calls[0]!.sql, /LIMIT \$3/);
  await assert.rejects(listPostgresVoiceTurns(fixture.pool, 'DX-001', sessionId, 1000), /limit/);
});

test('voice usage cannot carry raw audio or arbitrary metadata into the database', async () => {
  const fixture = poolWith([]);
  await assert.rejects(appendPostgresVoiceTurn(fixture.pool, {
    sessionId, deviceId: 'DX-001', channel: 'pipeline', inputText: '你好', replyText: '我在', route: 'RULE',
    usage: { audioBase64: 'not-allowed' } as never,
  }), /unrecognized_key/);
  assert.equal(fixture.calls.length, 0);
});

test('voice history page is bounded, device scoped and loads only recent text turns', async () => {
  const fixture = poolWith([[{
    id: sessionId, device_id: 'DX-001', channel: 'pipeline',
    created_at: createdAt, updated_at: createdAt,
  }], [row]]);
  const sessions = await pagePostgresVoiceSessions(fixture.pool, 'DX-001', 20, 40);
  assert.equal(sessions[0]?.turns[0]?.inputText, '你好');
  assert.deepEqual(fixture.calls[0]?.values, ['DX-001', 20, 40]);
  assert.deepEqual(fixture.calls[1]?.values, [[sessionId]]);
  assert.match(fixture.calls[1]!.sql, /row_number\(\) OVER \(PARTITION BY session_id/);
  assert.match(fixture.calls[1]!.sql, /rn <= 100/);
  await assert.rejects(pagePostgresVoiceSessions(fixture.pool, undefined, 101, 0), /page/);
  await assert.rejects(pagePostgresVoiceSessions(fixture.pool, undefined, 20, -1), /page/);
});

test('production voice turns use the device channel and strict text-only metadata', async () => {
  const productionRow = {
    ...row,
    usage: {
      inputSource: 'DEVICE_AUDIO', result: 'COMPLETED', intent: 'LIGHT_ON',
      safetyDecision: 'APPROVED', commandStatus: 'QUEUED', latencyMs: 42,
      totalCny: 0.001, error: null, externalSessionId: 'external-session-1',
    },
  };
  const fixture = poolWith([[], [{ id: sessionId }], [productionRow], []]);
  await appendPostgresVoiceTurn(fixture.pool, {
    sessionId, deviceId: 'DX-001', channel: 'device', inputText: '打开照明',
    replyText: '已打开照明。', route: 'ONLINE_RULE', usage: productionRow.usage as never,
    sessionTtlMs: 60 * 60_000,
  });
  assert.equal(fixture.calls[1]?.values?.[2], 'device');
  assert.equal(fixture.calls[1]?.values?.[3], 60 * 60_000);
  assert.deepEqual(JSON.parse(String(fixture.calls[2]?.values?.[5])), productionRow.usage);
});

test('production voice history query is filtered, paged and mapped from device turns', async () => {
  const productionRow = {
    ...row,
    device_id: 'DX-001',
    storage_session_id: sessionId,
    usage: {
      inputSource: 'DEVICE_TEXT', result: 'FAILED', intent: null,
      safetyDecision: null, commandStatus: null, latencyMs: 91,
      totalCny: 0.002, error: 'ASR_FAILED', externalSessionId: 'external-session-2',
    },
  };
  const fixture = poolWith([[{ total: '1' }], [productionRow]]);
  const result = await pagePostgresDeviceVoiceTurns(fixture.pool, {
    deviceId: 'DX-001', result: 'FAILED',
    from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z',
    limit: 10, offset: 20,
  });
  assert.deepEqual(fixture.calls[0]?.values, [
    'DX-001', 'FAILED', '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z',
  ]);
  assert.deepEqual(fixture.calls[1]?.values, [
    'DX-001', 'FAILED', '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 10, 20,
  ]);
  assert.match(fixture.calls[1]!.sql, /s\.channel = 'device'/);
  assert.equal(result.total, 1);
  assert.deepEqual(result.items[0], {
    id: turnId,
    sessionId: 'external-session-2',
    deviceId: 'DX-001',
    inputSource: 'DEVICE_TEXT',
    inputText: row.input_text,
    replyText: row.reply_text,
    route: row.route,
    result: 'FAILED',
    intent: null,
    safetyDecision: null,
    commandStatus: null,
    latencyMs: 91,
    costCny: 0.002,
    error: 'ASR_FAILED',
    createdAt: createdAt.toISOString(),
  });
});
