import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { brokerPostgresConfig, verifyBrokerDeviceCredential } from './postgresCredentials.js';

const secret = 'fixture-unique-device-secret-0001';
const pem = '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----';

test('MQTT credential store requires a verified PostgreSQL TLS configuration', () => {
  const env = { DATABASE_URL: 'postgresql://broker:secret@rds.example:5432/dongxin', DATABASE_CA_FILE: 'rds-ca.pem' };
  const config = brokerPostgresConfig(env, () => pem);
  assert.equal(config.ssl && typeof config.ssl === 'object' && config.ssl.rejectUnauthorized, true);
  assert.equal(config.max, 8);
  assert.throws(() => brokerPostgresConfig({ ...env, DATABASE_URL: `${env.DATABASE_URL}?sslmode=disable` }, () => pem), /query parameters/);
  assert.throws(() => brokerPostgresConfig(env, () => 'invalid'), /PEM certificate/);
  assert.throws(() => brokerPostgresConfig({ DATABASE_URL: env.DATABASE_URL }, () => pem), /DATABASE_CA_FILE/);
});

test('MQTT local PostgreSQL access is loopback-only', () => {
  const env = { DATABASE_URL: 'postgresql://broker:secret@127.0.0.1:5432/dongxin', DATABASE_TLS_MODE: 'local' };
  const config = brokerPostgresConfig(env);
  assert.equal(config.ssl, false);
  assert.throws(() => brokerPostgresConfig({ ...env, DATABASE_URL: env.DATABASE_URL.replace('127.0.0.1', 'db.example') }), /127\.0\.0\.1/);
  assert.throws(() => brokerPostgresConfig({ ...env, DATABASE_CA_FILE: 'ca.pem' }), /no DATABASE_CA_FILE/);
});

test('MQTT devices authenticate only against their own enabled digest', async () => {
  const calls: string[] = [];
  const pool = { query: async (_sql: string, values: string[]) => {
    calls.push(values[0]);
    return { rows: values[0] === 'DX-001'
      ? [{ secret_hash: createHash('sha256').update(secret).digest(), enabled: true }]
      : [] };
  } } as unknown as Pool;
  assert.equal(await verifyBrokerDeviceCredential(pool, 'DX-001', secret), true);
  assert.equal(await verifyBrokerDeviceCredential(pool, 'DX-002', secret), false);
  assert.equal(await verifyBrokerDeviceCredential(pool, 'DX-001', 'wrong-secret-with-minimum-length'), false);
  assert.equal(await verifyBrokerDeviceCredential(pool, 'invalid/device', secret), false);
  assert.deepEqual(calls, ['DX-001', 'DX-002', 'DX-001']);
});
