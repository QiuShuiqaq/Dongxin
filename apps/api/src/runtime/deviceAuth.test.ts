import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { FastifyRequest } from 'fastify';
import { assertDeviceAuthConfiguration, authenticateDeviceRequest, getProvisionedDeviceModel, setDeviceCredentialPool } from '../services/deviceAuth.service.js';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';

const original = { NODE_ENV: process.env.NODE_ENV, DEVICE_AUTH_MODE: process.env.DEVICE_AUTH_MODE, DEVICE_HTTP_CREDENTIALS: process.env.DEVICE_HTTP_CREDENTIALS, DEVICE_AUTH_BACKEND: process.env.DEVICE_AUTH_BACKEND, DATABASE_URL: process.env.DATABASE_URL, DATABASE_CA_FILE: process.env.DATABASE_CA_FILE, DATABASE_TLS_MODE: process.env.DATABASE_TLS_MODE };
const secret = 'fixture-only-device-one-secret';
const request = (deviceId = 'one', token = secret, body?: unknown, query?: unknown) => ({ headers: { 'x-device-id': deviceId, authorization: `Bearer ${token}` }, body, query }) as unknown as FastifyRequest;
const code = (value: string) => (error: unknown) => (error as { code?: string }).code === value;
afterEach(() => { setDeviceCredentialPool(null); for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

test('production refuses missing, short and shared device credentials', () => {
  process.env.NODE_ENV = 'production';
  process.env.DEVICE_AUTH_MODE = 'optional';
  delete process.env.DEVICE_HTTP_CREDENTIALS;
  assert.throws(assertDeviceAuthConfiguration, /requires/);
  process.env.DEVICE_HTTP_CREDENTIALS = JSON.stringify({ one: 'short' });
  assert.throws(assertDeviceAuthConfiguration, /20\+/);
  process.env.DEVICE_HTTP_CREDENTIALS = JSON.stringify({ one: secret, two: secret });
  assert.throws(assertDeviceAuthConfiguration, /independent/);
});

test('a valid credential cannot register or query a different device', async () => {
  process.env.DEVICE_AUTH_MODE = 'required';
  process.env.DEVICE_HTTP_CREDENTIALS = JSON.stringify({ one: secret });
  await assert.doesNotReject(authenticateDeviceRequest(request('one', secret, { deviceId: 'one' })));
  await assert.rejects(authenticateDeviceRequest(request('one', secret, { deviceId: 'two' })), code('DEVICE_ID_MISMATCH'));
  await assert.rejects(authenticateDeviceRequest(request('one', secret, undefined, { deviceId: 'two' })), code('DEVICE_ID_MISMATCH'));
  await assert.rejects(authenticateDeviceRequest(request('one', 'invalid')), code('DEVICE_UNAUTHORIZED'));
  await assert.rejects(authenticateDeviceRequest(request('constructor')), code('DEVICE_UNAUTHORIZED'));
});

test('JSON hardware pilot rejects a provisioned fleet larger than twenty devices', () => {
  process.env.NODE_ENV = 'production';
  process.env.DEVICE_HTTP_CREDENTIALS = JSON.stringify(Object.fromEntries(
    Array.from({ length: 21 }, (_, index) => [`device-${index}`, `fixture-secret-for-device-${index}`]),
  ));
  assert.throws(assertDeviceAuthConfiguration, /limited to 20/);
});

test('PostgreSQL authentication verifies a per-device digest and still binds parsed body identity', async () => {
  process.env.DEVICE_AUTH_MODE = 'optional';
  process.env.DEVICE_AUTH_BACKEND = 'postgres';
  process.env.DATABASE_URL = 'postgresql://fixture:secret@127.0.0.1/dongxin';
  process.env.DATABASE_TLS_MODE = 'local';
  delete process.env.DATABASE_CA_FILE;
  const calls: string[] = [];
  setDeviceCredentialPool({ query: async (_sql: string, values: string[]) => {
    calls.push(values[0]);
    return { rows: values[0] === 'one' ? [{ secret_hash: createHash('sha256').update(secret).digest(), enabled: true }] : [] };
  } } as unknown as Pool);
  assert.doesNotThrow(assertDeviceAuthConfiguration);
  const verified = request('one', secret);
  await authenticateDeviceRequest(verified);
  (verified as unknown as { body: unknown }).body = { deviceId: 'two' };
  await assert.rejects(authenticateDeviceRequest(verified), code('DEVICE_ID_MISMATCH'));
  assert.deepEqual(calls, ['one']);
  await assert.rejects(authenticateDeviceRequest(request('two', secret)), code('DEVICE_UNAUTHORIZED'));
  await assert.rejects(authenticateDeviceRequest(request('one', 'wrong-secret-with-minimum-length')), code('DEVICE_UNAUTHORIZED'));
});

test('local database authentication accepts loopback without a CA but rejects remote cleartext', () => {
  process.env.DEVICE_AUTH_BACKEND = 'postgres';
  process.env.DATABASE_TLS_MODE = 'local';
  process.env.DATABASE_URL = 'postgresql://fixture:secret@127.0.0.1/dongxin';
  delete process.env.DATABASE_CA_FILE;
  assert.doesNotThrow(assertDeviceAuthConfiguration);
  process.env.DATABASE_URL = 'postgresql://fixture:secret@db.invalid/dongxin';
  assert.throws(assertDeviceAuthConfiguration, /requires 127\.0\.0\.1/);
});

test('PostgreSQL registration model comes from the provisioned device row', async () => {
  process.env.DEVICE_AUTH_BACKEND = 'postgres';
  setDeviceCredentialPool({ query: async (_sql: string, values: string[]) => ({
    rows: values[0] === 'one' ? [{ model: 'DX-PROVISIONED' }] : [],
  }) } as unknown as Pool);
  assert.equal(await getProvisionedDeviceModel('one'), 'DX-PROVISIONED');
  await assert.rejects(getProvisionedDeviceModel('two'), /no provisioned model/);
  setDeviceCredentialPool(null);
  await assert.rejects(getProvisionedDeviceModel('one'), /not initialized/);
});
