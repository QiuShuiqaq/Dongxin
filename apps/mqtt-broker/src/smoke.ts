import { randomUUID } from 'node:crypto';
import mqtt, { type MqttClient } from 'mqtt';

const brokerUrl = process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
const apiUrl = process.env.API_URL || 'http://127.0.0.1:3077';
const deviceId = 'DX-MQTT-SIM-001';
const receivedCommands: Array<Record<string, any>> = [];
const device = mqtt.connect(brokerUrl, {
  clientId: deviceId,
  username: deviceId,
  password: 'dongxin-local-sim-001',
  connectTimeout: 5000,
  reconnectPeriod: 0
});

try {
  await waitForConnect(device);
  await subscribe(device, `dongxin/v1/devices/${deviceId}/down/command`);
  device.on('message', (_topic, payload) => {
    const envelope = JSON.parse(payload.toString('utf8')) as { data: Record<string, any> };
    receivedCommands.push(envelope.data);
  });
  await publishUp(device, 'register', {
    model: 'DX-MQTT-SIMULATOR',
    firmwareVersion: 'smoke-1.0.0',
    protocolVersion: '0.1',
    capabilities: { mqttCommand: true, textSimulation: true }
  }, true);

  await waitUntil(async () => {
    const devices = await getJson<Array<{ id: string; protocol: string }>>('/api/devices');
    return devices.some((item) => item.id === deviceId && item.protocol === 'MQTT');
  }, 'device registration');

  const successId = await queueAndReceive('LIGHT_ON', 'light');
  await publishCommandResult(successId, 'success', {
    state: { isOnline: true, power: 'on', light: 'on' }
  });
  await waitForCommandStatus(successId, 'APPLIED');

  // QoS 1 may repeat a result. A late conflicting result must not overwrite APPLIED.
  await publishCommandResult(successId, 'failed', {
    error: { code: 'LATE_DUPLICATE', message: 'simulated stale result' }
  });
  await delay(250);
  await assertCommandStatus(successId, 'APPLIED');

  const rejectedId = await queueAndReceive('LIGHT_OFF', 'light');
  await publishCommandResult(rejectedId, 'rejected', {
    error: { code: 'MCU_REJECTED', message: 'simulated MCU refusal' }
  });
  await waitForCommandStatus(rejectedId, 'REJECTED');

  const timeoutId = await queueAndReceive('FAN_ON', 'fan');
  await publishCommandResult(timeoutId, 'timeout', {
    error: { code: 'MCU_ACK_TIMEOUT', message: 'simulated ACK timeout' }
  });
  await waitForCommandStatus(timeoutId, 'FAILED');

  // Re-registering while a command is pending causes intentional redelivery.
  const duplicateQueued = await queueCommand('VENTILATION_ON');
  await waitForCommandDelivery(duplicateQueued.command.id, 1);
  await publishRegistration();
  await waitForCommandDelivery(duplicateQueued.command.id, 2);
  await publishCommandResult(duplicateQueued.command.id, 'success', {
    state: { isOnline: true, power: 'on', ventilation: 'on' }
  });
  await waitForCommandStatus(duplicateQueued.command.id, 'APPLIED');

  await assertInvalidCredentialsRejected();

  console.log(`[mqtt-smoke] broker=${brokerUrl}`);
  console.log(`[mqtt-smoke] success=${successId} status=APPLIED`);
  console.log(`[mqtt-smoke] rejected=${rejectedId} status=REJECTED`);
  console.log(`[mqtt-smoke] timeout=${timeoutId} status=FAILED`);
  console.log(`[mqtt-smoke] duplicate=${duplicateQueued.command.id} deliveries=2 execution=1`);
  console.log('[mqtt-smoke] authentication rejection passed');
  console.log('[mqtt-smoke] end-to-end MQTT test passed');
} catch (error) {
  console.error(`[mqtt-smoke] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  device.end(true);
}

async function waitForConnect(client: MqttClient): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout connecting to ${brokerUrl}`)), 6000);
    client.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    client.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function subscribe(client: MqttClient, topic: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    client.subscribe(topic, { qos: 1 }, (error) => error ? reject(error) : resolve());
  });
}

