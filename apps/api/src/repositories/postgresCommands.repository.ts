import { randomUUID } from 'node:crypto';
import type { DeviceCommandRecord, DeviceState } from '@dongxin/shared';
import { DeviceCommandRecordSchema, DeviceCommandResultRequestSchema, DeviceStateSchema } from '@dongxin/shared';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { controlChanged } from './postgresDeviceState.repository.js';

type CommandInput = Omit<DeviceCommandRecord, 'id' | 'createdAt'>;
type CommandRow = { id: string; device_id: string; intent: string; slots: Record<string, unknown>;
  status: string; safety_decision: string | null; speak: string; created_at_cursor: string;
  completed_at: Date | null };
type StateRow = { state: unknown; control_revision: string | number };

const columns = `id, device_id, intent, slots, status, safety_decision, speak,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor,
  completed_at`;
const CursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });

function fromRow(row: CommandRow): DeviceCommandRecord {
  return DeviceCommandRecordSchema.parse({
    id: row.id,
    deviceId: row.device_id,
    intent: row.intent,
    slots: row.slots,
    status: row.status,
    safetyDecision: row.safety_decision,
    speak: row.speak,
    createdAt: row.created_at_cursor,
    completedAt: row.completed_at?.toISOString() ?? null,
  });
}

export async function insertPostgresCommand(pool: Pool, command: CommandInput, expiresAt: Date): Promise<DeviceCommandRecord> {
  const now = new Date();
  if (expiresAt.getTime() <= now.getTime()) throw new Error('Command must expire in the future');
  const id = randomUUID();
  const result = await pool.query<CommandRow>(
    `INSERT INTO dongxin.device_commands
      (id, device_id, intent, slots, status, safety_decision, speak, created_at, expires_at, completed_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10)
     RETURNING ${columns}`,
    [id, command.deviceId, command.intent, JSON.stringify(command.slots), command.status,
      command.safetyDecision ?? null, command.speak ?? '', now, expiresAt, command.completedAt ?? null],
  );
  if (!result.rows[0]) throw new Error('PostgreSQL did not return inserted command');
  return fromRow(result.rows[0]);
}

export async function findPostgresCommand(pool: Pool, deviceId: string, commandId: string): Promise<DeviceCommandRecord | null> {
  const result = await pool.query<CommandRow>(
    `SELECT ${columns} FROM dongxin.device_commands WHERE id = $1 AND device_id = $2`,
    [commandId, deviceId],
  );
  return result.rows[0] ? fromRow(result.rows[0]) : null;
}

export async function listPendingPostgresCommands(pool: Pool, deviceId: string, limit: number): Promise<DeviceCommandRecord[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid pending command limit');
  const result = await pool.query<CommandRow>(
    `SELECT ${columns} FROM dongxin.device_commands
     WHERE device_id = $1 AND status = 'QUEUED' AND expires_at > now()
     ORDER BY created_at ASC, id ASC LIMIT $2`,
    [deviceId, limit],
  );
  return result.rows.map(fromRow);
}

export async function listPostgresDeviceCommands(
  pool: Pool, deviceId: string, limit = 50, before?: { createdAt: string; id: string },
): Promise<DeviceCommandRecord[]> {
  if (!deviceId.trim()) throw new Error('Device ID is required');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid command page size');
  const cursor = before ? CursorSchema.parse(before) : null;
  const result = await pool.query<CommandRow>(
    `SELECT ${columns} FROM dongxin.device_commands
     WHERE device_id = $1 AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid))
     ORDER BY created_at DESC, id DESC LIMIT $2`,
    [deviceId, limit, cursor?.createdAt ?? null, cursor?.id ?? null],
  );
  return result.rows.map(fromRow);
}

export async function listPostgresDeliverableCommands(
  pool: Pool, limit = 100, deviceId?: string,
): Promise<DeviceCommandRecord[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid delivery batch size');
  if (deviceId !== undefined && !deviceId.trim()) throw new Error('Device ID is required');
  const scoped = deviceId !== undefined;
  const result = await pool.query<CommandRow>(
    `SELECT ${columns} FROM dongxin.device_commands
     WHERE status = 'QUEUED' AND expires_at > now()
       AND COALESCE(slots->>'delivery', '') <> 'direct-response'
       ${scoped ? 'AND device_id = $1' : ''}
     ORDER BY created_at ASC, id ASC LIMIT $${scoped ? 2 : 1}`,
    scoped ? [deviceId, limit] : [limit],
  );
  return result.rows.map(fromRow);
}

