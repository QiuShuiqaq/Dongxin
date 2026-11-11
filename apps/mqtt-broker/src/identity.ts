import { createHash, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { verifyBrokerDeviceCredential } from './postgresCredentials.js';

export type BrokerIdentityConfig = {
  gatewayUsername: string;
  gatewayPassword: string;
  deviceCredentials: Map<string, string>;
  credentialPool: Pool | null;
};

export async function authenticateBrokerIdentity(
  clientId: string, username: string, password: string, config: BrokerIdentityConfig,
): Promise<boolean> {
  if (clientId === 'dongxin-api-gateway') {
    return secureTextEqual(username, config.gatewayUsername) &&
      secureTextEqual(password, config.gatewayPassword);
  }
  if (clientId !== username || !/^[A-Za-z0-9_-]{1,128}$/.test(username)) return false;
  if (config.credentialPool) return verifyBrokerDeviceCredential(config.credentialPool, username, password);
  const expected = config.deviceCredentials.get(username);
  return expected !== undefined && secureTextEqual(password, expected);
}

function secureTextEqual(actual: string, expected: string): boolean {
  return timingSafeEqual(createHash('sha256').update(actual).digest(), createHash('sha256').update(expected).digest());
}
