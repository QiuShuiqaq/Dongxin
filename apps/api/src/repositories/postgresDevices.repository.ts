import { randomUUID } from 'node:crypto';
import type { DeviceProfile, DeviceRegisterRequest } from '@dongxin/shared';
import { DeviceProfileSchema, DeviceRegisterRequestSchema } from '@dongxin/shared';
import type { Pool, PoolClient } from 'pg';
import { DEVELOPMENT_MODEL_PATTERN, OPERATIONAL_PILOT_ID_PATTERN } from '../runtime/operationsDeviceVisibility.js';

type DeviceRow = { id: string; model: string; name: string; firmware_version: string | null;
  protocol: string; capabilities: Record<string, boolean>; status: string; notes: string;
  created_at: Date; updated_at: Date };

const columns = 'id, model, name, firmware_version, protocol, capabilities, status, notes, created_at, updated_at';
export function operationalDeviceFilter(alias = ''): string {
  return `${alias}protocol <> 'SIMULATOR' AND (
    ${alias}model !~* '${DEVELOPMENT_MODEL_PATTERN}'
    OR (${alias}protocol = 'MQTT' AND ${alias}model ~* 'LICHUANG'
      AND ${alias}model !~* '(SIMULATOR|SUPERMINI|DEVKIT)'
      AND ${alias}id ~ '${OPERATIONAL_PILOT_ID_PATTERN}')
  )`;
}

function fromRow(row: DeviceRow): DeviceProfile {
  return DeviceProfileSchema.parse({
    id: row.id, model: row.model, name: row.name, firmwareVersion: row.firmware_version,
    protocol: row.protocol, capabilities: row.capabilities, status: row.status, notes: row.notes,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  });
}

export async function findPostgresDevice(pool: Pool, deviceId: string): Promise<DeviceProfile | null> {
  const result = await pool.query<DeviceRow>(`SELECT ${columns} FROM dongxin.devices WHERE id = $1`, [deviceId]);
  return result.rows[0] ? fromRow(result.rows[0]) : null;
}

export async function listPostgresDevices(pool: Pool, limit = 100, afterId = ''): Promise<DeviceProfile[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid device page size');
  const result = await pool.query<DeviceRow>(
    `SELECT ${columns} FROM dongxin.devices WHERE id > $1 ORDER BY id ASC LIMIT $2`,
    [afterId, limit],
  );
  return result.rows.map(fromRow);
}

export async function pagePostgresDevices(
  pool: Pool,
  query: { page: number; pageSize: number; search: string; status?: string },
): Promise<{ items: DeviceProfile[]; total: number; page: number }> {
  if (!Number.isInteger(query.page) || query.page < 1 ||
      !Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) {
    throw new Error('Invalid device page');
  }
  const search = query.search.trim().slice(0, 100).replace(/[\\%_]/g, '\\$&');
  const filters = `${operationalDeviceFilter()}
    AND ($1::text IS NULL OR status = $1)
    AND ($2::text = '' OR id ILIKE '%' || $2 || '%' ESCAPE '\\'
      OR name ILIKE '%' || $2 || '%' ESCAPE '\\'
      OR model ILIKE '%' || $2 || '%' ESCAPE '\\'
      OR firmware_version ILIKE '%' || $2 || '%' ESCAPE '\\')`;
  const values = [query.status ?? null, search];
  const count = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM dongxin.devices WHERE ${filters}`, values,
  );
  const result = await pool.query<DeviceRow>(
    `SELECT ${columns} FROM dongxin.devices WHERE ${filters}
     ORDER BY updated_at DESC, id ASC LIMIT $3 OFFSET $4`,
    [...values, query.pageSize, (query.page - 1) * query.pageSize],
  );
  return { items: result.rows.map(fromRow), total: Number(count.rows[0]?.total ?? 0), page: query.page };
}

export async function upsertPostgresDevice(pool: Pool, input: DeviceProfile): Promise<DeviceProfile> {
  const device = DeviceProfileSchema.parse(input);
  const result = await pool.query<DeviceRow>(
    `INSERT INTO dongxin.devices
      (id, model, name, firmware_version, protocol, capabilities, status, notes, created_at, updated_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10,
       CASE WHEN $7 = 'ONLINE' THEN $10::timestamptz ELSE NULL END)
     ON CONFLICT (id) DO UPDATE SET
       model = EXCLUDED.model, name = EXCLUDED.name, firmware_version = EXCLUDED.firmware_version,
       protocol = EXCLUDED.protocol, capabilities = EXCLUDED.capabilities, status = EXCLUDED.status,
       notes = EXCLUDED.notes, updated_at = EXCLUDED.updated_at,
       last_seen_at = CASE WHEN EXCLUDED.status = 'ONLINE' THEN EXCLUDED.updated_at ELSE dongxin.devices.last_seen_at END
     WHERE dongxin.devices.model = EXCLUDED.model
     RETURNING ${columns}`,
    [device.id, device.model, device.name, device.firmwareVersion ?? null, device.protocol,
      JSON.stringify(device.capabilities ?? {}), device.status, device.notes ?? '',
      device.createdAt, device.updatedAt],
  );
  if (!result.rows[0]) throw new Error('Device model is immutable after registration');
  return fromRow(result.rows[0]);
}

export async function touchPostgresDevice(pool: Pool, deviceId: string, firmwareVersion?: string | null): Promise<boolean> {
  const result = await pool.query(
    `UPDATE dongxin.devices SET status = 'ONLINE', last_seen_at = now(),
       firmware_version = COALESCE($2, firmware_version), updated_at = now()
     WHERE id = $1`,
    [deviceId, firmwareVersion ?? null],
  );
  return result.rowCount === 1;
}

export async function registerPostgresDevice(
  pool: Pool,
  request: DeviceRegisterRequest,
  transport: 'HTTP' | 'MQTT',
): Promise<{ outcome: 'REGISTERED' | 'UNPROVISIONED' | 'MODEL_MISMATCH'; device: DeviceProfile | null }> {
  const body = DeviceRegisterRequestSchema.parse(request);
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query<DeviceRow>(
      `SELECT ${columns} FROM dongxin.devices WHERE id = $1 FOR UPDATE`,
      [body.deviceId],
    );
    const current = found.rows[0];
    if (!current || current.model !== body.model) {
      await client.query('COMMIT');
      return { outcome: current ? 'MODEL_MISMATCH' : 'UNPROVISIONED', device: null };
    }
    const registered = await client.query<DeviceRow>(
      `UPDATE dongxin.devices SET firmware_version = COALESCE($2, firmware_version),
       capabilities = $3::jsonb, protocol = $4, status = 'ONLINE',
       last_seen_at = now(), updated_at = now()
       WHERE id = $1 RETURNING ${columns}`,
      [body.deviceId, body.firmwareVersion ?? null, JSON.stringify(body.capabilities), transport],
    );
    if (!registered.rows[0]) throw new Error('Device disappeared during registration');
    if (current.status !== 'ONLINE') {
      await client.query(
        `INSERT INTO dongxin.device_events (id, device_id, event_type, payload)
         VALUES ($1, $2, 'STATE_REPORT', $3::jsonb)`,
        [randomUUID(), body.deviceId, JSON.stringify({
          event: 'REGISTER', model: body.model, firmwareVersion: body.firmwareVersion ?? null,
          protocolVersion: body.protocolVersion, capabilities: body.capabilities, isOnline: true,
        })],
      );
    }
    await client.query('COMMIT');
    return { outcome: 'REGISTERED', device: fromRow(registered.rows[0]) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
