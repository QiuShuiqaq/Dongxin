import { randomUUID } from 'node:crypto';
import type { DeviceState } from '@dongxin/shared';
import { DeviceStateReportRequestSchema, DeviceStateSchema } from '@dongxin/shared';
import type { Pool, PoolClient } from 'pg';
import { cloudStateToDeviceStatePatch, deviceStateChanged, initialDeviceStateFromCloud } from '../runtime/deviceCloudState.js';
import { controlChanged } from './postgresDeviceState.repository.js';

type StateRow = { state: unknown; control_revision: string | number };

export type PostgresStateReport = {
  state: DeviceState;
  controlRevision: number;
  changed: boolean;
};

export async function applyPostgresStateReport(pool: Pool, request: unknown): Promise<PostgresStateReport | null> {
  const body = DeviceStateReportRequestSchema.parse(request);
  const occurredAt = body.reportedAt ? new Date(body.reportedAt) : new Date();
  if (!Number.isFinite(occurredAt.getTime())) throw new Error('Invalid state report timestamp');

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const device = await client.query<{ id: string }>(
      'SELECT id FROM dongxin.devices WHERE id = $1 FOR UPDATE', [body.deviceId],
    );
    if (!device.rows[0]) {
      await client.query('COMMIT');
      return null;
    }
    const found = await client.query<StateRow>(
      'SELECT state, control_revision FROM dongxin.device_states WHERE device_id = $1 FOR UPDATE',
      [body.deviceId],
    );
    const stored = found.rows[0];
    let next: DeviceState;
    let revision = 0;
    let changed = true;
    if (!stored) {
      next = initialDeviceStateFromCloud(body.state);
      const inserted = await client.query(
        'INSERT INTO dongxin.device_states (device_id, state) VALUES ($1, $2::jsonb)',
        [body.deviceId, JSON.stringify(next)],
      );
      if (inserted.rowCount !== 1) throw new Error('Device state was not initialized');
    } else {
      const previous = DeviceStateSchema.parse(stored.state);
      const previousRevision = Number(stored.control_revision);
      if (!Number.isSafeInteger(previousRevision) || previousRevision < 0) throw new Error('Invalid device control revision');
      const patch = cloudStateToDeviceStatePatch(body.state, previous);
      const definedPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
      next = DeviceStateSchema.parse({ ...previous, ...definedPatch, updatedAt: new Date().toISOString() });
      changed = deviceStateChanged(previous, next);
      revision = previousRevision + (controlChanged(previous, next) ? 1 : 0);
      if (!Number.isSafeInteger(revision)) throw new Error('Device control revision is exhausted');
      const updated = await client.query(
        `UPDATE dongxin.device_states SET state = $2::jsonb, control_revision = $3,
         reported_at = now(), updated_at = now() WHERE device_id = $1`,
        [body.deviceId, JSON.stringify(next), revision],
      );
      if (updated.rowCount !== 1) throw new Error('Device state disappeared during report');
    }
    const profileUpdated = await client.query(
      `UPDATE dongxin.devices SET status = COALESCE($2, status), last_seen_at = now(), updated_at = now()
       WHERE id = $1`,
      [body.deviceId, body.state.isOnline === undefined ? null : body.state.isOnline ? 'ONLINE' : 'OFFLINE'],
    );
    if (profileUpdated.rowCount !== 1) throw new Error('Device disappeared during state report');
    if (changed) {
      await client.query(
        `INSERT INTO dongxin.device_events (id, device_id, event_type, payload, occurred_at)
         VALUES ($1, $2, 'STATE_REPORT', $3::jsonb, $4)`,
        [randomUUID(), body.deviceId,
          JSON.stringify({ reportedAt: occurredAt.toISOString(), ...body.state }), occurredAt],
      );
    }
    await client.query('COMMIT');
    return { state: next, controlRevision: revision, changed };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
