import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { AiResult, DeviceCommandRecord, DeviceProfile } from '@dongxin/shared';
import { getDeviceControlRevision, getDeviceState, patchDeviceState } from '../deviceSimulator.js';
import { runVoiceWork } from '../runtime/workload.js';

// Exercise real admission, revision and safety logic. All persistence and
// external services are isolated; these tests cannot send hardware commands.
const id = 'access-fixture';
let commands: DeviceCommandRecord[] = [];
let registeredProfiles: DeviceProfile[] = [];
let provisionedModel: string | null = null;
let persistedEvents = 0;
let result: AiResult;
let resolveGate: Promise<void> | undefined;
const replace = (path: string, namedExports: Record<string, unknown>) => mock.module(new URL(path, import.meta.url).href, { namedExports });
replace('../repositories/system.repository.js', {
  listDeviceCommands: async () => commands,
  finishDeviceCommand: async (deviceId: string, commandId: string, status: 'APPLIED' | 'REJECTED' | 'FAILED', completedAt: string) => {
    const command = commands.find((item) => item.deviceId === deviceId && item.id === commandId);
    if (!command) return null;
    if (command.status === 'APPLIED' || command.status === 'REJECTED' || command.status === 'FAILED') {
      return { command, outcome: command.status === status ? 'DUPLICATE' : 'CONFLICT' };
    }
    if (command.status !== 'QUEUED') return { command, outcome: 'CONFLICT' };
    Object.assign(command, { status, completedAt });
    return { command, outcome: 'UPDATED' };
  },
  patchDeviceCommand: async (commandId: string, patch: Partial<DeviceCommandRecord>) => {
    const command = commands.find((item) => item.id === commandId);
    if (command) Object.assign(command, patch);
    return command;
  },
  updateDeviceProfiles: async (update: (devices: DeviceProfile[]) => DeviceProfile[]) => {
    registeredProfiles = update(registeredProfiles);
    return registeredProfiles;
  },
});
replace('./deviceRegistry.service.js', {
  getDevice: async () => ({ id, model: 'fixture' }), getDeviceState: async () => getDeviceState(id),
  listDevices: async () => [], saveDevices: async () => undefined, recordDeviceEvent: async () => { persistedEvents++; },
  queueDeviceCommand: async (input: Omit<DeviceCommandRecord, 'id' | 'createdAt'>) => {
    const command = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    commands.push(command);
    return command;
  },
});
replace('./device.service.js', { patchCurrentDeviceState: patchDeviceState });
replace('./deviceAuth.service.js', { getProvisionedDeviceModel: async () => provisionedModel });
replace('./log.service.js', { appendLog: async () => undefined });
replace('./lowCostIntent.service.js', { resolveLowCostIntent: async () => { await resolveGate; return { source: 'rule', aiResult: result }; } });
replace('./knowledge.service.js', { getVoiceKnowledge: async () => ({ context: '' }) });
replace('./proactive.service.js', { handleProactiveEvent: async () => { throw new Error('Unexpected proactive operation'); } });
replace('./prompt.service.js', { findPrompt: () => undefined, listPrompts: async () => [] });
replace('./provider.service.js', { findProvider: () => undefined, listProviders: async () => [] });
replace('../modelGateway.js', { callModel: async () => { throw new Error('Unexpected paid API call'); } });
replace('../envStore.js', { isEnvConfigured: () => false });

