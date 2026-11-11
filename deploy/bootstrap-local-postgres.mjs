import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (process.getuid?.() !== 0 || process.platform !== 'linux') {
  throw new Error('Run this one-time bootstrap as root on Linux');
}

const directory = '/etc/dongxin';
const migrationEnv = `${directory}/db-migrator.env`;
const applicationEnv = `${directory}/db-app.env`;
if (existsSync(migrationEnv) || existsSync(applicationEnv)) {
  throw new Error('Database credential files already exist; refusing to overwrite them');
}

function psql(sql) {
  const result = spawnSync('runuser', [
    '-u', 'postgres', '--', '/usr/pgsql-17/bin/psql', '-X', '-A', '-t',
    '-v', 'ON_ERROR_STOP=1', '-d', 'postgres',
  ], { input: sql, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error('PostgreSQL bootstrap failed; inspect the database state without printing SQL or credentials');
  }
  return result.stdout.trim();
}

const existing = psql("SELECT count(*) FROM pg_roles WHERE rolname IN ('dongxin_migrator', 'dongxin_app'); SELECT count(*) FROM pg_database WHERE datname = 'dongxin';")
  .split(/\s+/).map(Number);
if (existing.length !== 2 || existing.some((count) => count !== 0)) {
  throw new Error('Dongxin database or roles already exist; inspect them before retrying');
}

const migratorPassword = randomBytes(32).toString('hex');
const appPassword = randomBytes(32).toString('hex');
mkdirSync(directory, { recursive: true, mode: 0o700 });
for (const [path, user, password] of [
  [migrationEnv, 'dongxin_migrator', migratorPassword],
  [applicationEnv, 'dongxin_app', appPassword],
]) {
  writeFileSync(path,
    `DATABASE_URL=postgresql://${user}:${password}@127.0.0.1:5432/dongxin\nDATABASE_TLS_MODE=local\n`,
    { flag: 'wx', mode: 0o600 });
}

psql(`
CREATE ROLE dongxin_migrator LOGIN PASSWORD '${migratorPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE dongxin_app LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE DATABASE dongxin OWNER dongxin_migrator;
REVOKE CONNECT ON DATABASE dongxin FROM PUBLIC;
GRANT CONNECT ON DATABASE dongxin TO dongxin_app;
`);
console.log('Created local PostgreSQL database and separate migration/application roles. Credentials were written to restricted server files. API configuration was not changed.');
