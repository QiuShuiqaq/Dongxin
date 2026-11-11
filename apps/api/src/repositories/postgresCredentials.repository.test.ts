import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { provisionPostgresDevice, verifyPostgresDeviceCredential } from './postgresCredentials.repository.js';

const secret = 'fixture-unique-device-secret-0001';
test('credential lookup is indexed by device ID and compares the stored digest', async () => {
  const calls: Array<{ sql: string; values?: string[] }> = [];
  const pool = { query: async (sql: string, values?: string[]) => {
    calls.push({ sql, values });
    return { rows: [{ secret_hash: createHash('sha256').update(secret).digest(), enabled: true }] };
  } } as unknown as Pool;
  assert.equal(await verifyPostgresDeviceCredential(pool, 'DX-001', secret), true);
  assert.equal(await verifyPostgresDeviceCredential(pool, 'DX-001', 'wrong-secret-with-minimum-length'), false);
  assert.deepEqual(calls[0]?.values, ['DX-001']);
  assert.match(calls[0]!.sql, /WHERE device_id = \$1/);
});

test('disabled, missing and malformed credentials fail closed', async () => {
  const disabled = { query: async () => ({ rows: [{ secret_hash: createHash('sha256').update(secret).digest(), enabled: false }] }) } as unknown as Pool;
  assert.equal(await verifyPostgresDeviceCredential(disabled, 'DX-001', secret), false);
  const missing = { query: async () => ({ rows: [] }) } as unknown as Pool;
  assert.equal(await verifyPostgresDeviceCredential(missing, 'DX-001', secret), false);
  assert.equal(await verifyPostgresDeviceCredential(missing, 'invalid/device', secret), false);
  assert.equal(await verifyPostgresDeviceCredential(missing, 'DX-001', 'short'), false);
});

test('device provisioning stores only a digest with the device in one transaction', async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => { calls.push({ sql, values }); return { rows: [] }; },
    release: () => undefined,
  };
  const pool = { connect: async () => client } as unknown as Pool;
  await provisionPostgresDevice(pool, { deviceId: 'DX-001', model: 'DX-AI-01', name: '设备一', secret });
  assert.deepEqual(calls.map((item) => item.sql.startsWith('INSERT') ? 'INSERT' : item.sql), ['BEGIN', 'INSERT', 'INSERT', 'COMMIT']);
  assert.equal(Buffer.compare(calls[2]!.values?.[1] as Buffer, createHash('sha256').update(secret).digest()), 0);
  assert.equal(JSON.stringify(calls).includes(secret), false);
  await assert.rejects(provisionPostgresDevice(pool, { deviceId: 'dongxin-api-gateway', model: 'DX-AI-01', name: 'reserved', secret }), /Invalid/);
});

test('failed credential insertion rolls back the device record', async () => {
  const calls: string[] = [];
  const client = {
    query: async (sql: string) => {
      calls.push(sql.startsWith('INSERT') ? 'INSERT' : sql);
      if (sql.includes('dongxin.device_credentials')) throw new Error('credential conflict');
      return { rows: [] };
    },
    release: () => undefined,
  };
  const pool = { connect: async () => client } as unknown as Pool;
  await assert.rejects(provisionPostgresDevice(pool, { deviceId: 'DX-001', model: 'DX-AI-01', name: '设备一', secret }), /credential conflict/);
  assert.deepEqual(calls, ['BEGIN', 'INSERT', 'INSERT', 'ROLLBACK']);
});