const { handleDeviceAccessEvent, handleDeviceAccessVoiceTurn, handleDeviceCommandResult, handleDeviceStateReport, handleDeviceHeartbeat, registerDeviceAccess, getDeviceAccessConfig, commandToPollingResponse, cloudStateToDeviceStatePatch } = await import('./deviceAccess.service.js');
const localEvent = (eventId = randomUUID()) => ({ deviceId: id, eventId, eventType: 'LOCAL_CONTROL', payload: { source: 'CI1302', intent: 'LIGHT_OFF' } });
const turn = () => handleDeviceAccessVoiceTurn({ deviceId: id, text: '测试控制' });
const confirm = (token: string) => handleDeviceAccessVoiceTurn({ deviceId: id, text: '确认', confirmToken: token });
const code = (value: string) => (error: unknown) => (error as { code?: string }).code === value;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  commands = [];
  const now = new Date().toISOString();
  registeredProfiles = [{ id, model: 'fixture', name: 'Fixture device', protocol: 'MQTT',
    status: 'ONLINE', createdAt: now, updatedAt: now }];
  provisionedModel = null;
  persistedEvents = 0;
  resolveGate = undefined;
  result = { resultType: 'DEVICE_CONTROL', intent: 'LIGHT_ON', confidence: 1, slots: {}, requiresConfirm: false, speak: '测试回复' };
  patchDeviceState({ isOnline: true, activeModes: [], faultCode: null, targetTemperature: 40 }, id);
});

test('device registration and config advertise a low-frequency heartbeat', async () => {
  const registration = await registerDeviceAccess({ deviceId: id, model: 'fixture', capabilities: {} });
  const config = await getDeviceAccessConfig(id);
  assert.equal(registration.heartbeatIntervalSeconds, 900);
  assert.equal(config.heartbeatIntervalSeconds, 900);
  const afterRegistration = persistedEvents;
  await handleDeviceHeartbeat({ deviceId: id });
  assert.equal(persistedEvents, afterRegistration);
});

test('an existing device cannot change its model through registration', async () => {
  await registerDeviceAccess({ deviceId: id, model: 'fixture', capabilities: {} });
  await assert.rejects(
    registerDeviceAccess({ deviceId: id, model: 'different-model', capabilities: {} }),
    code('DEVICE_MODEL_MISMATCH'),
  );
  assert.equal(registeredProfiles[0]?.model, 'fixture');
});

test('repeated online registration does not append an event for every reconnect', async () => {
  registeredProfiles = [];
  await registerDeviceAccess({ deviceId: id, model: 'fixture', capabilities: {} });
  assert.equal(persistedEvents, 1);
  await registerDeviceAccess({ deviceId: id, model: 'fixture', capabilities: {} });
  assert.equal(persistedEvents, 1);
  registeredProfiles[0] = { ...registeredProfiles[0]!, status: 'OFFLINE' };
  await registerDeviceAccess({ deviceId: id, model: 'fixture', capabilities: {} });
  assert.equal(persistedEvents, 2);
});

test('device registration retains operator notes across reconnects', async () => {
  registeredProfiles[0] = { ...registeredProfiles[0]!, notes: 'Installation location: bathroom A', firmwareVersion: '1.2.3' };
  await registerDeviceAccess({ deviceId: id, model: 'fixture', capabilities: {} });
  assert.equal(registeredProfiles[0]?.notes, 'Installation location: bathroom A');
  assert.equal(registeredProfiles[0]?.firmwareVersion, '1.2.3');
  registeredProfiles = [];
  await registerDeviceAccess({ deviceId: id, model: 'fixture', capabilities: {} });
  assert.match(registeredProfiles[0]?.notes ?? '', /protocol=/);
});

test('a provisioned device cannot self-report a different model on first registration', async () => {
  registeredProfiles = [];
  provisionedModel = 'DX-PROVISIONED';
  await assert.rejects(
    registerDeviceAccess({ deviceId: id, model: 'fixture', capabilities: {} }),
    code('DEVICE_MODEL_MISMATCH'),
  );
  assert.equal(registeredProfiles.length, 0);
});

test('local no-op invalidates old work once per event ID; conflicting retries are rejected', async () => {
  const revision = getDeviceControlRevision(id);
  const event = localEvent();
  await Promise.all([handleDeviceAccessEvent(event), handleDeviceAccessEvent(event)]);
  assert.equal(getDeviceControlRevision(id), revision + 1);
  await assert.rejects(handleDeviceAccessEvent({ ...event, payload: { source: 'PANEL' } }), code('REQUEST_ID_CONFLICT'));
  assert.equal(getDeviceControlRevision(id), revision + 1);
});

