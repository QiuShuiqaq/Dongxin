import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { authenticateBrokerIdentity } from './identity.js';

const secret = 'fixture-unique-device-secret-0001';
const gatewayPassword = 'fixture-gateway-password-0001';
const store = { query: async () => ({ rows: [
  { secret_hash: createHash('sha256').update(secret).digest(), enabled: true },
] }) } as unknown as Pool;
const config = {
  gatewayUsername: 'gateway', gatewayPassword,
  deviceCredentials: new Map<string, string>(), credentialPool: store,
};

test('reserved gateway client ID cannot authenticate using a device credential', async () => {
  assert.equal(await authenticateBrokerIdentity('dongxin-api-gateway', 'dongxin-api-gateway', secret, config), false);
  assert.equal(await authenticateBrokerIdentity('dongxin-api-gateway', 'gateway', gatewayPassword, config), true);
});

test('device identity must match its client ID and own database credential', async () => {
  assert.equal(await authenticateBrokerIdentity('DX-001', 'DX-001', secret, config), true);
  assert.equal(await authenticateBrokerIdentity('DX-002', 'DX-001', secret, config), false);
  assert.equal(await authenticateBrokerIdentity('invalid/id', 'invalid/id', secret, config), false);
  const unavailable = { ...config, credentialPool: { query: async () => { throw new Error('database unavailable'); } } as unknown as Pool };
  await assert.rejects(authenticateBrokerIdentity('DX-001', 'DX-001', secret, unavailable), /database unavailable/);
});
