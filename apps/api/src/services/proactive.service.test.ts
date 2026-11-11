import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, mock, test } from 'node:test';
import type { ProactiveSettings } from '@dongxin/shared';

let deviceId = 'proactive-device-fixture';
let settings: ProactiveSettings;
let logs: Array<{ createdAt: string; payload: Record<string, unknown> }> = [];
let plays: Array<{ text: string; listenAfterPlayback: boolean }> = [];
let busy = false;
let online = true;
let stageCount = 0;
const state = {
  isOnline: true, activeModes: [], targetTemperature: 35, ambientTemperature: 20,
  hasOccupancy: false, voiceBroadcastEnabled: true, faultCode: null,
  updatedAt: new Date().toISOString(),
};
let occupancyWrites = 0;
const replace = (path: string, namedExports: Record<string, unknown>) =>
  mock.module(new URL(path, import.meta.url).href, { namedExports });
replace('../repositories/system.repository.js', {
  getProactiveSettings: async () => settings,
  saveProactiveSettings: async (value: ProactiveSettings) => { settings = value; return value; },
});
replace('./device.service.js', {
  getCurrentDeviceState: () => state,
  patchCurrentDeviceState: (patch: object) => { occupancyWrites++; return { ...state, ...patch }; },
});
replace('./voiceModuleTest.service.js', {
  isDeviceAudioBusy: () => busy,
  testTts: async (body: { text: string; listenAfterPlayback: boolean }, options: { onCreated?: (id: string) => void }) => {
    options.onCreated?.('play-fixture');
    plays.push({ text: body.text, listenAfterPlayback: body.listenAfterPlayback });
    return { id: 'play-fixture' };
  },
});
replace('./voiceTest.service.js', { getVoiceTestSessions: async () => [] });
replace('./deviceRegistry.service.js', { getDevice: async () => ({ status: online ? 'ONLINE' : 'OFFLINE', capabilities: { audioPlayback: true } }) });
replace('./proactiveConfirmation.service.js', {
  clearProactiveConfirmation: () => undefined,
  stageProactiveConfirmation: () => { stageCount++; },
});
replace('./log.service.js', {
  appendLog: async (entry: { type: string; payload: Record<string, unknown> }) => {
    if (entry.type === 'PROACTIVE') logs.unshift({ createdAt: new Date().toISOString(), payload: entry.payload });
  },
  listLogs: async () => logs,
});
replace('../repositories/deviceVolume.repository.js', { getDeviceVolume: async () => 20 });
const { handleProactiveEvent, simulateProactiveEvent, simulateProactiveEntrance } = await import('./proactive.service.js');

beforeEach(() => {
  deviceId = `proactive-${randomUUID()}`;
  settings = {
    enabled: true, mode: 'PRACTICAL', minIntervalMinutes: 10,
    quietHours: { enabled: true, start: '22:00', end: '07:00' },
    updatedAt: new Date().toISOString(),
  };
  logs = [];
  plays = [];
  busy = false;
  online = true;
  stageCount = 0;
  occupancyWrites = 0;
});

test('a real sensor entrance opens a conversation and per-device cooldown blocks repeats', async () => {
  settings.quietHours.enabled = false;
  const event = { deviceId, eventType: 'OCCUPANCY_ENTER', hasOccupancy: true, occurredAt: new Date().toISOString() };
  const first = await handleProactiveEvent(event, true);
  assert.equal(first.shouldSpeak, true);
  assert.equal(plays.length, 1);
  assert.equal(plays[0]?.listenAfterPlayback, true);
  assert.equal(first.suggestedIntent, null);
  assert.equal(first.requiresConfirm, false);
  assert.equal(stageCount, 0);
  const repeated = await handleProactiveEvent(event, true);
  assert.equal(repeated.shouldSpeak, false);
  assert.equal(plays.length, 1);
});

test('environment and runtime events ask before any suggested control', async () => {
  settings.quietHours.enabled = false;
  for (const scenario of [
    { eventType: 'HIGH_HUMIDITY', suggestedIntent: 'VENTILATION_ON' },
    { eventType: 'LONG_RUNNING', suggestedIntent: 'STANDBY' },
  ] as const) {
    const result = await handleProactiveEvent({
      deviceId: `${deviceId}-${scenario.eventType}`,
      eventType: scenario.eventType,
      occurredAt: new Date().toISOString(),
    }, true);
    assert.equal(result.shouldSpeak, true);
    assert.equal(result.requiresConfirm, true);
    assert.equal(result.suggestedIntent, scenario.suggestedIntent);
  }
  assert.equal(plays.length, 2);
  assert.equal(plays.every((play) => play.listenAfterPlayback), true);
  assert.equal(stageCount, 2);
});

