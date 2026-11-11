import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postgresConfig } from './postgres.js';

const pem = '-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----';

test('PostgreSQL configuration requires credentials and a verified CA', () => {
  assert.throws(() => postgresConfig({}, () => pem), /DATABASE_URL/);
  const env = { DATABASE_URL: 'postgresql://device:secret@rds.example:5432/dongxin', DATABASE_CA_FILE: 'rds-ca.pem' };
  const config = postgresConfig(env, () => pem);
  assert.equal(config.host, 'rds.example');
  assert.equal(config.database, 'dongxin');
  assert.deepEqual(config.ssl, { ca: pem, rejectUnauthorized: true });
  assert.throws(() => postgresConfig({ ...env, DATABASE_URL: `${env.DATABASE_URL}?sslmode=disable` }, () => pem), /query parameters/);
  assert.throws(() => postgresConfig(env, () => 'not a certificate'), /PEM certificate/);
  assert.throws(() => postgresConfig({ DATABASE_URL: env.DATABASE_URL }, () => pem), /DATABASE_CA_FILE/);
});

test('Local PostgreSQL mode is limited to loopback and cannot be combined with a CA', () => {
  const env = { DATABASE_URL: 'postgresql://device:secret@127.0.0.1:5432/dongxin', DATABASE_TLS_MODE: 'local' };
  const config = postgresConfig(env);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.ssl, false);
  assert.throws(() => postgresConfig({ ...env, DATABASE_URL: env.DATABASE_URL.replace('127.0.0.1', 'db.example') }), /127\.0\.0\.1/);
  assert.throws(() => postgresConfig({ ...env, DATABASE_CA_FILE: 'ca.pem' }), /no DATABASE_CA_FILE/);
  assert.throws(() => postgresConfig({ ...env, DATABASE_TLS_MODE: 'off' }), /Invalid DATABASE_TLS_MODE/);
});
