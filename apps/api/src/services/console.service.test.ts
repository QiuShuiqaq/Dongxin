import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { DeviceEvent, DeviceProfile } from '@dongxin/shared';
import { DevicePresence, projectDevicePresence } from '../runtime/devicePresence.js';

const updatedAt = '2026-11-12T08:00:00.000Z';
const devices: DeviceProfile[] = [
  { id: 'DX-PILOT-001', name: 'Cloud pilot', model: 'DX-AI-BATH-C3-LICHUANG-AUDIO',
    protocol: 'MQTT', status: 'ONLINE', firmwareVersion: '1.1.0-online-voice',
    createdAt: updatedAt, updatedAt },
  { id: 'DX-C3-LICHUANG-AUDIO-001', name: 'Local dev board', model: 'DX-AI-BATH-C3-LICHUANG-AUDIO',
    protocol: 'MQTT', status: 'ONLINE', createdAt: updatedAt, updatedAt },
  { id: 'SIM-001', name: 'Simulator', model: 'DX-AI-BATH-01',
    protocol: 'SIMULATOR', status: 'ONLINE', createdAt: updatedAt, updatedAt },
];
let presence: DevicePresence | undefined;
const events: DeviceEvent[] = [];
const audits: Array<{ type: string; summary: string; payload: Record<string, unknown> }> = [];
let rejectAudit = false;

const replace = (path: string, namedExports: Record<string, unknown>) =>
  mock.module(new URL(path, import.meta.url).href, { namedExports });

replace('../repositories/system.repository.js', {
  listDeviceProfiles: async () => presence ? devices.map((device) => projectDevicePresence(device, presence)) : devices,
  listDeviceCommands: async () => [],
  listDeviceEvents: async () => events,
  listSystemLogs: async () => [],
  updateDeviceProfiles: async (update: (current: DeviceProfile[]) => DeviceProfile[] | Promise<DeviceProfile[]>) => {
    devices.splice(0, devices.length, ...await update(devices));
    return devices;
  },
  appendSystemLog: async (log: { type: string; summary: string; payload: Record<string, unknown> }) => {
    if (rejectAudit) throw new Error('audit unavailable');
    audits.push(log);
    return log;
  },
});
replace('../repositories/hardwareConfig.repository.js', {
  listBoardProfiles: async () => [], listProductProfiles: async () => [], listVoiceProfiles: async () => [],
});
replace('./mqttGateway.service.js', { getMqttGatewayStatus: () => ({ brokerUrl: 'mqtts://localhost' }) });
replace('./knowledge.service.js', { listKnowledgeDocuments: async () => [] });
replace('./provider.service.js', { listProviders: async () => [] });
replace('./proactive.service.js', { getProactiveSettings: async () => ({}) });
replace('./operationsAuth.service.js', { getOperationsAuthStatus: () => ({ readiness: 'READY' }) });
replace('../runtime/status.js', { getRuntimeStatus: () => ({}) });

const { getOperationsConsoleData, getOperationsDevicePage, getOperationsDeviceDetail, updateOperationsDeviceProfile } = await import('./console.service.js');

test('operations overview counts the physical pilot but hides local dev and simulator entries', async () => {
  const overview = await getOperationsConsoleData('overview');
  assert.deepEqual(overview.devices.map((device) => device.id), ['DX-PILOT-001']);
  assert.equal(overview.metrics.totalDevices, 1);
  assert.equal(overview.metrics.onlineDevices, 1);
  const ai = await getOperationsConsoleData('ai');
  assert.deepEqual(ai.devices.map((device) => device.id), ['DX-PILOT-001']);
});

test('operations device page includes the physical pilot in search results', async () => {
  const page = await getOperationsDevicePage({ page: 1, pageSize: 20, search: 'LICHUANG' });
  assert.equal(page.total, 1);
  assert.deepEqual(page.items.map((device) => device.id), ['DX-PILOT-001']);
});