export async function applyPostgresCommandReceipt(
  pool: Pool,
  request: unknown,
  applyState?: (previous: DeviceState) => DeviceState,
): Promise<{ command: DeviceCommandRecord; outcome: 'UPDATED' | 'DUPLICATE' | 'CONFLICT' } | null> {
  const receipt = DeviceCommandResultRequestSchema.parse(request);
  if (receipt.state && !applyState) throw new Error('A state report requires a state updater');
  const completedAt = receipt.executedAt ? new Date(receipt.executedAt) : new Date();
  if (!Number.isFinite(completedAt.getTime())) throw new Error('Invalid command execution timestamp');
  const status = receipt.status === 'success' ? 'APPLIED'
    : receipt.status === 'rejected' ? 'REJECTED' : 'FAILED';
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock state first, matching local-control transactions when a receipt carries a report.
    let stateRow: StateRow | undefined;
    if (receipt.state) {
      const foundState = await client.query<StateRow>(
        'SELECT state, control_revision FROM dongxin.device_states WHERE device_id = $1 FOR UPDATE',
        [receipt.deviceId],
      );
      stateRow = foundState.rows[0];
      if (!stateRow) throw new Error('Device state must be initialized before a command receipt');
    }
    const found = await client.query<CommandRow>(
      `SELECT ${columns} FROM dongxin.device_commands WHERE id = $1 AND device_id = $2 FOR UPDATE`,
      [receipt.commandId, receipt.deviceId],
    );
    const row = found.rows[0];
    if (!row) {
      await client.query('COMMIT');
      return null;
    }
    if (['APPLIED', 'REJECTED', 'FAILED'].includes(row.status)) {
      await client.query('COMMIT');
      return { command: fromRow(row), outcome: row.status === status ? 'DUPLICATE' : 'CONFLICT' };
    }
    if (row.status !== 'QUEUED') {
      await client.query('COMMIT');
      return { command: fromRow(row), outcome: 'CONFLICT' };
    }
    const updated = await client.query<CommandRow>(
      `UPDATE dongxin.device_commands SET status = $3, completed_at = $4
       WHERE id = $1 AND device_id = $2 RETURNING ${columns}`,
      [receipt.commandId, receipt.deviceId, status, completedAt],
    );
    if (!updated.rows[0]) throw new Error('Command disappeared during receipt update');
    if (stateRow && applyState) {
      const previous = DeviceStateSchema.parse(stateRow.state);
      const next = DeviceStateSchema.parse({
        ...applyState(structuredClone(previous)), updatedAt: new Date().toISOString(),
      });
      const currentRevision = Number(stateRow.control_revision);
      if (!Number.isSafeInteger(currentRevision) || currentRevision < 0) throw new Error('Invalid device control revision');
      const revision = currentRevision + (controlChanged(previous, next) ? 1 : 0);
      if (!Number.isSafeInteger(revision)) throw new Error('Device control revision is exhausted');
      const stateUpdated = await client.query(
        `UPDATE dongxin.device_states SET state = $2::jsonb, control_revision = $3,
         reported_at = now(), updated_at = now() WHERE device_id = $1`,
        [receipt.deviceId, JSON.stringify(next), revision],
      );
      if (stateUpdated.rowCount !== 1) throw new Error('Device state disappeared during receipt update');
    }
    await client.query(
      `INSERT INTO dongxin.device_events
       (id, device_id, event_id, event_type, payload, occurred_at)
       VALUES ($1, $2, $3, 'COMMAND_RESULT', $4::jsonb, $5)`,
      [randomUUID(), receipt.deviceId, `command-result:${receipt.commandId}`,
        JSON.stringify({
          commandId: receipt.commandId,
          status: receipt.status,
          executedAt: completedAt.toISOString(),
          mcuFrame: receipt.mcuFrame ?? null,
          executionPath: receipt.executionPath ?? null,
          message: receipt.message ?? null,
          error: receipt.error ?? null,
          state: receipt.state ?? null,
        }), completedAt],
    );
    await client.query('COMMIT');
    return { command: fromRow(updated.rows[0]!), outcome: 'UPDATED' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
