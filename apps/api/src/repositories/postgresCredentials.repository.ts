import { createHash, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

type CredentialRow = { secret_hash: Buffer; enabled: boolean };
const missingHash = Buffer.alloc(32);

export async function verifyPostgresDeviceCredential(
  pool: Pool, deviceId: string, secret: string,
): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(deviceId) || secret.length < 20 || secret.length > 256) return false;
  const result = await pool.query<CredentialRow>(
    'SELECT secret_hash, enabled FROM dongxin.device_credentials WHERE device_id = $1',
    [deviceId],
  );
  const credential = result.rows[0];
  const expected = credential?.secret_hash;
  const actual = createHash('sha256').update(secret).digest();
  const matches = timingSafeEqual(actual, Buffer.isBuffer(expected) && expected.length === 32 ? expected : missingHash);
  return credential?.enabled === true && matches;
}

export async function provisionPostgresDevice(
  pool: Pool,
  input: { deviceId: string; model: string; name: string; secret: string },
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.deviceId) || input.deviceId === 'dongxin-api-gateway' ||
      !input.model.trim() || input.model.length > 128 ||
      !input.name.trim() || input.name.length > 128 ||
      input.secret.length < 20 || input.secret.length > 256) {
    throw new Error('Invalid device provisioning input');
  }
  const secretHash = createHash('sha256').update(input.secret).digest();
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO dongxin.devices (id, model, name, protocol, status)
       VALUES ($1, $2, $3, 'MQTT', 'OFFLINE')`,
      [input.deviceId, input.model, input.name],
    );
    await client.query(
      `INSERT INTO dongxin.device_credentials (device_id, secret_hash, enabled)
       VALUES ($1, $2, true)`,
      [input.deviceId, secretHash],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
