import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { DeviceStateSchema, LocalControlEventPayloadSchema } from '@dongxin/shared';
import type { DeviceState } from '@dongxin/shared';
import type { Pool, PoolClient } from 'pg';

type StateRow = { state: unknown; control_revision: string | number };
type EventRow = { payload: { request?: unknown; result?: { controlRevision?: unknown } } };

export type LocalControlOutcome = {
  outcome: 'UPDATED' | 'DUPLICATE' | 'CONFLICT';
  controlRevision: number;
  state: DeviceState;
};

export async function applyPostgresLocalControlEvent(pool: Pool, input: {
  deviceId: string;
  eventId: string;
  occurredAt?: string;
  payload: unknown;
  applyState: (previous: DeviceState) => DeviceState;
}): Promise<LocalControlOutcome> {
  const deviceId = input.deviceId.trim();
  const eventId = input.eventId.trim();
  if (!deviceId || !eventId || eventId.length > 128) throw new Error('Invalid local event identity');
  const payload = JSON.parse(JSON.stringify(LocalControlEventPayloadSchema.parse(input.payload))) as
    ReturnType<typeof LocalControlEventPayloadSchema.parse>;
  const occurredAt = input.occurredAt === undefined ? null : new Date(input.occurredAt);
  if (occurredAt !== null && !Number.isFinite(occurredAt.getTime())) throw new Error('Invalid local event timestamp');
  const request = { payload, occurredAt: occurredAt?.toISOString() ?? null };

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query<StateRow>(
      'SELECT state, control_revision FROM dongxin.device_states WHERE device_id = $1 FOR UPDATE',
      [deviceId],
    );
    const stateRow = locked.rows[0];
    if (!stateRow) throw new Error('Device state must be initialized before local control');
    const previous = DeviceStateSchema.parse(stateRow.state);
    const revision = Number(stateRow.control_revision);
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid device control revision');

    const found = await client.query<EventRow>(
      `SELECT payload FROM dongxin.device_events
       WHERE device_id = $1 AND event_id = $2 FOR UPDATE`,
      [deviceId, eventId],
    );
    const existing = found.rows[0]?.payload;
    if (existing) {
      const originalRevision = existing.result?.controlRevision;
      if (!Number.isSafeInteger(originalRevision) || (originalRevision as number) < 0) {
        throw new Error('Stored local event has an invalid control revision');
      }
      await client.query('COMMIT');
      return { outcome: isDeepStrictEqual(existing.request, request) ? 'DUPLICATE' : 'CONFLICT',
        controlRevision: originalRevision as number, state: previous };
    }

    const nextRevision = revision + 1;
    if (!Number.isSafeInteger(nextRevision)) throw new Error('Device control revision is exhausted');
    const next = DeviceStateSchema.parse({ ...input.applyState(structuredClone(previous)),
      updatedAt: new Date().toISOString() });
    const updated = await client.query<StateRow>(
      `UPDATE dongxin.device_states
       SET state = $2::jsonb, control_revision = $3, reported_at = now(), updated_at = now()
       WHERE device_id = $1 RETURNING state, control_revision`,
      [deviceId, JSON.stringify(next), nextRevision],
    );
    if (!updated.rows[0]) throw new Error('Device state disappeared during local control');
    await client.query(
      `INSERT INTO dongxin.device_events
       (id, device_id, event_id, event_type, payload, occurred_at)
       VALUES ($1, $2, $3, 'LOCAL_CONTROL', $4::jsonb, $5)`,
      [randomUUID(), deviceId, eventId,
        JSON.stringify({ request, result: { controlRevision: nextRevision } }), occurredAt],
    );
    await client.query('COMMIT');
    return { outcome: 'UPDATED', controlRevision: nextRevision,
      state: DeviceStateSchema.parse(updated.rows[0].state) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
