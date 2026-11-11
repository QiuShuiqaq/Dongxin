import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'linux' || process.getuid?.() !== 0) {
  throw new Error('Run as root on the ECS');
}
const config = readFileSync('/etc/dongxin/db-app.env', 'utf8');
const databaseUrl = config.match(/^DATABASE_URL=(.+)$/m)?.[1];
if (!databaseUrl || !/^DATABASE_TLS_MODE=local$/m.test(config)) {
  throw new Error('Local application database configuration is incomplete');
}
const url = new URL(databaseUrl);
if (url.hostname !== '127.0.0.1' || url.pathname !== '/dongxin' || url.username !== 'dongxin_app') {
  throw new Error('Unexpected application database target');
}
const query = `
SELECT count(*) FROM dongxin.schema_migrations;
SELECT has_schema_privilege(current_user, 'dongxin', 'USAGE');
SELECT has_schema_privilege(current_user, 'dongxin', 'CREATE');
SELECT has_table_privilege(current_user, 'dongxin.devices', 'SELECT,INSERT,UPDATE,DELETE');
`;
const result = spawnSync('/usr/pgsql-17/bin/psql', [
  '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1',
  '-U', url.username, '-d', 'dongxin',
], { input: query, encoding: 'utf8', env: {
  ...process.env, PGPASSWORD: decodeURIComponent(url.password),
} });
if (result.error || result.status !== 0) {
  throw new Error('Application database connection or permission check failed');
}
const values = result.stdout.trim().split(/\s+/);
if (values.join(',') !== '3,t,f,t') {
  throw new Error(`Unexpected database role permissions: ${values.join(',')}`);
}
console.log('Application role authenticated locally; 3 migrations, schema usage and table DML verified; schema CREATE denied.');
