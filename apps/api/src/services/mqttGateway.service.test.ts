import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, mock, test } from 'node:test';
import type { DeviceCommandRecord } from '@dongxin/shared';
import { devicePresence } from '../runtime/devicePresence.js';

// All transports and persistence are mocked. No network or hardware is used.
class FakeMqttClient extends EventEmitter {
  publications: Array<{ topic: string; payload: Record<string, unknown> }> = [];
  holdPublish = false;
  publishCallbacks: Array<(error?: Error) => void> = [];

  subscribe(_topic: string, _options: unknown, callback: (error?: Error) => void) {
    callback();
  }

  publish(topic: string, payload: string, _options: unknown, callback: (error?: Error) => void) {
    this.publications.push({ topic, payload: JSON.parse(payload) });
    if (this.holdPublish) this.publishCallbacks.push(callback);
    else callback();
  }

  end(_force: boolean, _options: unknown, callback: (error?: Error) => void) {
    callback();
  }

  receive(deviceId: string, type: string, messageId: string, data: Record<string, unknown>, packet: { retain?: boolean; dup?: boolean } = {}) {
    this.emit('message', `dongxin/v1/devices/${deviceId}/up/${type}`, Buffer.from(JSON.stringify({
      version: '1.0', deviceId, messageId, sentAt: messageId === 'lwt' ? 'broker' : 'fixture', data,
    })), { retain: false, dup: false, ...packet });
  }
}

let transport: FakeMqttClient;
let commands: DeviceCommandRecord[] = [];
let heartbeatGate: Promise<void> | undefined;
let commandListGate: Promise<void> | undefined;
let eventGate: Promise<void> | undefined;
let eventDelivery: Promise<void> | undefined;
let failNextHeartbeat = false;
let heartbeatCalls = 0;
let statusCalls = 0;
let commandListCalls = 0;
let errors: unknown[] = [];
let deviceId = '';

mock.module('mqtt', { defaultExport: { connect: () => transport } });
const replace = (path: string, namedExports: Record<string, unknown>) => mock.module(new URL(path, import.meta.url).href, { namedExports });
replace('../repositories/system.repository.js', {
  listDeviceCommands: async () => { commandListCalls++; await commandListGate; return commands; },
  patchDeviceCommand: async () => { throw new Error('Unexpected persistent command update'); },
});
replace('../runtime/commandGuard.js', { isCommandCurrent: () => true });
replace('../runtime/workload.js', { assertWorkActive: () => undefined });
replace('./deviceAccess.service.js', {
  registerDeviceAccess: async () => undefined,
  handleDeviceHeartbeat: async () => {
    heartbeatCalls++;
    await heartbeatGate;
    if (failNextHeartbeat) { failNextHeartbeat = false; throw new Error('Fixture processing failure'); }
  },
  handleDeviceStateReport: async () => { statusCalls++; },
  handleDeviceAccessEvent: async () => {
    await eventGate;
    eventDelivery = publishAudioTestControl({ deviceId, testId: 'fixture-audio', action: 'play' });
    await eventDelivery;
  },
  handleDeviceCommandResult: async () => undefined,
  commandToPollingResponse: (command: DeviceCommandRecord) => ({ commandId: command.id, intent: command.intent }),
});

const { startMqttGateway, stopMqttGateway, getMqttGatewayStatus, publishQueuedDeviceCommand, publishAudioTestControl } = await import('./mqttGateway.service.js');
const log = { info: () => undefined, warn: () => undefined, error: (error: unknown) => { errors.push(error); } };
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
};
async function idle() {
  for (let i = 0; i < 100; i++) {
    await flush();
    const { active, waiting } = getMqttGatewayStatus().upstream;
    if (active === 0 && waiting === 0) return;
  }
  throw new Error('Mocked MQTT scheduler did not become idle');
}
function connect() {
  transport = new FakeMqttClient();
  startMqttGateway(log);
  transport.emit('connect');
}
function reconnect() {
  transport.emit('close');
  transport.emit('reconnect');
  transport.emit('connect');
}
function command(): DeviceCommandRecord {
  return {
    id: `fixture-command-${randomUUID()}`, deviceId, intent: 'LIGHT_ON', slots: {},
    status: 'QUEUED', createdAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  deviceId = `mqtt-fixture-${randomUUID()}`;
  commands = [];
  heartbeatGate = undefined;
  commandListGate = undefined;
  eventGate = undefined;
  eventDelivery = undefined;
  failNextHeartbeat = false;
  heartbeatCalls = 0;
  statusCalls = 0;
  commandListCalls = 0;
  errors = [];
  process.env.MQTT_ENABLED = 'true';
  connect();
});
afterEach(async () => {
  await stopMqttGateway();
  assert.equal(getMqttGatewayStatus().upstream.active, 0);
  assert.equal(getMqttGatewayStatus().upstream.waiting, 0);
});

