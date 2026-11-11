import 'dotenv/config';
import { createServer } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';
import { readFileSync } from 'node:fs';
import Aedes, { type Client } from 'aedes';
import type { Pool } from 'pg';
import { brokerPostgresConfig, createBrokerCredentialPool } from './postgresCredentials.js';
import { authenticateBrokerIdentity } from './identity.js';

const host = process.env.MQTT_HOST || '0.0.0.0';
const brokerMode = process.env.NODE_ENV === 'production' || process.env.MQTT_BROKER_MODE === 'production' ? 'production' : 'development';
const port = Number(process.env.MQTT_PORT || (brokerMode === 'production' ? 8883 : 1883));
const gatewayUsername = process.env.MQTT_GATEWAY_USERNAME || 'gateway';
const gatewayPassword = process.env.MQTT_GATEWAY_PASSWORD || 'dongxin-local-gateway';
const authBackend = process.env.MQTT_DEVICE_AUTH_BACKEND || 'json';
const deviceCredentials = authBackend === 'json' ? readDeviceCredentials() : new Map<string, string>();
assertBrokerConfiguration();
const credentialPool: Pool | null = authBackend === 'postgres' ? createBrokerCredentialPool() : null;
let pendingAuthentications = 0;
const broker = new Aedes();

broker.authenticate = (client, usernameBuffer, passwordBuffer, done) => {
  const username = usernameBuffer?.toString() || '';
  const password = passwordBuffer?.toString() || '';
  if (credentialPool && client.id !== 'dongxin-api-gateway' && pendingAuthentications >= 256) return done(null, false);
  if (credentialPool && client.id !== 'dongxin-api-gateway') pendingAuthentications++;
  void authenticateBrokerIdentity(client.id, username, password, {
    gatewayUsername, gatewayPassword, deviceCredentials, credentialPool,
  })
    .then((allowed) => done(null, allowed), (error: Error) => {
      console.error('[mqtt] credential lookup failed', error);
      done(null, false);
    })
    .finally(() => { if (credentialPool && client.id !== 'dongxin-api-gateway') pendingAuthentications--; });
};

broker.authorizePublish = (client, packet, done) => {
  const identity = client?.id || '';
  const allowed = isGatewayClient(client)
    ? /^dongxin\/v1\/devices\/[^/]+\/down\/(command|config|voice-test|audio-test|board-test)$/.test(packet.topic)
    : packet.topic.startsWith(`dongxin/v1/devices/${identity}/up/`);
  done(allowed ? null : new Error(`Publish denied for ${identity}`));
};

broker.authorizeSubscribe = (client, subscription, done) => {
  const identity = client?.id || '';
  const allowed = isGatewayClient(client)
    ? subscription.topic === 'dongxin/v1/devices/+/up/+'
    : subscription.topic.startsWith(`dongxin/v1/devices/${identity}/down/`);
  done(allowed ? null : new Error(`Subscribe denied for ${identity}`), subscription);
};

broker.on('clientReady', (client) => {
  console.log(`[mqtt] connected client=${client.id}`);
});

broker.on('clientDisconnect', (client) => {
  console.log(`[mqtt] disconnected client=${client.id}`);
});

broker.on('clientError', (client, error) => {
  console.warn(`[mqtt] client error client=${client?.id || 'unknown'} message=${error.message}`);
});

const tcpServer = brokerMode === 'production'
  ? createTlsServer({
      key: readFileSync(process.env.MQTT_TLS_KEY_FILE!),
      cert: readFileSync(process.env.MQTT_TLS_CERT_FILE!),
      minVersion: 'TLSv1.2',
    }, broker.handle)
  : createServer(broker.handle);
if (credentialPool) {
  await credentialPool.query('SELECT 1');
  credentialPool.on('error', (error) => console.error('[mqtt] credential database pool error', error));
}
tcpServer.listen(port, host, () => {
  console.log(`[mqtt] Dongxin broker listening at ${brokerMode === 'production' ? 'mqtts' : 'mqtt'}://${host}:${port}`);
  console.log(`[mqtt] broker mode: ${brokerMode}`);
  if (!credentialPool) console.log(`[mqtt] provisioned development devices: ${[...deviceCredentials.keys()].join(', ')}`);
});

function isGatewayClient(client: Client | null): boolean {
  return client?.id === 'dongxin-api-gateway';
}

function readDeviceCredentials(): Map<string, string> {
  const fallback = {
    'DX-C3-SUPERMINI-HW466AB-001': 'dongxin-local-c3-001',
    'DX-C3-LICHUANG-AUDIO-001': 'dongxin-local-lichuang-001',
    'DX-S3-DEVKIT-001': 'dongxin-local-s3-001',
    'DX-MQTT-SIM-001': 'dongxin-local-sim-001'
  };
  const raw = process.env.MQTT_DEVICE_CREDENTIALS;
  if (!raw) {
    return new Map(Object.entries(fallback));
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return new Map(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => Boolean(entry[0]) && typeof entry[1] === 'string' && entry[1].length > 0
      )
    );
  } catch (error) {
    throw new Error(`Invalid MQTT_DEVICE_CREDENTIALS JSON: ${String(error)}`);
  }
}

function assertBrokerConfiguration(): void {
  if (!['json', 'postgres'].includes(authBackend)) throw new Error('MQTT_DEVICE_AUTH_BACKEND must be json or postgres');
  if (authBackend === 'postgres') brokerPostgresConfig();
  if (brokerMode !== 'production') return;
  if (!process.env.MQTT_TLS_KEY_FILE || !process.env.MQTT_TLS_CERT_FILE) {
    throw new Error('Production broker requires MQTT_TLS_KEY_FILE and MQTT_TLS_CERT_FILE');
  }
  if (authBackend === 'json' && !process.env.MQTT_DEVICE_CREDENTIALS) {
    throw new Error('Production broker requires explicit MQTT_DEVICE_CREDENTIALS');
  }
  if (
    !process.env.MQTT_GATEWAY_USERNAME ||
    !process.env.MQTT_GATEWAY_PASSWORD ||
    gatewayPassword === 'dongxin-local-gateway'
  ) {
    throw new Error('Production broker requires non-default gateway credentials');
  }
  if (authBackend === 'json' && deviceCredentials.size === 0) {
    throw new Error('Production broker has no provisioned device credentials');
  }
  if (authBackend === 'json' && deviceCredentials.size > 20) {
    throw new Error('JSON-backed MQTT authentication is limited to 20 pilot devices');
  }
  for (const [deviceId, secret] of deviceCredentials) {
    if (deviceId.length > 128 || secret.length < 20) {
      throw new Error(`Invalid production credential for device ${deviceId}`);
    }
  }
  if (new Set(deviceCredentials.values()).size !== deviceCredentials.size) {
    throw new Error('Production devices must have independent MQTT secrets');
  }
}
