import { randomUUID } from 'node:crypto';
import type { DeviceCommandRecord } from '@dongxin/shared';
import mqtt, { type MqttClient } from 'mqtt';
import { z } from 'zod';
import { listDeviceCommands, patchDeviceCommand } from '../repositories/system.repository.js';
import {
  commandToPollingResponse,
  handleDeviceAccessEvent,
  handleDeviceCommandResult,
  handleDeviceHeartbeat,
  handleDeviceStateReport,
  registerDeviceAccess
} from './deviceAccess.service.js';

const MQTT_UP_TOPIC = 'dongxin/v1/devices/+/up/+';
const EnvelopeSchema = z.object({
  version: z.literal('1.0'),
  messageId: z.string().min(1),
  deviceId: z.string().min(1),
  sentAt: z.string().min(1),
  data: z.record(z.string(), z.unknown())
});

let client: MqttClient | null = null;
let connected = false;
let upstreamQueue: Promise<void> = Promise.resolve();
let gatewayLog: Parameters<typeof startMqttGateway>[0] | null = null;

export function startMqttGateway(log: {
  info: (details: unknown, message?: string) => void;
  warn: (details: unknown, message?: string) => void;
  error: (details: unknown, message?: string) => void;
}): void {
  if (process.env.MQTT_ENABLED === 'false' || client) {
    return;
  }
  gatewayLog = log;

  const brokerUrl = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
  client = mqtt.connect(brokerUrl, {
    clientId: 'dongxin-api-gateway',
    username: process.env.MQTT_GATEWAY_USERNAME || 'gateway',
    password: process.env.MQTT_GATEWAY_PASSWORD || 'dongxin-local-gateway',
    clean: true,
    keepalive: 60,
    connectTimeout: 5000,
    reconnectPeriod: 3000
  });

  client.on('connect', () => {
    connected = true;
    log.info({ brokerUrl }, 'MQTT gateway connected');
    client?.subscribe(MQTT_UP_TOPIC, { qos: 1 }, (error) => {
      if (error) {
        log.error({ error }, 'MQTT gateway subscription failed');
        return;
      }
      void publishPendingCommands(log);
    });
  });

  client.on('reconnect', () => {
    log.warn({ brokerUrl }, 'MQTT gateway reconnecting');
  });
  client.on('close', () => {
    connected = false;
  });
  client.on('error', (error) => {
    log.warn({ error, brokerUrl }, 'MQTT gateway error');
  });
  client.on('message', (topic, payload) => {
    upstreamQueue = upstreamQueue
      .then(() => handleUpstreamMessage(topic, payload))
      .catch((error) => {
        log.error({ error, topic }, 'MQTT upstream message rejected');
      });
  });
}

export async function stopMqttGateway(): Promise<void> {
  const current = client;
  client = null;
  connected = false;
  gatewayLog = null;
  if (!current) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    current.end(false, {}, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

export function getMqttGatewayStatus() {
  return {
    enabled: process.env.MQTT_ENABLED !== 'false',
    connected,
    brokerUrl: process.env.MQTT_URL || 'mqtt://127.0.0.1:1883'
  };
}

export async function publishQueuedDeviceCommand(command: DeviceCommandRecord): Promise<boolean> {
  if (!client || !connected || command.status !== 'QUEUED' || command.slots.delivery === 'direct-response') {
    return false;
  }

  const delivery = commandToPollingResponse(command);
  if (!delivery) {
    return false;
  }

  const envelope = {
    version: '1.0',
    messageId: `msg_${randomUUID()}`,
    deviceId: command.deviceId,
    sentAt: new Date().toISOString(),
    data: delivery
  };
  try {
    await publish(
      `dongxin/v1/devices/${command.deviceId}/down/command`,
      JSON.stringify(envelope),
      1
    );
    return true;
  } catch {
    return false;
  }
}

async function handleUpstreamMessage(topic: string, payload: Buffer): Promise<void> {
  const topicMatch = topic.match(/^dongxin\/v1\/devices\/([^/]+)\/up\/([^/]+)$/);
  if (!topicMatch) {
    throw new Error(`Invalid upstream topic: ${topic}`);
  }

  const [, topicDeviceId, messageType] = topicMatch;
  const envelope = EnvelopeSchema.parse(JSON.parse(payload.toString('utf8')));
  if (envelope.deviceId !== topicDeviceId) {
    throw new Error(`Topic device ${topicDeviceId} does not match payload device ${envelope.deviceId}`);
  }

  const body = { deviceId: topicDeviceId, ...envelope.data };
  switch (messageType) {
    case 'register':
      await registerDeviceAccess(body, 'MQTT');
      await publishPendingCommands(gatewayLog, topicDeviceId);
      return;
    case 'heartbeat':
      await handleDeviceHeartbeat(body);
      return;
    case 'state':
    case 'status':
      await handleDeviceStateReport(body);
      return;
    case 'event':
      await handleDeviceAccessEvent(body);
      return;
    case 'command-result':
      await handleDeviceCommandResult(body);
      return;
    default:
      throw new Error(`Unsupported upstream message type: ${messageType}`);
  }
}

async function publishPendingCommands(
  log: { warn: (details: unknown, message?: string) => void } | null,
  deviceId?: string
): Promise<void> {
  const commands = await listDeviceCommands();
  const pending = commands.filter(
    (command) =>
      command.status === 'QUEUED' &&
      command.slots.delivery !== 'direct-response' &&
      (!deviceId || command.deviceId === deviceId)
  );
  for (const command of pending) {
    if (Date.now() > new Date(command.createdAt).getTime() + 60_000) {
      await patchDeviceCommand(command.id, {
        status: 'FAILED',
        completedAt: new Date().toISOString()
      });
      log?.warn({ commandId: command.id }, 'Expired MQTT command was not delivered');
      continue;
    }
    try {
      await publishQueuedDeviceCommand(command);
    } catch (error) {
      log?.warn({ error, commandId: command.id }, 'Pending MQTT command publish failed');
    }
  }
}

async function publish(topic: string, payload: string, qos: 0 | 1): Promise<void> {
  if (!client || !connected) {
    throw new Error('MQTT gateway is not connected');
  }
  await new Promise<void>((resolve, reject) => {
    client?.publish(topic, payload, { qos, retain: false }, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
