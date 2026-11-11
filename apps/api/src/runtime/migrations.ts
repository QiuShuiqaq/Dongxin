import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { Pool } from 'pg';

export interface Migration {
  version: string;
  sha256: string;
  sql: string;
}

export async function loadMigrations(directory = new URL('../../migrations/', import.meta.url)): Promise<Migration[]> {
  const names = (await readdir(directory)).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  const migrations = await Promise.all(names.map(async (name) => {
    const sql = await readFile(new URL(name, directory), 'utf8');
    return { version: name.slice(0, -4), sha256: createHash('sha256').update(sql).digest('hex'), sql };
  }));
  const numbers = migrations.map((migration) => migration.version.slice(0, 3));
  if (new Set(numbers).size !== numbers.length) throw new Error('Duplicate database migration number');
  return migrations;
}

export async function assertMigrationsApplied(pool: Pool, migrations: Migration[]): Promise<void> {
  const relation = await pool.query<{ relation: string | null }>(
    "SELECT to_regclass('dongxin.schema_migrations')::text AS relation",
  );
  if (!relation.rows[0]?.relation) throw new Error('Database migrations have not been applied');
  const existing = await pool.query<{ version: string; sha256: string }>(
    'SELECT version, sha256 FROM dongxin.schema_migrations ORDER BY version',
  );
  const recorded = new Map(existing.rows.map((row) => [row.version, row.sha256.trim()]));
  for (const version of recorded.keys()) {
    if (!migrations.some((migration) => migration.version === version)) {
      throw new Error(`Database contains unknown migration ${version}`);
    }
  }
  for (const migration of migrations) {
    const previous = recorded.get(migration.version);
    if (!previous) throw new Error(`Database migration is missing: ${migration.version}`);
    if (previous !== migration.sha256) {
      throw new Error(`Database migration checksum mismatch: ${migration.version}`);
    }
  }
}

export async function applyMigrations(pool: Pool, migrations: Migration[]): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('dongxin-schema-migrations'))");
    await client.query('CREATE SCHEMA IF NOT EXISTS dongxin');
    await client.query(`CREATE TABLE IF NOT EXISTS dongxin.schema_migrations (
      version text PRIMARY KEY, sha256 char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const existing = await client.query<{ version: string; sha256: string }>(
      'SELECT version, sha256 FROM dongxin.schema_migrations ORDER BY version',
    );
    const recorded = new Map(existing.rows.map((row) => [row.version, row.sha256.trim()]));
    for (const version of recorded.keys()) {
      if (!migrations.some((migration) => migration.version === version)) {
        throw new Error(`Database contains unknown migration ${version}`);
      }
    }
    for (const migration of migrations) {
      const previous = recorded.get(migration.version);
      if (previous && previous !== migration.sha256) {
        throw new Error(`Database migration checksum mismatch: ${migration.version}`);
      }
      if (previous) continue;
      await client.query(migration.sql);
      await client.query('INSERT INTO dongxin.schema_migrations (version, sha256) VALUES ($1, $2)', [
        migration.version, migration.sha256,
      ]);
      applied.push(migration.version);
    }
    await client.query('COMMIT');
    return applied;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
