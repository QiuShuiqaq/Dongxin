import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { DeviceEvent } from '@dongxin/shared';
import { DeviceEventSchema } from '@dongxin/shared';
import type { Pool } from 'pg';
import { z } from 'zod';

type EventRow = {
  id: string;
  device_id: string;
  event_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: Date | null;
  created_at_cursor: string;
};

type EventInput = Omit<DeviceEvent, 'id' | 'createdAt'> & {
  eventId?: string;
  occurredAt?: string;
};

const columns = `id, device_id, event_id, event_type, payload, occurred_at,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor`;
const EventInputSchema = DeviceEventSchema.omit({ id: true, createdAt: true });
const CursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });

function fromRow(row: EventRow): DeviceEvent {
  return DeviceEventSchema.parse({
    id: row.id, deviceId: row.device_id, type: row.event_type,
    payload: row.payload, createdAt: row.created_at_cursor,
  });
}

function containsRawAudio(value: unknown): boolean {
  if (Buffer.isBuffer(value)) return true;
  if (Array.isArray(value)) return value.some(containsRawAudio);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) =>
    /^(?:rawAudio|audioBase64|pcm(?:Base64)?|wav(?:Base64|Data)?|audio(?:Bytes|Buffer|Data))$/i.test(key) ||
    containsRawAudio(nested));
}

export async function appendPostgresDeviceEvent(
  pool: Pool, input: EventInput,
): Promise<{ event: DeviceEvent; outcome: 'INSERTED' | 'DUPLICATE' | 'CONFLICT' }> {
  const event = EventInputSchema.parse(input);
  if (containsRawAudio(event.payload)) throw new Error('Raw audio is not allowed in device events');
  const payload = JSON.stringify(event.payload);
  if (Buffer.byteLength(payload, 'utf8') > 8192) throw new Error('Device event payload exceeds 8 KiB');
  const eventId = input.eventId?.trim() || null;
  if (input.eventId !== undefined && (!eventId || eventId.length > 128)) throw new Error('Invalid device event ID');
  const occurredAt = input.occurredAt === undefined ? null : new Date(input.occurredAt);
  if (occurredAt !== null && !Number.isFinite(occurredAt.getTime())) throw new Error('Invalid device event timestamp');

  const inserted = await pool.query<EventRow>(
    `INSERT INTO dongxin.device_events
     (id, device_id, event_id, event_type, payload, occurred_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (device_id, event_id) WHERE event_id IS NOT NULL DO NOTHING
     RETURNING ${columns}`,
    [randomUUID(), event.deviceId, eventId, event.type, payload, occurredAt],
  );
  if (inserted.rows[0]) return { event: fromRow(inserted.rows[0]), outcome: 'INSERTED' };
  if (!eventId) throw new Error('PostgreSQL did not return inserted device event');
  const existing = await pool.query<EventRow>(
    `SELECT ${columns} FROM dongxin.device_events WHERE device_id = $1 AND event_id = $2`,
    [event.deviceId, eventId],
  );
  const row = existing.rows[0];
  if (!row) throw new Error('Conflicting device event disappeared');
  const same = row.event_type === event.type && isDeepStrictEqual(row.payload, JSON.parse(payload)) &&
    (row.occurred_at?.toISOString() ?? null) === (occurredAt?.toISOString() ?? null);
  return { event: fromRow(row), outcome: same ? 'DUPLICATE' : 'CONFLICT' };
}

export async function listPostgresDeviceEvents(
  pool: Pool, deviceId: string, limit = 50, before?: { createdAt: string; id: string },
): Promise<DeviceEvent[]> {
  if (!deviceId.trim()) throw new Error('Device ID is required');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid event page size');
  const cursor = before ? CursorSchema.parse(before) : null;
  const result = await pool.query<EventRow>(
    `SELECT ${columns} FROM dongxin.device_events
     WHERE device_id = $1 AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid))
     ORDER BY created_at DESC, id DESC LIMIT $2`,
    [deviceId, limit, cursor?.createdAt ?? null, cursor?.id ?? null],
  );
  return result.rows.map(fromRow);
}
