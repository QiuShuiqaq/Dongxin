import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DeviceState } from '@dongxin/shared';
import type { Pool } from 'pg';
import {
  bumpPostgresDeviceControlRevision,
  findPostgresDeviceState,
  initializePostgresDeviceState,
  patchPostgresDeviceState,
} from './postgresDeviceState.repository.js';

const state: DeviceState = {
  isOnline: true,
  activeModes: ['LIGHT_ON', 'FAN_ON'],
  targetTemperature: 40,
  ambientTemperature: 26,
  humidity: 58,
  hasOccupancy: false,
  voiceBroadcastEnabled: true,
  faultCode: null,
  updatedAt: '2026-10-30T00:00:00.000Z',
};

type QueryCall = { sql: string; values?: unknown[] };
function poolWithResponses(responses: Array<Array<{ state: DeviceState; control_revision: string }>>) {
  const calls: QueryCall[] = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return { rows: responses.shift() ?? [] };
    },
    release: () => undefined,
  };
  return { pool: { query: client.query, connect: async () => client } as unknown as Pool, calls };
}

test('state lookup validates a persisted snapshot and safe revision', async () => {
  const fixture = poolWithResponses([[{ state, control_revision: '12' }]]);
  assert.deepEqual(await findPostgresDeviceState(fixture.pool, 'device-a'), { state, controlRevision: 12 });
  assert.deepEqual(fixture.calls[0]?.values, ['device-a']);
  const missing = poolWithResponses([[]]);
  assert.equal(await findPostgresDeviceState(missing.pool, 'device-a'), null);
  const overflow = poolWithResponses([[{ state, control_revision: '9007199254740992' }]]);
  await assert.rejects(findPostgresDeviceState(overflow.pool, 'device-a'), /safe integer/);
});

test('first state initialization cannot overwrite an existing snapshot', async () => {
  const existing = { ...state, activeModes: ['HEAT_WEAK_ON' as const] };
  const fixture = poolWithResponses([[], [{ state: existing, control_revision: '4' }]]);
  const saved = await initializePostgresDeviceState(fixture.pool, 'device-a', state);
  assert.deepEqual(saved.state.activeModes, ['HEAT_WEAK_ON']);
  assert.equal(saved.controlRevision, 4);
  assert.match(fixture.calls[0]!.sql, /ON CONFLICT \(device_id\) DO NOTHING/);
});

test('partial status updates preserve other fields and reordered modes do not bump control revision', async () => {
  const fixture = poolWithResponses([[], [{ state, control_revision: '8' }], [{
    state: { ...state, activeModes: ['FAN_ON', 'LIGHT_ON'], ambientTemperature: 27 }, control_revision: '8',
  }], []]);
  const updated = await patchPostgresDeviceState(fixture.pool, 'device-a', {
    activeModes: ['FAN_ON', 'LIGHT_ON'], ambientTemperature: 27,
  });
  assert.equal(updated?.controlRevision, 8);
  assert.equal(updated?.state.targetTemperature, 40);
  assert.match(fixture.calls[1]!.sql, /FOR UPDATE/);
  assert.equal(fixture.calls[2]?.values?.[2], 8);
  const payload = JSON.parse(String(fixture.calls[2]?.values?.[1])) as DeviceState;
  assert.equal(payload.targetTemperature, 40);
  assert.equal(fixture.calls.at(-1)?.sql, 'COMMIT');
});

test('changed load state bumps revision once in the same transaction', async () => {
  const fixture = poolWithResponses([[], [{ state, control_revision: '8' }], [{
    state: { ...state, activeModes: ['LIGHT_ON'] }, control_revision: '9',
  }], []]);
  const updated = await patchPostgresDeviceState(fixture.pool, 'device-a', { activeModes: ['LIGHT_ON'] });
  assert.equal(updated?.controlRevision, 9);
  assert.equal(fixture.calls[2]?.values?.[2], 9);
});

test('missing or malformed state cannot produce a partial write', async () => {
  const missing = poolWithResponses([[], [], []]);
  assert.equal(await patchPostgresDeviceState(missing.pool, 'device-a', { faultCode: 'E1' }), null);
  assert.equal(missing.calls.some((call) => call.sql.startsWith('UPDATE')), false);
  const invalid = poolWithResponses([[], [{ state, control_revision: '2' }], []]);
  await assert.rejects(patchPostgresDeviceState(invalid.pool, 'device-a', { targetTemperature: 99 }), /too_big/);
  assert.equal(invalid.calls.at(-1)?.sql, 'ROLLBACK');
});

test('a local operation advances the persistent revision even without a state change', async () => {
  const fixture = poolWithResponses([[{ state, control_revision: '13' }]]);
  assert.equal(await bumpPostgresDeviceControlRevision(fixture.pool, 'device-a'), 13);
  assert.match(fixture.calls[0]!.sql, /control_revision = control_revision \+ 1/);
  assert.deepEqual(fixture.calls[0]?.values, ['device-a']);
});
