import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { maintainPostgresData, startRuntimeMaintenance } from './maintenance.js';

test('runtime PostgreSQL maintenance applies the text cutoff and counts bounded deletions', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const pool = { query: async (sql: string, values: unknown[]) => {
    calls.push({ sql, values });
    return { rowCount: sql.includes('dongxin.voice_turns') ? 2
      : sql.includes('dongxin.device_events') ? 1 : 0 };
  } } as unknown as Pool;
  const now = Date.parse('2026-10-31T12:00:00.000Z');
  const count = await maintainPostgresData(pool, now);
  assert.equal(count, 3);
  assert.equal(calls.length, 5);
  assert.deepEqual(calls.map((call) => call.values[1]), [500, 500, 500, 500, 500]);
  assert.ok(calls.every((call) => call.values[0] instanceof Date));
  assert.ok(calls.every((call) => (call.values[0] as Date).getTime() === now - 90 * 86400000));
});

test('shutdown waits for an in-flight maintenance run before closing the pool', async () => {
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let started = false;
  const stop = startRuntimeMaintenance(() => undefined, null, async () => {
    started = true;
    await held;
  });
  assert.equal(started, true);
  let stopped = false;
  const closing = stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  release?.();
  await closing;
  assert.equal(stopped, true);
});
