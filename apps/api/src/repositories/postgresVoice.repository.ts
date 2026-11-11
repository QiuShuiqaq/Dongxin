import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

const VoiceUsageSchema = z.object({
  usedLlm: z.boolean().optional(),
  providerId: z.string().max(128).nullable().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  latencyMs: z.number().nonnegative().optional(),
  asrCny: z.number().nonnegative().optional(),
  llmCny: z.number().nonnegative().optional(),
  ttsCny: z.number().nonnegative().optional(),
  totalCny: z.number().nonnegative().optional(),
  costCny: z.number().nonnegative().nullable().optional(),
  isEstimated: z.boolean().optional(),
  inputSource: z.enum(['DEVICE_TEXT', 'DEVICE_AUDIO']).optional(),
  result: z.enum(['COMPLETED', 'FAILED']).optional(),
  intent: z.string().max(128).nullable().optional(),
  safetyDecision: z.string().max(64).nullable().optional(),
  commandStatus: z.string().max(64).nullable().optional(),
  error: z.string().max(500).nullable().optional(),
  externalSessionId: z.string().max(256).optional(),
}).strict();

export type DeviceVoiceHistoryResult = 'COMPLETED' | 'FAILED';

export type StoredDeviceVoiceTurn = {
  id: string;
  sessionId: string;
  deviceId: string;
  inputSource: 'DEVICE_TEXT' | 'DEVICE_AUDIO';
  inputText: string;
  replyText: string;
  route: string;
  result: DeviceVoiceHistoryResult;
  intent: string | null;
  safetyDecision: string | null;
  commandStatus: string | null;
  latencyMs: number | null;
  costCny: number | null;
  error: string | null;
  createdAt: string;
};

export type StoredVoiceTurn = {
  id: string;
  sessionId: string;
  inputText: string;
  replyText: string;
  route: string;
  usage: Record<string, unknown>;
  createdAt: string;
};

export type StoredVoiceSession = {
  id: string;
  deviceId: string;
  channel: 'pipeline' | 'llm-test';
  createdAt: string;
  updatedAt: string;
  turns: StoredVoiceTurn[];
};

type VoiceSessionRow = {
  id: string;
  device_id: string;
  channel: 'pipeline' | 'llm-test';
  created_at: Date;
  updated_at: Date;
};

type VoiceTurnRow = {
  id: string;
  session_id: string;
  input_text: string;
  reply_text: string;
  route: string;
  usage: Record<string, unknown>;
  created_at: Date;
};

function fromRow(row: VoiceTurnRow): StoredVoiceTurn {
  return {
    id: row.id,
    sessionId: row.session_id,
    inputText: row.input_text,
    replyText: row.reply_text,
    route: row.route,
    usage: row.usage,
    createdAt: row.created_at.toISOString(),
  };
}

export async function appendPostgresVoiceTurn(pool: Pool, input: {
  sessionId: string;
  deviceId: string;
  channel: 'pipeline' | 'llm-test' | 'device';
  inputText: string;
  replyText: string;
  route: string;
  usage?: z.infer<typeof VoiceUsageSchema>;
  sessionTtlMs?: number;
}): Promise<StoredVoiceTurn> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.sessionId) ||
      !input.deviceId.trim() || !input.route.trim()) {
    throw new Error('Invalid voice session identity or route');
  }
  const usage = VoiceUsageSchema.parse(input.usage ?? {});
  const ttl = input.sessionTtlMs ?? 5 * 60_000;
  if (!Number.isInteger(ttl) || ttl < 1_000 || ttl > 60 * 60_000) throw new Error('Invalid voice session TTL');
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const session = await client.query<{ id: string }>(
      `INSERT INTO dongxin.voice_sessions (id, device_id, channel, expires_at)
       VALUES ($1, $2, $3, now() + ($4::bigint * interval '1 millisecond'))
       ON CONFLICT (id) DO UPDATE SET updated_at = now(),
         expires_at = EXCLUDED.expires_at
       WHERE dongxin.voice_sessions.device_id = EXCLUDED.device_id
         AND dongxin.voice_sessions.channel = EXCLUDED.channel
       RETURNING id`,
      [input.sessionId, input.deviceId, input.channel, ttl],
    );
    if (!session.rows[0]) throw new Error('Conversation history scope mismatch');
    const id = randomUUID();
    const turn = await client.query<VoiceTurnRow>(
      `INSERT INTO dongxin.voice_turns
         (id, session_id, input_text, reply_text, route, usage)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id, session_id, input_text, reply_text, route, usage, created_at`,
      [id, input.sessionId, input.inputText.slice(0, 4000), input.replyText.slice(0, 4000),
        input.route.slice(0, 128), JSON.stringify(usage)],
    );
    if (!turn.rows[0]) throw new Error('PostgreSQL did not return inserted voice turn');
    await client.query('COMMIT');
    return fromRow(turn.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listPostgresVoiceTurns(
  pool: Pool, deviceId: string, sessionId: string, limit = 24,
): Promise<StoredVoiceTurn[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid voice turn limit');
  const result = await pool.query<VoiceTurnRow>(
    `SELECT t.id, t.session_id, t.input_text, t.reply_text, t.route, t.usage, t.created_at
     FROM dongxin.voice_turns t
     JOIN dongxin.voice_sessions s ON s.id = t.session_id
     WHERE s.id = $1 AND s.device_id = $2
     ORDER BY t.created_at DESC, t.id DESC LIMIT $3`,
    [sessionId, deviceId, limit],
  );
  return result.rows.map(fromRow).reverse();
}

export async function pagePostgresVoiceSessions(
  pool: Pool, deviceId: string | undefined, limit: number, offset: number,
): Promise<StoredVoiceSession[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isInteger(offset) || offset < 0 || offset > 100_000) {
    throw new Error('Invalid voice history page');
  }
  const sessions = await pool.query<VoiceSessionRow>(
    `SELECT id, device_id, channel, created_at, updated_at
     FROM dongxin.voice_sessions
     WHERE channel IN ('pipeline', 'llm-test')
       AND ($1::text IS NULL OR device_id = $1)
     ORDER BY updated_at DESC, id DESC LIMIT $2 OFFSET $3`,
    [deviceId ?? null, limit, offset],
  );
  if (sessions.rows.length === 0) return [];
  const turns = await pool.query<VoiceTurnRow>(
    `SELECT id, session_id, input_text, reply_text, route, usage, created_at
     FROM (
       SELECT t.*, row_number() OVER (PARTITION BY session_id ORDER BY created_at DESC, id DESC) AS rn
       FROM dongxin.voice_turns t WHERE session_id = ANY($1::uuid[])
     ) recent WHERE rn <= 100
     ORDER BY created_at ASC, id ASC`,
    [sessions.rows.map((row) => row.id)],
  );
  const bySession = new Map<string, StoredVoiceTurn[]>();
  for (const row of turns.rows) {
    const items = bySession.get(row.session_id) ?? [];
    items.push(fromRow(row));
    bySession.set(row.session_id, items);
  }
  return sessions.rows.map((row) => ({
    id: row.id, deviceId: row.device_id, channel: row.channel,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    turns: bySession.get(row.id) ?? [],
  }));
}