test('turning proactive communication off suppresses all three scene classes', async () => {
  settings.enabled = false;
  settings.quietHours.enabled = false;
  for (const eventType of ['OCCUPANCY_ENTER', 'HIGH_HUMIDITY', 'LONG_RUNNING']) {
    const result = await handleProactiveEvent({ deviceId, eventType,
      occurredAt: new Date().toISOString() }, true);
    assert.equal(result.shouldSpeak, false);
    assert.equal(result.suggestedIntent, null);
  }
  assert.equal(plays.length, 0);
  assert.equal(stageCount, 0);
});

test('quiet hours, busy playback and offline device suppress real sensor playback', async () => {
  settings.quietHours = { enabled: true, start: '00:00', end: '23:59' };
  const event = { deviceId, eventType: 'OCCUPANCY_ENTER', occurredAt: new Date().toISOString() };
  assert.equal((await handleProactiveEvent(event, true)).shouldSpeak, false);
  settings.quietHours.enabled = false;
  busy = true;
  assert.equal((await handleProactiveEvent(event, true)).shouldSpeak, false);
  busy = false;
  online = false;
  assert.equal((await handleProactiveEvent(event, true)).shouldSpeak, false);
  assert.equal(plays.length, 0);
});

test('development-only entrance does not alter real occupancy or consume real-event cooldown', async () => {
  settings.quietHours.enabled = false;
  const result = await simulateProactiveEntrance({ deviceId, playToDevice: false });
  assert.equal(result.simulation, true);
  assert.equal(state.hasOccupancy, false);
  assert.equal(plays.length, 0);
  const decision = await handleProactiveEvent({ deviceId, eventType: 'OCCUPANCY_ENTER', occurredAt: new Date().toISOString() }, true);
  assert.equal(decision.shouldSpeak, true);
});

test('all hardware simulations share policy without changing real state or cooldown', async () => {
  settings.quietHours.enabled = false;
  for (const eventType of ['OCCUPANCY_ENTER', 'LOW_TEMPERATURE', 'HIGH_HUMIDITY', 'LONG_RUNNING'] as const) {
    const result = await simulateProactiveEvent({ deviceId, eventType, playToDevice: false,
      ambientTemperature: 21, humidity: 72 });
    assert.equal(result.event.eventType, eventType);
    assert.equal(result.simulation, true);
    assert.equal(result.actionExecuted, false);
    assert.equal(result.decision.shouldSpeak, true);
  }
  assert.equal(occupancyWrites, 0);
  assert.equal(plays.length, 0);
  assert.equal((await handleProactiveEvent({ deviceId, eventType: 'OCCUPANCY_ENTER',
    occurredAt: new Date().toISOString() }, true)).shouldSpeak, true);
});

test('entrance speaks only supplied readings and opens listening without control', async () => {
  settings.quietHours.enabled = false;
  const noReadings = await simulateProactiveEvent({ deviceId, eventType: 'OCCUPANCY_ENTER', playToDevice: true });
  assert.doesNotMatch(noReadings.decision.speak, /度|湿度|有点凉/);
  assert.equal(noReadings.decision.suggestedIntent, null);
  assert.equal(plays[0]?.listenAfterPlayback, true);
  assert.equal(stageCount, 0);
  const withReadings = await simulateProactiveEvent({ deviceId, eventType: 'OCCUPANCY_ENTER',
    ambientTemperature: 24, humidity: 65, playToDevice: false });
  assert.match(withReadings.decision.speak, /24度/);
  assert.match(withReadings.decision.speak, /65%/);
  assert.equal(occupancyWrites, 0);
});

test('stale sensor events after reconnect cannot start a late conversation', async () => {
  settings.quietHours.enabled = false;
  const decision = await handleProactiveEvent({ deviceId, eventType: 'OCCUPANCY_ENTER', occurredAt: new Date(Date.now() - 60_000).toISOString() }, true);
  assert.equal(decision.shouldSpeak, false);
  assert.equal(plays.length, 0);
  assert.equal(occupancyWrites, 0);
});

test('parallel sensor reports cannot start two prompts for one device', async () => {
  settings.quietHours.enabled = false;
  const event = { deviceId, eventType: 'OCCUPANCY_ENTER', occurredAt: new Date().toISOString() };
  await Promise.all([handleProactiveEvent(event, true), handleProactiveEvent(event, true)]);
  assert.equal(plays.length, 1);
});
