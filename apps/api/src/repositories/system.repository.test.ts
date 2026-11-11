import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

const dataDir = await mkdtemp(join(process.cwd(), 'device-command-test-'));
process.env.DONGXIN_DATA_DIR = dataDir;
after(async () => { await rm(dataDir, { recursive: true, force: true }); });

const { appendDeviceCommand, finishDeviceCommand, listDeviceCommands, listDeviceProfiles,
  saveDeviceProfiles, updateDeviceProfiles } = await import('./system.repository.js');

test('conflicting concurrent command results preserve the first terminal status', async () => {
  const command = await appendDeviceCommand({ deviceId: 'device-a', intent: 'LIGHT_ON', slots: {}, status: 'QUEUED' });
  const [success, failure] = await Promise.all([
    finishDeviceCommand('device-a', command.id, 'APPLIED', '2026-10-30T00:00:00.000Z'),
    finishDeviceCommand('device-a', command.id, 'FAILED', '2026-10-30T00:00:01.000Z'),
  ]);
  assert.equal(success?.outcome, 'UPDATED');
  assert.equal(failure?.outcome, 'CONFLICT');
  assert.equal(failure?.command.status, 'APPLIED');
  assert.equal((await listDeviceCommands()).find((item) => item.id === command.id)?.completedAt, '2026-10-30T00:00:00.000Z');
});

test('duplicate receipts preserve completion time and other devices cannot finish a command', async () => {
  const command = await appendDeviceCommand({ deviceId: 'device-a', intent: 'LIGHT_OFF', slots: {}, status: 'QUEUED' });
  assert.equal(await finishDeviceCommand('device-b', command.id, 'FAILED'), null);
  assert.equal((await finishDeviceCommand('device-a', command.id, 'REJECTED', '2026-10-30T00:00:02.000Z'))?.outcome, 'UPDATED');
  const duplicate = await finishDeviceCommand('device-a', command.id, 'REJECTED', '2026-10-30T00:00:03.000Z');
  assert.equal(duplicate?.outcome, 'DUPLICATE');
  assert.equal(duplicate?.command.completedAt, '2026-10-30T00:00:02.000Z');
});

test('an unconfirmed command cannot be completed by a device receipt', async () => {
  const command = await appendDeviceCommand({ deviceId: 'device-a', intent: 'HEAT_STRONG_ON', slots: {}, status: 'NEEDS_CONFIRMATION' });
  const receipt = await finishDeviceCommand('device-a', command.id, 'APPLIED');
  assert.equal(receipt?.outcome, 'CONFLICT');
  assert.equal(receipt?.command.status, 'NEEDS_CONFIRMATION');
});

test('production JSON pilot refuses a twenty-first device without changing stored profiles', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalPilotMode = process.env.DONGXIN_PILOT_JSON_MODE;
  const now = new Date().toISOString();
  const profiles = Array.from({ length: 21 }, (_, index) => ({
    id: `pilot-${index}`, model: 'DX-AI-01', name: `Pilot ${index}`,
    protocol: 'MQTT' as const, status: 'OFFLINE' as const,
    createdAt: now, updatedAt: now,
  }));
  try {
    process.env.NODE_ENV = 'production';
    process.env.DONGXIN_PILOT_JSON_MODE = 'acknowledge-local-json-limits';
    await saveDeviceProfiles(profiles.slice(0, 20));
    await assert.rejects(saveDeviceProfiles(profiles), /limited to 20/);
    await assert.rejects(updateDeviceProfiles((devices) => [...devices, profiles[20]!]), /limited to 20/);
    assert.equal((await listDeviceProfiles()).length, 20);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalPilotMode === undefined) delete process.env.DONGXIN_PILOT_JSON_MODE;
    else process.env.DONGXIN_PILOT_JSON_MODE = originalPilotMode;
  }
});
