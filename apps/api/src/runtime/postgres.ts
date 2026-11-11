import { readFileSync } from 'node:fs';
import { Pool, type PoolConfig } from 'pg';

export function postgresConfig(
  env: NodeJS.ProcessEnv = process.env,
  readCa: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): PoolConfig {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL');
  const url = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
      !url.username || !url.password || url.pathname.length < 2) {
    throw new Error('DATABASE_URL must contain a PostgreSQL host, database, user and password');
  }
  if (url.search) throw new Error('DATABASE_URL query parameters are not supported; TLS is configured separately');
  const port = url.port ? Number(url.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PostgreSQL port');
  const tlsMode = env.DATABASE_TLS_MODE || 'verify-ca';
  if (!['verify-ca', 'local'].includes(tlsMode)) throw new Error('Invalid DATABASE_TLS_MODE');
  if (tlsMode === 'local' && (url.hostname !== '127.0.0.1' || env.DATABASE_CA_FILE)) {
    throw new Error('Local PostgreSQL mode requires 127.0.0.1 and no DATABASE_CA_FILE');
  }
  if (tlsMode === 'verify-ca' && !env.DATABASE_CA_FILE) {
    throw new Error('DATABASE_CA_FILE is required for verified PostgreSQL TLS');
  }
  const ca = tlsMode === 'verify-ca' ? readCa(env.DATABASE_CA_FILE!) : null;
  if (ca !== null && !ca.includes('BEGIN CERTIFICATE')) throw new Error('DATABASE_CA_FILE must contain a PEM certificate');
  return {
    host: url.hostname,
    port,
    database: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: ca === null ? false : { ca, rejectUnauthorized: true },
    max: 8,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
  };
}

export function createPostgresPool(env: NodeJS.ProcessEnv = process.env): Pool {
  return new Pool(postgresConfig(env));
}
