import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';

// First installation only. Keep this interactive command inside the server terminal.
const configPath = '/etc/dongxin/api.env';
const args = process.argv.slice(2);
const passwordFile = args[0] === '--generate-password-file' ? args[1] : undefined;
if (args.length && (args.length !== 2 || !passwordFile || !isAbsolute(passwordFile))) {
  throw new Error('Usage: configure-pilot.mjs [--generate-password-file /absolute/private/path]');
}
const template = await readFile(new URL('./api.env.example', import.meta.url), 'utf8');
try {
  await readFile(configPath);
  throw new Error('Configuration already exists; edit it privately instead of regenerating credentials');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
let passwordHash;
let generatedPassword;
if (passwordFile) {
  generatedPassword = randomBytes(24).toString('base64url');
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(generatedPassword, salt, 210_000, 32, 'sha256').toString('base64url');
  passwordHash = `pbkdf2$210000$${salt.toString('base64url')}$${digest}`;
  await writeFile(passwordFile, `URL: http://127.0.0.1:8080\nUsername: admin\nPassword: ${generatedPassword}\n`, { flag: 'wx', mode: 0o600 });
} else {
  const hash = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/hash-operations-password.mjs', import.meta.url))], {
    stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8',
  });
  if (hash.error) throw hash.error;
  if (hash.status !== 0) throw new Error('Password setup cancelled or failed');
  passwordHash = hash.stdout.trim();
}
const values = {
  OPS_ADMIN_PASSWORD_HASH: passwordHash,
  OPS_AUTH_TOKEN_SECRET: randomBytes(48).toString('base64url'),
  // Deny all real devices until individual provisioning is completed in the next phase.
  DEVICE_HTTP_CREDENTIALS: JSON.stringify({ 'cloud-pilot-unpaired': randomBytes(32).toString('base64url') }),
};
const configured = template.split('\n').map((line) => {
  const name = line.split('=', 1)[0];
  return Object.hasOwn(values, name) ? `${name}=${values[name]}` : line;
}).join('\n');
try {
  await writeFile(configPath, configured, { flag: 'wx', mode: 0o600 });
} catch (error) {
  if (passwordFile && error.code === 'EEXIST') await unlink(passwordFile);
  throw error;
}
console.log('Created /etc/dongxin/api.env. Administrator: admin. Secrets were not printed.');
if (passwordFile) console.log(`Generated login saved privately to ${passwordFile}; deliver securely to the administrator.`);
