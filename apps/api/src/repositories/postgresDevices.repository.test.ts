import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { findPostgresDevice, listPostgresDevices, operationalDeviceFilter, pagePostgresDevices, registerPostgresDevice, touchPostgresDevice, upsertPostgresDevice } from './postgresDevices.repository.js';

const now = new Date('2026-10-30T12:00:00.000Z');
const row = { id: 'dx-1', model: 'DX-AI-01', name: '样机', firmware_version: '1.0',
  protocol: 'MQTT', capabilities: {}, status: 'ONLINE', notes: '', created_at: now, updated_at: now };

function poolWith(rows: unknown[], rowCount = 1) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  return { pool: { query: async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    return { rows, rowCount };
  } } as unknown as Pool, calls };
}

test('device lookup and pagination use bounded indexed queries', async () => {
  const fixture = poolWith([row]);
  assert.equal((await findPostgresDevice(fixture.pool, 'dx-1'))?.id, 'dx-1');
  assert.deepEqual(fixture.calls[0]?.values, ['dx-1']);
  assert.equal((await listPostgresDevices(fixture.pool, 25, 'dx-0')).length, 1);
  assert.deepEqual(fixture.calls[1]?.values, ['dx-0', 25]);
  await assert.rejects(listPostgresDevices(fixture.pool, 100000), /page size/);
});

test('device upsert preserves a single identity and heartbeat changes no event table', async () => {
  const fixture = poolWith([row]);
  const device = await upsertPostgresDevice(fixture.pool, {
    id: row.id, model: row.model, name: row.name, firmwareVersion: row.firmware_version,
    protocol: 'MQTT', capabilities: {}, status: 'ONLINE', notes: '',
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  });
  assert.equal(device.id, row.id);
  assert.match(fixture.calls[0]!.sql, /ON CONFLICT \(id\) DO UPDATE/);
  assert.match(fixture.calls[0]!.sql, /WHERE dongxin\.devices\.model = EXCLUDED\.model/);
  assert.equal(await touchPostgresDevice(fixture.pool, 'dx-1'), true);
  assert.match(fixture.calls[1]!.sql, /last_seen_at = now\(\)/);
  assert.equal(fixture.calls[1]!.sql.includes('device_events'), false);
});

test('database registration rejects an existing device with a different model', async () => {
  const fixture = poolWith([]);
  await assert.rejects(upsertPostgresDevice(fixture.pool, {
    id: row.id, model: 'OTHER-MODEL', name: row.name, firmwareVersion: row.firmware_version,
    protocol: 'MQTT', capabilities: {}, status: 'ONLINE', notes: '',
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  }), /model is immutable/);
});

test('operations device page uses SQL filtering and does not load the full fleet', async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = { query: async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    return { rows: sql.startsWith('SELECT count') ? [{ total: '101' }] : [row] };
  } } as unknown as Pool;
  const result = await pagePostgresDevices(pool, { page: 2, pageSize: 20, search: 'dx_', status: 'ONLINE' });
  assert.equal(result.total, 101);
  assert.equal(result.items.length, 1);
  assert.deepEqual(calls[1]?.values, ['ONLINE', 'dx\\_', 20, 20]);
  assert.match(calls[1]!.sql, /LIMIT \$3 OFFSET \$4/);
  assert.ok(calls[0]!.sql.includes(operationalDeviceFilter()));
  assert.ok(calls[1]!.sql.includes(operationalDeviceFilter()));
});

test('operations SQL includes provisioned Lichuang MQTT pilots but not general development boards', () => {
  const filter = operationalDeviceFilter('d.');
  assert.match(filter, /d\.protocol <> 'SIMULATOR'/);
  assert.match(filter, /d\.model !~\* '\(SIMULATOR\|SUPERMINI\|LICHUANG\|DEVKIT\)'/);
  assert.match(filter, /d\.protocol = 'MQTT' AND d\.model ~\* 'LICHUANG'/);
  assert.match(filter, /d\.model !~\* '\(SIMULATOR\|SUPERMINI\|DEVKIT\)'/);
  assert.match(filter, /d\.id ~ '\^DX-PILOT-/);
});

function registrationPool(responses: Array<unknown[]>, failEvent = false) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (failEvent && sql.includes('INSERT INTO dongxin.device_events')) throw new Error('event failed');
      return { rows: responses.shift() ?? [] };
    },
    release: () => undefined,
  };
  return { pool: { connect: async () => client } as unknown as Pool, calls };
}

const registration = { deviceId: row.id, model: row.model, protocolVersion: '0.1',
  firmwareVersion: '1.1', capabilities: { light: true } };

test('production registration requires a provisioned device with the same model', async () => {
  const missing = registrationPool([[], [], []]);
  assert.deepEqual(await registerPostgresDevice(missing.pool, registration, 'MQTT'),
    { outcome: 'UNPROVISIONED', device: null });
  assert.equal(missing.calls.some((call) => call.sql.startsWith('UPDATE')), false);
  const mismatch = registrationPool([[], [{ ...row, model: 'OTHER' }], []]);
  assert.deepEqual(await registerPostgresDevice(mismatch.pool, registration, 'MQTT'),
    { outcome: 'MODEL_MISMATCH', device: null });
  assert.equal(mismatch.calls.some((call) => call.sql.startsWith('UPDATE')), false);
});

test('repeat registration refreshes the heartbeat without rewriting the name or adding an event', async () => {
  const fixture = registrationPool([[], [row], [{ ...row, firmware_version: '1.1' }], []]);
  const result = await registerPostgresDevice(fixture.pool, registration, 'MQTT');
  assert.equal(result.outcome, 'REGISTERED');
  assert.equal(result.device?.name, row.name);
  assert.equal(fixture.calls.at(-1)?.sql, 'COMMIT');
  assert.equal(fixture.calls.some((call) => call.sql.includes('INSERT INTO dongxin.device_events')), false);
  assert.equal(fixture.calls[2]?.sql.includes('name ='), false);
});

test('offline recovery stores one registration event in the same transaction', async () => {
  const offline = { ...row, status: 'OFFLINE' };
  const fixture = registrationPool([[], [offline], [row], [], []]);
  const result = await registerPostgresDevice(fixture.pool, registration, 'HTTP');
  assert.equal(result.outcome, 'REGISTERED');
  assert.match(fixture.calls[3]!.sql, /INSERT INTO dongxin\.device_events/);
  assert.equal(JSON.parse(fixture.calls[3]!.values?.[2] as string).event, 'REGISTER');
  assert.equal(fixture.calls.at(-1)?.sql, 'COMMIT');
});

test('registration event failure rolls back the device update', async () => {
  const offline = { ...row, status: 'OFFLINE' };
  const fixture = registrationPool([[], [offline], [row]], true);
  await assert.rejects(registerPostgresDevice(fixture.pool, registration, 'MQTT'), /event failed/);
  assert.equal(fixture.calls.at(-1)?.sql, 'ROLLBACK');
  assert.equal(fixture.calls.some((call) => call.sql === 'COMMIT'), false);
});
