import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { applyPostgresCommandReceipt, findPostgresCommand, insertPostgresCommand, listPendingPostgresCommands,
  listPostgresDeliverableCommands, listPostgresDeviceCommands } from './postgresCommands.repository.js';

const id = 'c8f17c4a-0fca-49da-bdde-3f643089fbca';
const row = (status = 'QUEUED') => ({
  id, device_id: 'device-a', intent: 'LIGHT_ON', slots: {}, status,
  safety_decision: 'APPROVED', speak: '好的', created_at_cursor: '2026-10-30T12:00:00.000001Z',
  completed_at: status === 'QUEUED' ? null : new Date('2026-10-30T12:00:02.000Z'),
});

function poolWithResponses(responses: Array<unknown[]>) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      const rows = responses.shift() ?? [];
      return { rows, rowCount: sql.startsWith('UPDATE') ? 1 : rows.length };
    },
    release: () => undefined,
  };
  return { pool: { query: client.query, connect: async () => client } as unknown as Pool, calls };
}

test('command lookup and pending query are scoped to a device and bounded', async () => {
  const fixture = poolWithResponses([[row()], [row()]]);
  const command = await findPostgresCommand(fixture.pool, 'device-a', id);
  assert.equal(command?.deviceId, 'device-a');
  assert.equal(command?.createdAt, '2026-10-30T12:00:00.000001Z');
  assert.deepEqual(fixture.calls[0]?.values, [id, 'device-a']);
  const pending = await listPendingPostgresCommands(fixture.pool, 'device-a', 5);
  assert.equal(pending.length, 1);
  assert.deepEqual(fixture.calls[1]?.values, ['device-a', 5]);
  assert.match(fixture.calls[1]!.sql, /expires_at > now\(\)/);
  await assert.rejects(listPendingPostgresCommands(fixture.pool, 'device-a', 1000), /limit/);
});

test('command history uses bounded per-device keyset pages without losing microseconds', async () => {
  const fixture = poolWithResponses([[row()]]);
  const commands = await listPostgresDeviceCommands(fixture.pool, 'device-a', 20,
    { createdAt: '2026-10-30T12:00:00.000001Z', id });
  assert.equal(commands[0]?.createdAt, '2026-10-30T12:00:00.000001Z');
  assert.deepEqual(fixture.calls[0]?.values, ['device-a', 20, '2026-10-30T12:00:00.000001Z', id]);
  assert.match(fixture.calls[0]!.sql, /ORDER BY created_at DESC, id DESC LIMIT \$2/);
  await assert.rejects(listPostgresDeviceCommands(fixture.pool, 'device-a', 101), /page size/);
});

test('delivery query is bounded, expires old commands and excludes direct responses', async () => {
  const fixture = poolWithResponses([[row()], [row()]]);
  assert.equal((await listPostgresDeliverableCommands(fixture.pool, 100)).length, 1);
  assert.deepEqual(fixture.calls[0]?.values, [100]);
  assert.match(fixture.calls[0]!.sql, /expires_at > now\(\)/);
  assert.match(fixture.calls[0]!.sql, /direct-response/);
  assert.equal((await listPostgresDeliverableCommands(fixture.pool, 5, 'device-a')).length, 1);
  assert.deepEqual(fixture.calls[1]?.values, ['device-a', 5]);
  assert.match(fixture.calls[1]!.sql, /AND device_id = \$1/);
  await assert.rejects(listPostgresDeliverableCommands(fixture.pool, 501), /batch size/);
  await assert.rejects(listPostgresDeliverableCommands(fixture.pool, 5, ' '), /Device ID/);
});

