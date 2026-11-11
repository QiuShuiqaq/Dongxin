import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DeviceState } from '@dongxin/shared';
import type { Pool } from 'pg';
import { applyPostgresLocalControlEvent } from './postgresLocalControl.repository.js';

const state: DeviceState = { isOnline: true, activeModes: [], targetTemperature: 40,
  ambientTemperature: 26, humidity: 58, hasOccupancy: true,
  voiceBroadcastEnabled: true, faultCode: null, updatedAt: '2026-10-31T00:00:00.000Z' };
const payload = { source: 'CI1302', intent: 'LIGHT_ON', state: { light: 'on' } };
const input = { deviceId: 'DX-001', eventId: 'boot-1-2', payload, occurredAt: '2026-10-31T00:00:01.000Z',
  applyState: (previous: DeviceState): DeviceState => ({ ...previous, activeModes: ['LIGHT_ON'] }) };

function fixture(responses: Array<unknown[]>, failOn?: string) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = { query: async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    if (failOn && sql.includes(failOn)) throw new Error('fixture write failed');
    return { rows: responses.shift() ?? [] };
  }, release: () => undefined };
  return { pool: { connect: async () => client } as unknown as Pool, calls };
}

test('new local event updates state, advances one revision and stores identity in one transaction', async () => {
  const next = { ...state, activeModes: ['LIGHT_ON'] };
  const mock = fixture([[], [{ state, control_revision: '8' }], [], [{ state: next, control_revision: '9' }], [], []]);
  const result = await applyPostgresLocalControlEvent(mock.pool, input);
  assert.equal(result.outcome, 'UPDATED');
  assert.equal(result.controlRevision, 9);
  assert.deepEqual(result.state.activeModes, ['LIGHT_ON']);
  assert.equal(mock.calls[0]?.sql, 'BEGIN');
  assert.match(mock.calls[1]!.sql, /FOR UPDATE/);
  assert.equal(mock.calls[3]?.values?.[2], 9);
  assert.equal(mock.calls[4]?.values?.[2], input.eventId);
  assert.equal(mock.calls.at(-1)?.sql, 'COMMIT');
});

test('duplicate local event returns original revision without reapplying state', async () => {
  const original = { payload, occurredAt: input.occurredAt };
  const mock = fixture([[], [{ state, control_revision: '12' }], [
    { payload: { request: original, result: { controlRevision: 9 } } },
  ], []]);
  const result = await applyPostgresLocalControlEvent(mock.pool, input);
  assert.equal(result.outcome, 'DUPLICATE');
  assert.equal(result.controlRevision, 9);
  assert.equal(mock.calls.some((call) => call.sql.includes('UPDATE dongxin.device_states')), false);
  assert.equal(mock.calls.at(-1)?.sql, 'COMMIT');
});

test('same identity with changed content conflicts and never touches the state', async () => {
  const mock = fixture([[], [{ state, control_revision: '12' }], [
    { payload: { request: { payload, occurredAt: input.occurredAt }, result: { controlRevision: 9 } } },
  ], []]);
  const result = await applyPostgresLocalControlEvent(mock.pool, {
    ...input, payload: { ...payload, intent: 'LIGHT_OFF' },
  });
  assert.equal(result.outcome, 'CONFLICT');
  assert.equal(mock.calls.some((call) => call.sql.includes('UPDATE dongxin.device_states')), false);
});

test('event insert failure rolls back the state revision and event together', async () => {
  const mock = fixture([[], [{ state, control_revision: '8' }], [],
    [{ state: { ...state, activeModes: ['LIGHT_ON'] }, control_revision: '9' }], []],
    'INSERT INTO dongxin.device_events');
  await assert.rejects(applyPostgresLocalControlEvent(mock.pool, input), /fixture write failed/);
  assert.equal(mock.calls.at(-1)?.sql, 'ROLLBACK');
});

test('uninitialized state and invalid event data fail closed', async () => {
  const mock = fixture([[], [], []]);
  await assert.rejects(applyPostgresLocalControlEvent(mock.pool, input), /state must be initialized/);
  assert.equal(mock.calls.at(-1)?.sql, 'ROLLBACK');
  await assert.rejects(applyPostgresLocalControlEvent(mock.pool, { ...input, eventId: '' }), /identity/);
});