type DeviceVoiceTurnRow = VoiceTurnRow & {
  device_id: string;
  storage_session_id: string;
};

export async function pagePostgresDeviceVoiceTurns(
  pool: Pool,
  input: {
    deviceId?: string;
    result?: DeviceVoiceHistoryResult;
    from?: string;
    to?: string;
    limit: number;
    offset: number;
  },
): Promise<{ items: StoredDeviceVoiceTurn[]; total: number }> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100 ||
      !Number.isInteger(input.offset) || input.offset < 0 || input.offset > 10_000_000) {
    throw new Error('Invalid device voice history page');
  }
  const values = [
    input.deviceId ?? null,
    input.result ?? null,
    input.from ?? null,
    input.to ?? null,
  ];
  const where = `s.channel = 'device'
       AND ($1::text IS NULL OR s.device_id = $1)
       AND ($2::text IS NULL OR t.usage ->> 'result' = $2)
       AND ($3::timestamptz IS NULL OR t.created_at >= $3::timestamptz)
       AND ($4::timestamptz IS NULL OR t.created_at <= $4::timestamptz)`;
  const count = await pool.query<{ total: string }>(
    `SELECT count(*)::text AS total
     FROM dongxin.voice_turns t
     JOIN dongxin.voice_sessions s ON s.id = t.session_id
     WHERE ${where}`,
    values,
  );
  const turns = await pool.query<DeviceVoiceTurnRow>(
    `SELECT t.id, t.session_id, t.input_text, t.reply_text, t.route, t.usage, t.created_at,
            s.device_id, s.id::text AS storage_session_id
     FROM dongxin.voice_turns t
     JOIN dongxin.voice_sessions s ON s.id = t.session_id
     WHERE ${where}
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT $5 OFFSET $6`,
    [...values, input.limit, input.offset],
  );
  return {
    total: Number(count.rows[0]?.total ?? 0),
    items: turns.rows.map((row) => {
      const usage = VoiceUsageSchema.parse(row.usage);
      return {
        id: row.id,
        sessionId: usage.externalSessionId ?? row.storage_session_id,
        deviceId: row.device_id,
        inputSource: z.enum(['DEVICE_TEXT', 'DEVICE_AUDIO']).parse(usage.inputSource),
        inputText: row.input_text,
        replyText: row.reply_text,
        route: row.route,
        result: z.enum(['COMPLETED', 'FAILED']).parse(usage.result),
        intent: usage.intent ?? null,
        safetyDecision: usage.safetyDecision ?? null,
        commandStatus: usage.commandStatus ?? null,
        latencyMs: usage.latencyMs ?? null,
        costCny: usage.totalCny ?? usage.costCny ?? null,
        error: usage.error ?? null,
        createdAt: row.created_at.toISOString(),
      };
    }),
  };
}
