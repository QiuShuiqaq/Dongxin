import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isAbsolute, relative, resolve } from 'node:path';
import type { Pool } from 'pg';
import { createPostgresPool } from '../runtime/postgres.js';
import { provisionPostgresDevice } from '../repositories/postgresCredentials.repository.js';

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index];
  const value = process.argv[index + 1];
  if (!flag?.startsWith('--') || !value || value.startsWith('--')) {
    throw new Error('Usage: db:provision-device --device-id ID --model MODEL --secret-out ABSOLUTE_PATH');
  }
  args.set(flag, value);
}
const deviceId = args.get('--device-id');
const model = args.get('--model');
const secretOut = args.get('--secret-out');
if (!deviceId || !model || !secretOut || !isAbsolute(secretOut) || args.size !== 3) {
  throw new Error('Usage: db:provision-device --device-id ID --model MODEL --secret-out ABSOLUTE_PATH');
}
const outputPath = resolve(secretOut);
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const withinRepo = relative(repoRoot, outputPath);
if (!withinRepo.startsWith('..') && !isAbsolute(withinRepo)) {
  throw new Error('The device secret file must be outside the Git repository');
}

const secret = randomBytes(32).toString('base64url');
const name = `东信浴霸 ${deviceId}`;
// Reserve the output path before committing the credential, so a successful
// database insert never leaves an unrecoverable secret.
await writeFile(outputPath, `${JSON.stringify({ deviceId, model, deviceSecret: secret })}\n`, {
  encoding: 'utf8', flag: 'wx', mode: 0o600,
});
let pool: Pool | null = null;
try {
  pool = createPostgresPool();
  await provisionPostgresDevice(pool, { deviceId, model, name, secret });
  console.log(`Provisioned ${deviceId}. Secret written to ${outputPath}; transfer it securely to the device.`);
} catch (error) {
  await unlink(outputPath);
  throw error;
} finally {
  await pool?.end();
}