test('insert stores a bounded expiry and receives the inserted row', async () => {
  const fixture = poolWithResponses([[row()]]);
  const command = await insertPostgresCommand(fixture.pool, {
    deviceId: 'device-a', intent: 'LIGHT_ON', slots: {}, status: 'QUEUED',
    safetyDecision: 'APPROVED', speak: '好的', completedAt: null,
  }, new Date(Date.now() + 60_000));
  assert.equal(command.id, id);
  assert.match(fixture.calls[0]!.sql, /RETURNING id, device_id/);
  assert.equal(fixture.calls[0]!.values?.[1], 'device-a');
  await assert.rejects(insertPostgresCommand(fixture.pool, {
    deviceId: 'device-a', intent: 'LIGHT_ON', slots: {}, status: 'QUEUED',
  }, new Date(0)), /expire in the future/);
});

test('terminal result is idempotent under a row lock', async () => {
  const fixture = poolWithResponses([[], [row('APPLIED')], []]);
  const result = await applyPostgresCommandReceipt(fixture.pool,
    { deviceId: 'device-a', commandId: id, status: 'success' });
  assert.equal(result?.outcome, 'DUPLICATE');
  assert.equal(fixture.calls.at(-1)?.sql, 'COMMIT');
  assert.equal(fixture.calls.some((call) => call.sql.startsWith('UPDATE')), false);
  assert.equal(fixture.calls.some((call) => call.sql.includes('INSERT INTO dongxin.device_events')), false);
  assert.deepEqual(fixture.calls[1]?.values, [id, 'device-a']);
});

test('conflicting late result never replaces a terminal result', async () => {
  const fixture = poolWithResponses([[], [row('APPLIED')], []]);
  const result = await applyPostgresCommandReceipt(fixture.pool,
    { deviceId: 'device-a', commandId: id, status: 'failed' });
  assert.equal(result?.outcome, 'CONFLICT');
  assert.equal(result?.command.status, 'APPLIED');
  assert.equal(fixture.calls.some((call) => call.sql.startsWith('UPDATE')), false);
});

test('first receipt commits command and one event together', async () => {
  const fixture = poolWithResponses([[], [row()], [row('REJECTED')], [], []]);
  const result = await applyPostgresCommandReceipt(fixture.pool,
    { deviceId: 'device-a', commandId: id, status: 'rejected', executedAt: '2026-10-30T12:00:02.000Z' });
  assert.equal(result?.command.status, 'REJECTED');
  assert.equal(result?.outcome, 'UPDATED');
  assert.equal(fixture.calls.at(-1)?.sql, 'COMMIT');
  assert.deepEqual(fixture.calls[2]?.values?.slice(0, 3), [id, 'device-a', 'REJECTED']);
  assert.match(fixture.calls[3]!.sql, /INSERT INTO dongxin\.device_events/);
  assert.equal(fixture.calls[3]!.values?.[2], `command-result:${id}`);
});

test('a command awaiting confirmation cannot be completed by a device receipt', async () => {
  const fixture = poolWithResponses([[], [row('NEEDS_CONFIRMATION')], []]);
  const result = await applyPostgresCommandReceipt(fixture.pool,
    { deviceId: 'device-a', commandId: id, status: 'success' });
  assert.equal(result?.outcome, 'CONFLICT');
  assert.equal(result?.command.status, 'NEEDS_CONFIRMATION');
  assert.equal(fixture.calls.some((call) => call.sql.startsWith('UPDATE')), false);
});

test('a receipt cannot finish a command owned by another device', async () => {
  const fixture = poolWithResponses([[], [], []]);
  const result = await applyPostgresCommandReceipt(fixture.pool,
    { deviceId: 'device-b', commandId: id, status: 'success' });
  assert.equal(result, null);
  assert.deepEqual(fixture.calls[1]?.values, [id, 'device-b']);
  assert.equal(fixture.calls.some((call) => call.sql.startsWith('UPDATE') || call.sql.includes('INSERT INTO dongxin.device_events')), false);
});