test('retained ONLINE is ignored and a first-seen QoS DUP heartbeat is processed once', async () => {
  transport.receive(deviceId, 'status', 'retained', { state: { isOnline: true } }, { retain: true });
  await idle();
  assert.equal(devicePresence.mqttStatus(deviceId), 'UNKNOWN');
  assert.equal(statusCalls, 0);

  transport.receive(deviceId, 'heartbeat', 'heartbeat-1', {}, { dup: true });
  await idle();
  assert.equal(devicePresence.mqttStatus(deviceId), 'ONLINE');
  assert.equal(heartbeatCalls, 1);
  assert.equal(commandListCalls, 1);

  transport.receive(deviceId, 'heartbeat', 'heartbeat-1', {}, { dup: true });
  await idle();
  assert.equal(heartbeatCalls, 1);
  assert.equal(commandListCalls, 1);
  assert.deepEqual(errors, []);
});

test('a failed first delivery can be retried with DUP and then confirm online', async () => {
  failNextHeartbeat = true;
  transport.receive(deviceId, 'heartbeat', 'retry-heartbeat', {});
  await idle();
  assert.equal(devicePresence.mqttStatus(deviceId), 'UNKNOWN');
  assert.equal(heartbeatCalls, 1);

  transport.receive(deviceId, 'heartbeat', 'retry-heartbeat', {}, { dup: true });
  await idle();
  assert.equal(devicePresence.mqttStatus(deviceId), 'ONLINE');
  assert.equal(heartbeatCalls, 2);
  assert.equal(errors.length, 1);
});

test('cached ONLINE cannot override LWT or flush commands; a fresh heartbeat can', async () => {
  transport.receive(deviceId, 'heartbeat', 'heartbeat-1', {});
  await idle();
  transport.receive(deviceId, 'status', 'lwt', { state: { isOnline: false } });
  await idle();
  assert.equal(devicePresence.mqttStatus(deviceId), 'OFFLINE');

  commands = [command()];
  transport.receive(deviceId, 'heartbeat', 'heartbeat-1', {}, { dup: false });
  await idle();
  assert.equal(devicePresence.mqttStatus(deviceId), 'OFFLINE');
  assert.equal(heartbeatCalls, 1);
  assert.equal(commandListCalls, 1);
  assert.equal(transport.publications.length, 0);

  transport.receive(deviceId, 'heartbeat', 'heartbeat-2', {});
  await idle();
  assert.equal(devicePresence.mqttStatus(deviceId), 'ONLINE');
  assert.equal(transport.publications.length, 1);
  assert.deepEqual(errors, []);
});

test('a fresh registration retries queued commands even when presence was already online', async () => {
  transport.receive(deviceId, 'heartbeat', 'heartbeat-1', {});
  await idle();
  assert.equal(devicePresence.mqttStatus(deviceId), 'ONLINE');
  commands = [command()];

  transport.receive(deviceId, 'register', 'register-2', {});
  await idle();
  assert.equal(transport.publications.length, 1);
  assert.equal(commandListCalls, 2);

  transport.receive(deviceId, 'register', 'register-2', {}, { dup: true });
  await idle();
  assert.equal(transport.publications.length, 1);
  assert.equal(commandListCalls, 2);
  assert.deepEqual(errors, []);
});

test('cached explicit offline reports cannot override a later fresh heartbeat', async () => {
  transport.receive(deviceId, 'state', 'offline-1', { state: { isOnline: false } });
  await idle();
  assert.equal(devicePresence.mqttStatus(deviceId), 'OFFLINE');
  transport.receive(deviceId, 'heartbeat', 'heartbeat-1', {});
  await idle();
  transport.receive(deviceId, 'state', 'offline-1', { state: { isOnline: false } });
  await idle();
  assert.equal(devicePresence.mqttStatus(deviceId), 'ONLINE');
  assert.equal(statusCalls, 1);
  assert.deepEqual(errors, []);
});

