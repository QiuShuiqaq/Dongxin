import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { appendPostgresDeviceEvent, listPostgresDeviceEvents } from './postgresEvents.repository.js';

const id = '75ba7bee-6f45-429c-833f-d7919076c101';
const at = new Date('2026-10-31T10:00:00.000Z');
const row = { id, device_id: 'device-a', event_id: 'ci-17', event_type: 'VOICE',
  payload: { semanticId: 2 }, occurred_at: at, created_at_cursor: '2026-10-31T10:00:00.000001Z' };

function fixture(responses: Array<unknown[]>) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  return { pool: { query: async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    return { rows: responses.shift() ?? [] };
  } } as unknown as Pool, calls };
}

const input = { deviceId: 'device-a', type: 'VOICE' as const, payload: { semanticId: 2 },
  eventId: 'ci-17', occurredAt: at.toISOString() };

test('new device event is bounded and inserted under its per-device identity', async () => {
  const mock = fixture([[row]]);
  const result = await appendPostgresDeviceEvent(mock.pool, input);
  assert.equal(result.outcome, 'INSERTED');
  assert.equal(result.event.id, id);
  assert.equal(result.event.createdAt, '2026-10-31T10:00:00.000001Z');
  assert.equal(mock.calls[0]?.values?.[1], 'device-a');
  assert.equal(mock.calls[0]?.values?.[2], 'ci-17');
  assert.match(mock.calls[0]!.sql, /ON CONFLICT \(device_id, event_id\)/);
});

test('same event identity and content is idempotent', async () => {
  const mock = fixture([[], [row]]);
  const result = await appendPostgresDeviceEvent(mock.pool, input);
  assert.equal(result.outcome, 'DUPLICATE');
  assert.deepEqual(mock.calls[1]?.values, ['device-a', 'ci-17']);
});

test('same event identity with different content conflicts without overwriting it', async () => {
  const mock = fixture([[], [row]]);
  const result = await appendPostgresDeviceEvent(mock.pool,
    { ...input, payload: { semanticId: 3 } });
  assert.equal(result.outcome, 'CONFLICT');
  assert.equal(result.event.payload.semanticId, 2);
  assert.equal(mock.calls.some((call) => call.sql.startsWith('UPDATE')), false);
});

test('event queries are device-scoped and use a bounded keyset page', async () => {
  const mock = fixture([[row]]);
  const events = await listPostgresDeviceEvents(mock.pool, 'device-a', 20,
    { createdAt: at.toISOString(), id });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.createdAt, '2026-10-31T10:00:00.000001Z');
  assert.deepEqual(mock.calls[0]?.values, ['device-a', 20, at.toISOString(), id]);
  assert.match(mock.calls[0]!.sql, /ORDER BY created_at DESC, id DESC LIMIT \$2/);
  await assert.rejects(listPostgresDeviceEvents(mock.pool, 'device-a', 101), /page size/);
  await assert.rejects(listPostgresDeviceEvents(mock.pool, 'device-a', 10,
    { createdAt: 'bad', id }), /Invalid/);
});

test('oversized and malformed event data is rejected before SQL', async () => {
  const mock = fixture([]);
  await assert.rejects(appendPostgresDeviceEvent(mock.pool,
    { ...input, payload: { raw: 'x'.repeat(9000) } }), /8 KiB/);
  await assert.rejects(appendPostgresDeviceEvent(mock.pool,
    { ...input, eventId: ' ' }), /event ID/);
  await assert.rejects(appendPostgresDeviceEvent(mock.pool,
    { ...input, occurredAt: 'invalid' }), /timestamp/);
  await assert.rejects(appendPostgresDeviceEvent(mock.pool,
    { ...input, payload: { details: { audioBase64: 'AA==' } } }), /Raw audio/);
  assert.equal(mock.calls.length, 0);
});