test('operations list, filters and counts share fresh presence across a gateway restart', async () => {
  let now = 1_000;
  presence = new DevicePresence(() => now);
  try {
    const unknown = await getOperationsDevicePage({ page: 1, pageSize: 20, search: '', status: 'UNKNOWN' });
    assert.deepEqual(unknown.items.map((device) => device.id), ['DX-PILOT-001']);
    assert.equal((await getOperationsConsoleData('overview')).metrics.onlineDevices, 0);

    const generation = presence.startMqttSession();
    presence.observeMqtt(generation, 'DX-PILOT-001', 'ONLINE', now);
    assert.equal((await getOperationsDevicePage({ page: 1, pageSize: 20, search: '', status: 'ONLINE' })).total, 1);
    assert.equal((await getOperationsConsoleData('overview')).metrics.onlineDevices, 1);

    now += 1;
    presence.observeMqtt(generation, 'DX-PILOT-001', 'OFFLINE', now);
    assert.equal((await getOperationsDevicePage({ page: 1, pageSize: 20, search: '', status: 'OFFLINE' })).total, 1);
    assert.equal((await getOperationsConsoleData('overview')).metrics.onlineDevices, 0);

    presence.startMqttSession();
    const overview = await getOperationsConsoleData('overview');
    assert.equal(overview.devices[0]?.status, 'UNKNOWN');
    assert.equal(overview.metrics.onlineDevices, 0);
    assert.equal((await getOperationsDevicePage({ page: 1, pageSize: 20, search: '', status: 'UNKNOWN' })).total, 1);
  } finally {
    presence = undefined;
  }
});

test('device detail keeps the latest state report even after many other events', async () => {
  try {
    events.push({ id: 'state', deviceId: 'DX-PILOT-001', type: 'STATE_REPORT', payload: { temperature: 27 }, createdAt: updatedAt });
    for (let i = 0; i < 25; i++) events.push({ id: `voice-${i}`, deviceId: 'DX-PILOT-001', type: 'VOICE', payload: {}, createdAt: updatedAt });
    const detail = await getOperationsDeviceDetail('DX-PILOT-001');
    assert.equal(detail.device.status, 'ONLINE');
    assert.deepEqual(detail.lastReport?.payload, { temperature: 27 });
    assert.equal(detail.recentEvents.length, 20);
    await assert.rejects(getOperationsDeviceDetail('SIM-001'), { code: 'DEVICE_NOT_FOUND' });
    events.length = 0;
    events.push({ id: 'register', deviceId: 'DX-PILOT-001', type: 'STATE_REPORT', payload: { event: 'REGISTER' }, createdAt: updatedAt });
    assert.equal((await getOperationsDeviceDetail('DX-PILOT-001')).lastReport, null);
  } finally { events.length = 0; }
});

test('editing the operational profile changes only editable fields and writes an actor audit', async () => {
  const before = { ...devices[0]! };
  try {
    audits.length = 0;
    const detail = await updateOperationsDeviceProfile('DX-PILOT-001', { name: 'Bathroom pilot', notes: 'Installed in lab' }, 'admin');
    assert.equal(detail.device.name, 'Bathroom pilot');
    assert.equal(detail.device.notes, 'Installed in lab');
    assert.equal(detail.device.id, before.id);
    assert.equal(detail.device.model, before.model);
    assert.equal(detail.device.protocol, before.protocol);
    assert.deepEqual(audits[0]?.payload, { deviceId: before.id, actor: 'admin', fields: ['name', 'notes'], status: 'ATTEMPTED' });
    await updateOperationsDeviceProfile('DX-PILOT-001', { name: 'Bathroom pilot' }, 'admin');
    assert.equal(audits.length, 1);
    await assert.rejects(updateOperationsDeviceProfile('SIM-001', { name: 'Hidden' }, 'admin'), { code: 'DEVICE_NOT_FOUND' });
  } finally { devices[0] = before; audits.length = 0; }
});

test('device profile remains unchanged when its audit attempt cannot be recorded', async () => {
  const before = { ...devices[0]! };
  try {
    rejectAudit = true;
    await assert.rejects(updateOperationsDeviceProfile('DX-PILOT-001', { name: 'New name' }, 'admin'), /audit unavailable/);
    assert.deepEqual(devices[0], before);
  } finally { rejectAudit = false; devices[0] = before; }
});