test('reconnect requires fresh evidence and rejects cached ONLINE even without DUP', async () => {
  transport.receive(deviceId, 'heartbeat', 'heartbeat-1', {});
  await idle();
  reconnect();
  assert.equal(devicePresence.mqttStatus(deviceId), 'UNKNOWN');
  transport.receive(deviceId, 'heartbeat', 'heartbeat-1', {}, { dup: false });
  await idle();
  assert.equal(devicePresence.mqttStatus(deviceId), 'UNKNOWN');
  assert.equal(commandListCalls, 1);
  transport.receive(deviceId, 'heartbeat', 'heartbeat-2', {});
  await idle();
  assert.equal(devicePresence.mqttStatus(deviceId), 'ONLINE');
  assert.deepEqual(errors, []);
});

test('restart ignores late events from the old client and requires a fresh message', async () => {
  transport.receive(deviceId, 'heartbeat', 'heartbeat-1', {});
  await idle();
  const stopped = transport;
  await stopMqttGateway();
  connect();
  assert.equal(devicePresence.mqttStatus(deviceId), 'UNKNOWN');
  stopped.emit('connect');
  stopped.emit('close');
  stopped.receive(deviceId, 'heartbeat', 'late-old-client', {});
  await idle();
  assert.equal(getMqttGatewayStatus().connected, true);
  assert.equal(devicePresence.mqttStatus(deviceId), 'UNKNOWN');
  transport.receive(deviceId, 'heartbeat', 'heartbeat-2', {});
  await idle();
  assert.equal(devicePresence.mqttStatus(deviceId), 'ONLINE');
  assert.equal(heartbeatCalls, 2);
  assert.deepEqual(errors, []);
});

test('an in-flight heartbeat from an earlier session cannot confirm online or flush', async () => {
  const processing = gate();
  heartbeatGate = processing.promise;
  commands = [command()];
  transport.receive(deviceId, 'heartbeat', 'heartbeat-1', {});
  await flush();
  assert.equal(heartbeatCalls, 1);
  reconnect();
  processing.release();
  await idle();
  assert.equal(devicePresence.mqttStatus(deviceId), 'UNKNOWN');
  assert.equal(commandListCalls, 0);
  assert.equal(transport.publications.length, 0);

  transport.receive(deviceId, 'heartbeat', 'heartbeat-1', {});
  await idle();
  assert.equal(devicePresence.mqttStatus(deviceId), 'UNKNOWN');
  transport.receive(deviceId, 'heartbeat', 'heartbeat-2', {});
  await idle();
  assert.equal(transport.publications.length, 1);
  assert.deepEqual(errors, []);
});

test('a pending command-list read from an earlier session cannot publish after reconnect', async () => {
  const listing = gate();
  commandListGate = listing.promise;
  commands = [command()];
  transport.receive(deviceId, 'heartbeat', 'heartbeat-1', {});
  await flush();
  assert.equal(commandListCalls, 1);
  reconnect();
  listing.release();
  await idle();
  assert.equal(transport.publications.length, 0);
  assert.equal(devicePresence.mqttStatus(deviceId), 'UNKNOWN');

  transport.receive(deviceId, 'heartbeat', 'heartbeat-2', {});
  await idle();
  assert.equal(transport.publications.length, 1);
  assert.deepEqual(errors, []);
});

test('an acknowledgement from an earlier session cannot complete a publish in the new session', async () => {
  transport.receive(deviceId, 'heartbeat', 'heartbeat-1', {});
  await idle();
  transport.holdPublish = true;
  const publishing = publishQueuedDeviceCommand(command());
  assert.equal(transport.publications.length, 1);
  reconnect();
  transport.receive(deviceId, 'heartbeat', 'heartbeat-2', {});
  await idle();
  assert.equal(devicePresence.mqttStatus(deviceId), 'ONLINE');
  transport.publishCallbacks.shift()!();
  assert.equal(await publishing, false);
  assert.equal(transport.publications.length, 1);
  assert.deepEqual(errors, []);
});

test('an older in-flight event cannot publish audio after reconnect', async () => {
  const processing = gate();
  eventGate = processing.promise;
  transport.receive(deviceId, 'event', 'entrance-1', {});
  await flush();
  reconnect();
  processing.release();
  await idle();
  assert.equal(transport.publications.length, 0);
  assert.ok(eventDelivery);
  await assert.rejects(eventDelivery, /session is not connected/);
  assert.equal(errors.length, 1);

  transport.receive(deviceId, 'event', 'entrance-2', {});
  await idle();
  assert.equal(transport.publications.length, 1);
  assert.equal(transport.publications[0]?.topic, `dongxin/v1/devices/${deviceId}/down/audio-test`);
});
