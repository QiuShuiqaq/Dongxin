import type { DeviceState } from '@dongxin/shared';
import { DeviceStateSchema } from '@dongxin/shared';
import type { Pool, PoolClient } from 'pg';

type StateRow = {
  state: unknown;
  control_revision: string | number;
};

export type StoredDeviceState = {
  state: DeviceState;
  controlRevision: number;
};

function fromRow(row: StateRow): StoredDeviceState {
  const controlRevision = Number(row.control_revision);
  if (!Number.isSafeInteger(controlRevision) || controlRevision < 0) {
    throw new Error('Device control revision is outside the safe integer range');
  }
  return { state: DeviceStateSchema.parse(row.state), controlRevision };
}

export function controlChanged(previous: DeviceState, next: DeviceState): boolean {
  return previous.targetTemperature !== next.targetTemperature ||
    previous.faultCode !== next.faultCode ||
    JSON.stringify([...previous.activeModes].sort()) !== JSON.stringify([...next.activeModes].sort());
}

export async function findPostgresDeviceState(pool: Pool, deviceId: string): Promise<StoredDeviceState | null> {
  const result = await pool.query<StateRow>(
    'SELECT state, control_revision FROM dongxin.device_states WHERE device_id = $1',
    [deviceId],
  );
  return result.rows[0] ? fromRow(result.rows[0]) : null;
}

/** Inserts the first verified full snapshot without replacing an existing device state. */
export async function initializePostgresDeviceState(
  pool: Pool, deviceId: string, state: DeviceState,
): Promise<StoredDeviceState> {
  const snapshot = DeviceStateSchema.parse(state);
  await pool.query(
    `INSERT INTO dongxin.device_states (device_id, state)
     VALUES ($1, $2::jsonb) ON CONFLICT (device_id) DO NOTHING`,
    [deviceId, JSON.stringify(snapshot)],
  );
  const stored = await findPostgresDeviceState(pool, deviceId);
  if (!stored) throw new Error('PostgreSQL did not persist the initial device state');
  return stored;
}

/** A row lock keeps partial reports and their control revision in the same transaction. */
export async function patchPostgresDeviceState(
  pool: Pool, deviceId: string, patch: Partial<DeviceState>,
): Promise<StoredDeviceState | null> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query<StateRow>(
      'SELECT state, control_revision FROM dongxin.device_states WHERE device_id = $1 FOR UPDATE',
      [deviceId],
    );
    if (!found.rows[0]) {
      await client.query('COMMIT');
      return null;
    }
    const previous = fromRow(found.rows[0]);
    const definedPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    const next = DeviceStateSchema.parse({
      ...previous.state,
      ...definedPatch,
      updatedAt: new Date().toISOString(),
    });
    const revision = previous.controlRevision + (controlChanged(previous.state, next) ? 1 : 0);
    if (!Number.isSafeInteger(revision)) throw new Error('Device control revision is exhausted');
    const updated = await client.query<StateRow>(
      `UPDATE dongxin.device_states SET state = $2::jsonb, control_revision = $3,
       reported_at = now(), updated_at = now()
       WHERE device_id = $1 RETURNING state, control_revision`,
      [deviceId, JSON.stringify(next), revision],
    );
    if (!updated.rows[0]) throw new Error('Device state disappeared during update');
    await client.query('COMMIT');
    return fromRow(updated.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** A local action supersedes older online decisions even when no load changes. */
export async function bumpPostgresDeviceControlRevision(pool: Pool, deviceId: string): Promise<number | null> {
  const result = await pool.query<StateRow>(
    `UPDATE dongxin.device_states SET control_revision = control_revision + 1, updated_at = now()
     WHERE device_id = $1 AND control_revision < 9007199254740991
     RETURNING state, control_revision`,
    [deviceId],
  );
  return result.rows[0] ? fromRow(result.rows[0]).controlRevision : null;
}
