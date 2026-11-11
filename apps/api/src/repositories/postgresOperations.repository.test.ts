import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { getPostgresOperationsMetrics } from './postgresOperations.repository.js';

test('operations metrics aggregate the fleet and bounded recent terminal commands in SQL', async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = { query: async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    return { rows: sql.includes('FROM dongxin.devices WHERE')
      ? [{ total: '100000', online: '42000', fault: '18' }]
      : [{ completed: '25', successful: '23' }] };
  } } as unknown as Pool;
  const now = new Date('2026-10-31T12:00:00.000Z');
  const metrics = await getPostgresOperationsMetrics(pool, now);
  assert.deepEqual(metrics, {
    totalDevices: 100000, onlineDevices: 42000, faultDevices: 18,
    completedCommands24h: 25, commandSuccessRate24h: 92, windowHours: 24,
  });
  assert.match(calls[0]!.sql, /count\(\*\) FILTER \(WHERE status = 'ONLINE' AND last_seen_at >= \$1\)/);
  assert.match(calls[0]!.sql, /protocol <> 'SIMULATOR'/);
  assert.deepEqual(calls[0]!.values, [new Date('2026-10-31T11:25:00.000Z')]);
  assert.match(calls[1]!.sql, /c\.status IN \('APPLIED', 'REJECTED', 'FAILED'\)/);
  assert.match(calls[1]!.sql, /d\.protocol <> 'SIMULATOR' AND d\.model/);
  assert.deepEqual(calls[1]!.values, [new Date('2026-10-30T12:00:00.000Z')]);
});

test('empty command window has a neutral success rate', async () => {
  const pool = { query: async (sql: string) => ({ rows: sql.includes('FROM dongxin.devices WHERE')
    ? [{ total: '0', online: '0', fault: '0' }]
    : [{ completed: '0', successful: '0' }] }) } as unknown as Pool;
  const metrics = await getPostgresOperationsMetrics(pool);
  assert.equal(metrics.commandSuccessRate24h, 100);
  assert.equal(metrics.completedCommands24h, 0);
});
