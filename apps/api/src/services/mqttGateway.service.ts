import { randomUUID } from 'node:crypto';
import type { DeviceCommandRecord } from '@dongxin/shared';
import mqtt, { type MqttClient } from 'mqtt';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TaskScheduler } from '../runtime/scheduler.js';
import { RequestReplay } from '../runtime/requestReplay.js';
import { limitSetting } from '../runtime/limits.js';
import { isCommandCurrent } from '../runtime/commandGuard.js';
import { assertWorkActive } from '../runtime/workload.js';
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
const upstream = new TaskScheduler({
  concurrency: limitSetting('MQTT_UPSTREAM_CONCURRENCY', 4),
  maxWaiting: limitSetting('MQTT_UPSTREAM_QUEUE_LENGTH', 256, 0),
  maxWaitMs: limitSetting('MQTT_UPSTREAM_QUEUE_WAIT_MS', 5000),
  perKeyWaiting: 16,
});
const upstreamReplay = new RequestReplay(2048, 1024 * 1024, 60_000);
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
    reconnectPeriod: 3000,
    ...(process.env.MQTT_CA_FILE ? { ca: readFileSync(process.env.MQTT_CA_FILE) } : {}),
    ...(process.env.MQTT_TLS_SERVERNAME ? { servername: process.env.MQTT_TLS_SERVERNAME } : {}),
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
    // Bound retained buffers before parsing; never build an unbounded Promise chain.
    if (payload.length > 64 * 1024) {
      log.warn({ topic, bytes: payload.length }, 'MQTT upstream payload too large');
      return;
    }
    const match = topic.match(/^dongxin\/v1\/devices\/([^/]+)\/up\/([^/]+)$/);
    if (!match) return;
    const priority = match[2] === 'command-result' ? 2 : match[2] === 'heartbeat' ? 0 : 1;
    void upstream.run(match[1], () => handleUpstreamMessage(topic, payload), { priority }).catch((error) => {
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
    brokerUrl: process.env.MQTT_URL || 'mqtt://127.0.0.1:1883',
    upstream: upstream.snapshot(),
    replay: upstreamReplay.snapshot(),
  };
}

export async function publishQueuedDeviceCommand(command: DeviceCommandRecord): Promise<boolean> {
  assertWorkActive();
  if (!isCommandCurrent(command)) {
    await patchDeviceCommand(command.id, { status: 'FAILED', completedAt: new Date().toISOString() });
    return false;
  }
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

export async function publishVoiceTestControl(input: {
  deviceId: string;
  testSessionId: string;
  action: 'start' | 'stop';
  recordSeconds: number;
  continuous?: boolean;
  settings?: import('@dongxin/shared').VoiceTestSettings;
  mode: 'FULL_PIPELINE' | 'ASR_ONLY' | 'CI_WAKE_ONLINE_FALLBACK';
}): Promise<void> {
  const envelope = {
    version: '1.0',
    messageId: `msg_${randomUUID()}`,
    deviceId: input.deviceId,
    sentAt: new Date().toISOString(),
    data: {
      type: 'voice_test',
      action: input.action,
      testSessionId: input.testSessionId,
      recordSeconds: input.recordSeconds,
      continuous: input.continuous ?? false,
      settings: input.settings,
      synthesizeSpeech: false,
      mode: input.mode
    }
  };
  await publish(
    `dongxin/v1/devices/${input.deviceId}/down/voice-test`,
    JSON.stringify(envelope),
    1
  );
}

export async function publishAudioTestControl(input: {
  deviceId: string;
  testId: string;
  action: 'play' | 'stop';
  audioPath?: string;
  volumePercent?: number;
  listenAfterPlayback?: boolean;
}): Promise<void> {
  const envelope = {
    version: '1.0',
    messageId: `msg_${randomUUID()}`,
    deviceId: input.deviceId,
    sentAt: new Date().toISOString(),
    data: {
      type: 'audio_test',
      action: input.action,
      testId: input.testId,
      audioPath: input.audioPath ?? null,
      volumePercent: input.volumePercent ?? null,
      listenAfterPlayback: input.listenAfterPlayback ?? false
    }
  };
  await publish(
    `dongxin/v1/devices/${input.deviceId}/down/audio-test`,
    JSON.stringify(envelope),
    1
  );
}

export async function publishBoardTestControl(input: {
  deviceId: string;
  requestId: string;
  action: 'snapshot' | 'display_pattern' | 'display_power';
  params: Record<string, unknown>;
}): Promise<void> {
  const envelope = {
    version: '1.0',
    messageId: `msg_${randomUUID()}`,
    deviceId: input.deviceId,
    sentAt: new Date().toISOString(),
    data: {
      type: 'board_test',
      requestId: input.requestId,
      action: input.action,
      params: input.params
    }
  };
  await publish(
    `dongxin/v1/devices/${input.deviceId}/down/board-test`,
    JSON.stringify(envelope),
    1
  );
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

  if (envelope.data.deviceId !== undefined && envelope.data.deviceId !== topicDeviceId) {
    throw new Error('MQTT data deviceId does not match topic');
  }
  // A broker-generated will has a fixed message ID but represents every new disconnect.
  if (messageType === 'status' && envelope.messageId === 'lwt' && envelope.sentAt === 'broker' &&
      typeof envelope.data.state === 'object' && envelope.data.state !== null &&
      'isOnline' in envelope.data.state && envelope.data.state.isOnline === false) {
    await dispatchUpstreamMessage(topicDeviceId, messageType, envelope.data);
    return;
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(envelope.data)).digest('hex');
  return upstreamReplay.run(JSON.stringify([topicDeviceId, messageType, envelope.messageId]), fingerprint,
    () => dispatchUpstreamMessage(topicDeviceId, messageType, envelope.data));
}

async function dispatchUpstreamMessage(deviceId: string, messageType: string, data: Record<string, unknown>): Promise<void> {
  const body = { ...data, deviceId };
  switch (messageType) {
    case 'register':
      await registerDeviceAccess(body, 'MQTT');
      await publishPendingCommands(gatewayLog, deviceId);
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
    case 'voice-test':
      await (await import('./voiceTest.service.js')).handleVoiceTestDeviceStatus(body);
      return;
    case 'audio-test':
      await (await import('./voiceModuleTest.service.js')).handleAudioTestDeviceStatus(body);
      return;
    case 'board-test':
      await (await import('./boardLab.service.js')).handleBoardLabDeviceResult(body);
      return;
    case 'stm32-link':
      await (await import('./stm32Link.service.js')).handleStm32LinkReport(body);
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
