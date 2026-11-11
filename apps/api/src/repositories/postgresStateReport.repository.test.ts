import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { applyPostgresStateReport } from './postgresStateReport.repository.js';

const deviceId = 'device-a';
const fullState = {
  isOnline: true, power: 'on', light: 'on', heater: 'off', ventilation: 'off',
  fan: 'off', swing: 'off', dry: 'off', bathMode: 'off', constantTemperature: 'off',
  targetTemperature: 37, ambientTemperature: 25, humidity: 60, hasOccupancy: false,
  faultCode: null,
};
const saved = {
  isOnline: true, activeModes: ['LIGHT_ON'], targetTemperature: 37,
  ambientTemperature: 25, humidity: 60, hasOccupancy: false,
  voiceBroadcastEnabled: true, faultCode: null, updatedAt: '2026-10-31T10:00:00.000Z',
};

function fixture(responses: Array<{ rows?: unknown[]; rowCount?: number }>, failEvent = false) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (failEvent && sql.includes('INSERT INTO dongxin.device_events')) throw new Error('event insert failed');
      return { rows: [], rowCount: 1, ...responses.shift() };
    },
    release: () => undefined,
  };
  return { pool: { connect: async () => client } as unknown as Pool, calls };
}

test('first full C3 report initializes state and one event in a transaction', async () => {
  const mock = fixture([{}, { rows: [{ id: deviceId }] }, { rows: [] }, {}, {}, {}, {}]);
  const result = await applyPostgresStateReport(mock.pool, { deviceId, state: fullState });
  assert.equal(result?.changed, true);
  assert.equal(result?.controlRevision, 0);
  assert.deepEqual(result?.state.activeModes, ['LIGHT_ON']);
  assert.equal(JSON.parse(mock.calls[3]!.values?.[1] as string).ambientTemperature, 25);
  assert.match(mock.calls[5]!.sql, /INSERT INTO dongxin\.device_events/);
  assert.equal(mock.calls.at(-1)?.sql, 'COMMIT');
});

test('unchanged partial report refreshes the snapshot and heartbeat without a new event', async () => {
  const mock = fixture([{}, { rows: [{ id: deviceId }] },
    { rows: [{ state: saved, control_revision: '8' }] }, {}, {}, {}]);
  const result = await applyPostgresStateReport(mock.pool,
    { deviceId, state: { isOnline: true, ambientTemperature: 25 } });
  assert.equal(result?.changed, false);
  assert.equal(result?.controlRevision, 8);
  assert.deepEqual(result?.state.activeModes, ['LIGHT_ON']);
  assert.equal(mock.calls.some((call) => call.sql.includes('INSERT INTO dongxin.device_events')), false);
  assert.match(mock.calls[4]!.sql, /last_seen_at = now\(\)/);
});

test('load changes advance one control revision and append one event', async () => {
  const mock = fixture([{}, { rows: [{ id: deviceId }] },
    { rows: [{ state: saved, control_revision: '8' }] }, {}, {}, {}, {}]);
  const result = await applyPostgresStateReport(mock.pool,
    { deviceId, state: { light: 'off' } });
  assert.equal(result?.controlRevision, 9);
  assert.deepEqual(result?.state.activeModes, []);
  assert.equal(mock.calls[3]!.values?.[2], 9);
  assert.match(mock.calls[5]!.sql, /INSERT INTO dongxin\.device_events/);
});

test('ambient reading changes are recorded without invalidating online control', async () => {
  const mock = fixture([{}, { rows: [{ id: deviceId }] },
    { rows: [{ state: saved, control_revision: '8' }] }, {}, {}, {}, {}]);
  const result = await applyPostgresStateReport(mock.pool,
    { deviceId, state: { ambientTemperature: 26 } });
  assert.equal(result?.changed, true);
  assert.equal(result?.controlRevision, 8);
  assert.equal(result?.state.ambientTemperature, 26);
  assert.match(mock.calls[5]!.sql, /INSERT INTO dongxin\.device_events/);
});

test('first report rejects missing fields instead of inventing production readings', async () => {
  const mock = fixture([{}, { rows: [{ id: deviceId }] }, { rows: [] }, {}]);
  await assert.rejects(applyPostgresStateReport(mock.pool,
    { deviceId, state: { light: 'on' } }));
  assert.equal(mock.calls.at(-1)?.sql, 'ROLLBACK');
  assert.equal(mock.calls.some((call) => call.sql.includes('INSERT INTO dongxin.device_states')), false);
});

test('unprovisioned device cannot initialize state', async () => {
  const mock = fixture([{}, { rows: [] }, {}]);
  assert.equal(await applyPostgresStateReport(mock.pool, { deviceId, state: fullState }), null);
  assert.equal(mock.calls.at(-1)?.sql, 'COMMIT');
  assert.equal(mock.calls.some((call) => call.sql.includes('device_states')), false);
});

test('event failure rolls back the state and online status writes', async () => {
  const mock = fixture([{}, { rows: [{ id: deviceId }] },
    { rows: [{ state: saved, control_revision: '8' }] }, {}, {}], true);
  await assert.rejects(applyPostgresStateReport(mock.pool,
    { deviceId, state: { light: 'off' } }), /event insert failed/);
  assert.equal(mock.calls.at(-1)?.sql, 'ROLLBACK');
  assert.equal(mock.calls.some((call) => call.sql === 'COMMIT'), false);
});
