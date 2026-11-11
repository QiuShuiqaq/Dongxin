import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { applyMigrations, assertMigrationsApplied, loadMigrations, type Migration } from './migrations.js';

const migration: Migration = { version: '001_core', sha256: 'a'.repeat(64), sql: 'CREATE TABLE example (id int)' };

function fakePool(recorded: Array<{ version: string; sha256: string }> = []) {
  const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const client = {
    query: async (sql: string, values?: readonly unknown[]) => {
      calls.push({ sql, values });
      return { rows: sql.startsWith('SELECT version, sha256') ? recorded : [] };
    },
    release: () => undefined,
  };
  return { pool: { connect: async () => client } as unknown as Pool, calls };
}

test('migration catalog contains the production core tables and no duplicate number', async () => {
  const catalog = await loadMigrations();
  assert.equal(catalog[0]?.version, '001_core');
  assert.match(catalog[0]!.sql, /CREATE TABLE dongxin\.device_commands/);
  assert.match(catalog[0]!.sql, /CREATE TABLE dongxin\.device_credentials/);
  assert.match(catalog[0]!.sql, /CREATE TABLE dongxin\.knowledge_documents/);
  assert.match(catalog[0]!.sql, /CREATE TABLE dongxin\.audit_logs/);
  assert.equal(catalog[1]?.version, '002_local_event_identity');
  assert.match(catalog[1]!.sql, /CREATE UNIQUE INDEX device_events_identity_idx/);
  assert.match(catalog[1]!.sql, /\(device_id, event_id\)/);
  assert.equal(catalog[2]?.version, '003_command_access_indexes');
  assert.match(catalog[2]!.sql, /CREATE INDEX device_commands_delivery_idx/);
});

test('migration application is transactional and idempotent', async () => {
  const first = fakePool();
  assert.deepEqual(await applyMigrations(first.pool, [migration]), ['001_core']);
  assert.equal(first.calls[0]?.sql, 'BEGIN');
  assert.equal(first.calls.at(-1)?.sql, 'COMMIT');
  assert.equal(first.calls.filter((call) => call.sql === migration.sql).length, 1);
  assert.deepEqual(first.calls.find((call) => call.sql.startsWith('INSERT INTO'))?.values, ['001_core', migration.sha256]);

  const second = fakePool([{ version: migration.version, sha256: migration.sha256 }]);
  assert.deepEqual(await applyMigrations(second.pool, [migration]), []);
  assert.equal(second.calls.some((call) => call.sql === migration.sql), false);
});

test('migration drift rolls back without applying SQL', async () => {
  const fixture = fakePool([{ version: migration.version, sha256: 'b'.repeat(64) }]);
  await assert.rejects(applyMigrations(fixture.pool, [migration]), /checksum mismatch/);
  assert.equal(fixture.calls.at(-1)?.sql, 'ROLLBACK');
  assert.equal(fixture.calls.some((call) => call.sql === migration.sql), false);
});

test('startup verifies the complete migration catalog without modifying the schema', async () => {
  const calls: string[] = [];
  const pool = { query: async (sql: string) => {
    calls.push(sql);
    return { rows: sql.startsWith('SELECT to_regclass')
      ? [{ relation: 'dongxin.schema_migrations' }]
      : [{ version: migration.version, sha256: migration.sha256 }] };
  } } as unknown as Pool;
  await assertMigrationsApplied(pool, [migration]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((sql) => sql.startsWith('SELECT')));
});

test('startup fails closed for missing, unknown and changed migrations', async () => {
  const poolWith = (relation: string | null, rows: Array<{ version: string; sha256: string }>) => ({
    query: async (sql: string) => ({ rows: sql.startsWith('SELECT to_regclass') ? [{ relation }] : rows }),
  }) as unknown as Pool;
  await assert.rejects(assertMigrationsApplied(poolWith(null, []), [migration]), /not been applied/);
  await assert.rejects(assertMigrationsApplied(poolWith('present', []), [migration]), /is missing/);
  await assert.rejects(assertMigrationsApplied(poolWith('present', [
    { version: '999_unknown', sha256: 'a'.repeat(64) },
  ]), [migration]), /unknown migration/);
  await assert.rejects(assertMigrationsApplied(poolWith('present', [
    { version: migration.version, sha256: 'b'.repeat(64) },
  ]), [migration]), /checksum mismatch/);
});