test('a local action with a changed load advances the control revision exactly once', async () => {
  const revision = getDeviceControlRevision(id);
  const event = { ...localEvent(), payload: { source: 'CI1302', intent: 'LIGHT_ON', state: { light: 'on' } } };
  const first = await handleDeviceAccessEvent(event);
  assert.equal(getDeviceControlRevision(id), revision + 1);
  assert.deepEqual(getDeviceState(id).activeModes, ['LIGHT_ON']);
  assert.ok('controlRevision' in first);
  assert.equal(first.controlRevision, revision + 1);
  await handleDeviceAccessEvent(event);
  assert.equal(getDeviceControlRevision(id), revision + 1);
});

test('local events require a unique ID and a supported hardware source', async () => {
  await assert.rejects(handleDeviceAccessEvent({ ...localEvent(), eventId: undefined }));
  await assert.rejects(handleDeviceAccessEvent({ ...localEvent(), payload: { source: 'cloud' } }));
});

test('CI wake is an observation and never invalidates control or creates a command', async () => {
  const revision = getDeviceControlRevision(id);
  await handleDeviceAccessEvent({ deviceId: id, eventId: randomUUID(), eventType: 'CI_WAKE', payload: { source: 'CI1302', semanticId: 1 } });
  assert.equal(getDeviceControlRevision(id), revision);
  assert.equal(commands.length, 0);
});

test('partial reports and local events preserve unrelated load state', async () => {
  patchDeviceState({ activeModes: ['LIGHT_ON', 'HEAT_WEAK_ON', 'FAN_ON'] }, id);
  await handleDeviceStateReport({ deviceId: id, state: { light: 'off' } });
  assert.deepEqual(getDeviceState(id).activeModes, ['HEAT_WEAK_ON', 'FAN_ON']);
  await handleDeviceAccessEvent({ ...localEvent(), payload: { source: 'PANEL', state: { swing: 'on' } } });
  assert.deepEqual(getDeviceState(id).activeModes, ['HEAT_WEAK_ON', 'FAN_ON', 'SWING_ON']);
});

test('cloud partial-state merge uses the supplied snapshot, not the process cache', () => {
  const previous = { ...getDeviceState(id), activeModes: ['LIGHT_ON', 'HEAT_WEAK_ON', 'FAN_ON'] as const };
  const patch = cloudStateToDeviceStatePatch({ light: 'off' }, { ...previous, activeModes: [...previous.activeModes] });
  assert.deepEqual(patch.activeModes, ['HEAT_WEAK_ON', 'FAN_ON']);
  assert.deepEqual(getDeviceState(id).activeModes, []);
});

test('unchanged hourly state verification does not append history; real changes still do', async () => {
  const unchanged = { deviceId: id, state: { isOnline: true, light: 'off' as const } };
  await handleDeviceStateReport(unchanged);
  assert.equal(persistedEvents, 0);
  await handleDeviceStateReport({ deviceId: id, state: { light: 'on' } });
  assert.equal(persistedEvents, 1);
  await handleDeviceStateReport({ deviceId: id, state: { light: 'on' } });
  assert.equal(persistedEvents, 1);
  await handleDeviceStateReport({ deviceId: id, state: { faultCode: 'E1' } });
  assert.equal(persistedEvents, 2);
});

test('offline devices and heating faults cannot leak rejected actions into direct responses', async () => {
  patchDeviceState({ isOnline: false }, id);
  assert.deepEqual((await turn()).actions, []);
  patchDeviceState({ isOnline: true, faultCode: 'E1' }, id);
  result.intent = 'HEAT_STRONG_ON';
  assert.deepEqual((await turn()).actions, []);
  assert.equal(commands.length, 0);
});

test('local control during model resolution prevents the late online action', async () => {
  let release!: () => void;
  resolveGate = new Promise<void>((resolve) => { release = resolve; });
  const pending = turn();
  const rejected = assert.rejects(pending, code('STALE_VOICE_COMMAND'));
  await flush();
  await handleDeviceAccessEvent(localEvent());
  release();
  await rejected;
  assert.equal(commands.length, 0);
});

