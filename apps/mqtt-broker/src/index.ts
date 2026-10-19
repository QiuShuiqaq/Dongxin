import 'dotenv/config';
import { createServer } from 'node:net';
import Aedes, { type Client } from 'aedes';

const host = process.env.MQTT_HOST || '0.0.0.0';
const port = Number(process.env.MQTT_PORT || 1883);
const gatewayUsername = process.env.MQTT_GATEWAY_USERNAME || 'gateway';
const gatewayPassword = process.env.MQTT_GATEWAY_PASSWORD || 'dongxin-local-gateway';
const deviceCredentials = readDeviceCredentials();
const broker = new Aedes();

broker.authenticate = (client, usernameBuffer, passwordBuffer, done) => {
  const username = usernameBuffer?.toString() || '';
  const password = passwordBuffer?.toString() || '';
  const isGateway = username === gatewayUsername && password === gatewayPassword;
  const isDevice = deviceCredentials.get(username) === password && client.id === username;
  done(null, isGateway || isDevice);
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

const tcpServer = createServer(broker.handle);
tcpServer.listen(port, host, () => {
  console.log(`[mqtt] Dongxin local broker listening at mqtt://${host}:${port}`);
  console.log(`[mqtt] provisioned development devices: ${[...deviceCredentials.keys()].join(', ')}`);
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