async function publishUp(
  client: MqttClient,
  type: string,
  data: Record<string, unknown>,
  retain = false
): Promise<void> {
  const payload = JSON.stringify({
    version: '1.0',
    messageId: `smoke_${randomUUID()}`,
    deviceId,
    sentAt: new Date().toISOString(),
    data
  });
  await new Promise<void>((resolve, reject) => {
    client.publish(
      `dongxin/v1/devices/${deviceId}/up/${type}`,
      payload,
      { qos: 1, retain },
      (error) => error ? reject(error) : resolve()
    );
  });
}

async function publishRegistration(): Promise<void> {
  await publishUp(device, 'register', {
    model: 'DX-MQTT-SIMULATOR',
    firmwareVersion: 'smoke-1.0.0',
    protocolVersion: '0.1',
    capabilities: { mqttCommand: true, textSimulation: true }
  }, true);
}

async function queueCommand(intent: string) {
  const queued = await postJson<{
    command: { id: string; status: string };
    delivery: string;
  }>(`/api/devices/${deviceId}/commands`, { intent, slots: {} });
  if (queued.command.status !== 'QUEUED' || queued.delivery !== 'MQTT') {
    throw new Error(`Unexpected command response: ${JSON.stringify(queued)}`);
  }
  return queued;
}

async function queueAndReceive(intent: string, actionCode: string): Promise<string> {
  const queued = await queueCommand(intent);
  const command = await waitForCommandDelivery(queued.command.id, 1);
  if (command.actions?.[0]?.code !== actionCode) {
    throw new Error(`Unexpected MQTT command: ${JSON.stringify(command)}`);
  }
  return queued.command.id;
}

async function waitForCommandDelivery(commandId: string, count: number): Promise<Record<string, any>> {
  await waitUntil(
    async () => receivedCommands.filter((item) => item.commandId === commandId).length >= count,
    `command ${commandId} delivery ${count}`
  );
  return receivedCommands.filter((item) => item.commandId === commandId)[count - 1];
}

async function publishCommandResult(
  commandId: string,
  status: 'success' | 'failed' | 'rejected' | 'timeout',
  extra: Record<string, unknown> = {}
): Promise<void> {
  await publishUp(device, 'command-result', {
    commandId,
    status,
    executedAt: new Date().toISOString(),
    mcuFrame: 'SIMULATED',
    ...extra
  });
}

async function waitForCommandStatus(commandId: string, expectedStatus: string): Promise<void> {
  await waitUntil(async () => {
    return getCommandStatus(commandId).then((status) => status === expectedStatus);
  }, `command ${commandId} status ${expectedStatus}`);
}

async function assertCommandStatus(commandId: string, expectedStatus: string): Promise<void> {
  const actualStatus = await getCommandStatus(commandId);
  if (actualStatus !== expectedStatus) {
    throw new Error(`Command ${commandId} is ${actualStatus}, expected ${expectedStatus}`);
  }
}

async function getCommandStatus(commandId: string): Promise<string | undefined> {
  const commands = await getJson<Array<{ id: string; status: string }>>(
    `/api/devices/${deviceId}/commands`
  );
  return commands.find((item) => item.id === commandId)?.status;
}

async function assertInvalidCredentialsRejected(): Promise<void> {
  const invalidClient = mqtt.connect(brokerUrl, {
    clientId: `${deviceId}-INVALID`,
    username: deviceId,
    password: 'wrong-device-secret',
    connectTimeout: 3000,
    reconnectPeriod: 0
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Invalid credentials were not rejected')), 4000);
      invalidClient.once('connect', () => {
        clearTimeout(timer);
        reject(new Error('Broker accepted invalid device credentials'));
      });
      invalidClient.once('error', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  } finally {
    invalidClient.end(true);
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`);
  if (!response.ok) {
    throw new Error(`GET ${path} returned ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`POST ${path} returned ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function waitUntil(check: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timeout waiting for ${label}`);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