test('reported state and control revision share the command and event transaction', async () => {
  const state = {
    isOnline: true, activeModes: [], targetTemperature: 35, ambientTemperature: 25,
    hasOccupancy: false, voiceBroadcastEnabled: true, faultCode: null,
    updatedAt: '2026-10-30T12:00:00.000Z',
  };
  const fixture = poolWithResponses([[], [{ state, control_revision: '7' }], [row()],
    [row('APPLIED')], [], [], []]);
  const result = await applyPostgresCommandReceipt(fixture.pool,
    { deviceId: 'device-a', commandId: id, status: 'success', state: { light: 'on' } },
    (previous) => ({ ...previous, activeModes: ['LIGHT_ON'] }));
  assert.equal(result?.outcome, 'UPDATED');
  assert.match(fixture.calls[1]!.sql, /device_states.*FOR UPDATE/);
  assert.deepEqual(fixture.calls[1]!.values, ['device-a']);
  assert.deepEqual(fixture.calls[4]!.values?.slice(0, 1), ['device-a']);
  assert.equal(fixture.calls[4]!.values?.[2], 8);
  assert.match(fixture.calls[5]!.sql, /INSERT INTO dongxin\.device_events/);
  assert.equal(fixture.calls.at(-1)?.sql, 'COMMIT');
});

test('a duplicate report does not update state or append another event', async () => {
  const state = {
    isOnline: true, activeModes: ['LIGHT_ON'], targetTemperature: 35, ambientTemperature: 25,
    hasOccupancy: false, voiceBroadcastEnabled: true, faultCode: null,
    updatedAt: '2026-10-30T12:00:00.000Z',
  };
  const fixture = poolWithResponses([[], [{ state, control_revision: '8' }], [row('APPLIED')], []]);
  const result = await applyPostgresCommandReceipt(fixture.pool,
    { deviceId: 'device-a', commandId: id, status: 'success', state: { light: 'on' } },
    (previous) => previous);
  assert.equal(result?.outcome, 'DUPLICATE');
  assert.equal(fixture.calls.some((call) => call.sql.startsWith('UPDATE') || call.sql.includes('INSERT INTO dongxin.device_events')), false);
});

test('an event write failure rolls back command and state changes', async () => {
  const state = {
    isOnline: true, activeModes: [], targetTemperature: 35, ambientTemperature: 25,
    hasOccupancy: false, voiceBroadcastEnabled: true, faultCode: null,
    updatedAt: '2026-10-30T12:00:00.000Z',
  };
  const calls: string[] = [];
  const responses = [[], [{ state, control_revision: '7' }], [row()], [row('APPLIED')], []];
  const client = {
    query: async (sql: string) => {
      calls.push(sql);
      if (sql.includes('INSERT INTO dongxin.device_events')) throw new Error('event insert failed');
      return { rows: responses.shift() ?? [], rowCount: 1 };
    },
    release: () => undefined,
  };
  await assert.rejects(applyPostgresCommandReceipt({ connect: async () => client } as unknown as Pool,
    { deviceId: 'device-a', commandId: id, status: 'success', state: { light: 'on' } },
    (previous) => ({ ...previous, activeModes: ['LIGHT_ON'] })), /event insert failed/);
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(calls.includes('COMMIT'), false);
});

test('receipt state requires an updater and timestamps must be valid', async () => {
  const fixture = poolWithResponses([]);
  await assert.rejects(applyPostgresCommandReceipt(fixture.pool,
    { deviceId: 'device-a', commandId: id, status: 'success', state: { light: 'on' } }), /state updater/);
  await assert.rejects(applyPostgresCommandReceipt(fixture.pool,
    { deviceId: 'device-a', commandId: id, status: 'success', executedAt: 'not-a-time' }), /timestamp/);
  assert.equal(fixture.calls.length, 0);
});

test('an uninitialized device state rejects a reported receipt without finishing the command', async () => {
  const fixture = poolWithResponses([[], [], []]);
  await assert.rejects(applyPostgresCommandReceipt(fixture.pool,
    { deviceId: 'device-a', commandId: id, status: 'success', state: { light: 'on' } },
    (previous) => previous), /must be initialized/);
  assert.equal(fixture.calls.at(-1)?.sql, 'ROLLBACK');
  assert.equal(fixture.calls.some((call) => call.sql.includes('device_commands') || call.sql.startsWith('UPDATE')), false);
});
