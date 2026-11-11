import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { prunePostgresTextBatch, runPostgresRetention } from './postgresRetention.repository.js';

test('retention deletes only a bounded oldest-first batch from an allowlisted table', async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = { query: async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    return { rowCount: 500 };
  } } as unknown as Pool;
  const cutoff = new Date('2026-08-01T00:00:00.000Z');
  assert.equal(await prunePostgresTextBatch(pool, 'voiceTurns', cutoff), 500);
  assert.match(calls[0]!.sql, /DELETE FROM dongxin\.voice_turns/);
  assert.match(calls[0]!.sql, /ORDER BY created_at ASC LIMIT \$2/);
  assert.deepEqual(calls[0]?.values, [cutoff, 500]);
  await assert.rejects(prunePostgresTextBatch(pool, 'voiceTurns', cutoff, 1001), /batch size/);
  await assert.rejects(prunePostgresTextBatch(pool, 'knowledgeRevisions' as never, cutoff), /Unsupported/);
});

test('retention runner visits only approved tables and stops after short batches', async () => {
  const tables: string[] = [];
  const pool = { query: async (sql: string) => {
    tables.push(sql.match(/DELETE FROM dongxin\.(\w+)/)?.[1] ?? 'unknown');
    return { rowCount: 1 };
  } } as unknown as Pool;
  const removed = await runPostgresRetention(pool, new Date('2026-08-01T00:00:00.000Z'));
  assert.deepEqual(tables, ['voice_turns', 'voice_sessions', 'device_events', 'device_commands', 'audit_logs']);
  assert.deepEqual(removed, { deviceEvents: 1, voiceTurns: 1, voiceSessions: 1, deviceCommands: 1, auditLogs: 1 });
  await assert.rejects(runPostgresRetention(pool, new Date(), 101), /batch count/);
});