test('local control while waiting for admission also invalidates the online action', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const active = runVoiceWork(id, () => gate);
  const pending = turn();
  const rejected = assert.rejects(pending, code('STALE_VOICE_COMMAND'));
  await flush();
  await handleDeviceAccessEvent(localEvent());
  release();
  await active;
  await rejected;
  assert.equal(commands.length, 0);
});

test('confirmation emits no early action, revalidates in a new turn and cannot be reused', async () => {
  result.intent = 'HEAT_STRONG_ON';
  result.confidence = 0.6;
  const pending = await turn();
  assert.equal(pending.needConfirm, true);
  assert.deepEqual(pending.actions, []);
  const confirmed = await confirm(pending.confirmToken!);
  assert.equal(confirmed.actions[0]?.value, 'strong');
  assert.equal(commands[0].safetyDecision, 'APPROVED');
  assert.deepEqual((await confirm(pending.confirmToken!)).actions, []);
});

test('local operation, expired deadline and newly reported faults reject old confirmations', async () => {
  result.intent = 'HEAT_STRONG_ON';
  result.requiresConfirm = true;
  let pending = await turn();
  await handleDeviceAccessEvent(localEvent());
  assert.deepEqual((await confirm(pending.confirmToken!)).actions, []);
  assert.equal(commands[0].status, 'REJECTED');
  pending = await turn();
  (commands.at(-1)!.slots._voiceGuard as { expiresAt: number }).expiresAt = Date.now() - 1;
  assert.deepEqual((await confirm(pending.confirmToken!)).actions, []);
  pending = await turn();
  patchDeviceState({ faultCode: 'E1' }, id);
  assert.deepEqual((await confirm(pending.confirmToken!)).actions, []);
  assert.equal(commands.at(-1)!.status, 'REJECTED');
});

test('delivery expiry never exceeds the voice decision deadline', async () => {
  await turn();
  const command = commands[0];
  assert.equal(Date.parse(commandToPollingResponse(command)!.expireAt), (command.slots._voiceGuard as { expiresAt: number }).expiresAt);
  assert.equal(commandToPollingResponse(command)!.expireAtUnixMs, (command.slots._voiceGuard as { expiresAt: number }).expiresAt);
});

test('concurrent conflicting receipts apply device state once and preserve the first terminal status', async () => {
  await turn();
  const commandId = commands[0].id;
  const first = handleDeviceCommandResult({ deviceId: id, commandId, status: 'success', state: { light: 'on' } });
  const second = handleDeviceCommandResult({ deviceId: id, commandId, status: 'failed', state: { light: 'off' } });
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((item) => item.accepted), [true, false]);
  assert.equal(commands[0].status, 'APPLIED');
  assert.equal(getDeviceState(id).activeModes.includes('LIGHT_ON'), true);
  assert.equal(persistedEvents, 2);
});

test('duplicate receipt is idempotent and a command from another device is not accessible', async () => {
  await turn();
  const commandId = commands[0].id;
  const receipt = { deviceId: id, commandId, status: 'success' };
  await handleDeviceCommandResult(receipt);
  const count = persistedEvents;
  assert.equal((await handleDeviceCommandResult(receipt)).duplicate, true);
  assert.equal(persistedEvents, count);
  await assert.rejects(handleDeviceCommandResult({ ...receipt, deviceId: 'another-device' }), code('COMMAND_NOT_FOUND'));
  assert.equal(commands[0].status, 'APPLIED');
});

test('device receipt cannot approve a command awaiting voice confirmation', async () => {
  result.intent = 'HEAT_STRONG_ON';
  result.requiresConfirm = true;
  const pending = await turn();
  const before = persistedEvents;
  const receipt = await handleDeviceCommandResult({ deviceId: id, commandId: commands[0].id, status: 'success' });
  assert.equal(pending.needConfirm, true);
  assert.equal(receipt.accepted, false);
  assert.equal(commands[0].status, 'NEEDS_CONFIRMATION');
  assert.equal(persistedEvents, before + 1);
});
