import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readJsonFile, updateJsonFile } from '../storage.js';
import { retainRecent, retentionSettings } from '../runtime/retention.js';
import type { Pool } from 'pg';
import { appendPostgresVoiceTurn, pagePostgresVoiceSessions } from './postgresVoice.repository.js';
import { postgresConfig } from '../runtime/postgres.js';

const FILE_NAME = 'development-voice-history.json';

const TurnSchema = z.object({
  id: z.string(),
  at: z.string(),
  text: z.string(),
  reply: z.string(),
  route: z.string(),
  error: z.string().nullable(),
  latencyMs: z.number().nullable(),
  costCny: z.number().nullable(),
});
const SessionSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  channel: z.enum(['llm-test', 'pipeline']),
  createdAt: z.string(),
  updatedAt: z.string(),
  turns: z.array(TurnSchema),
});

export type VoiceHistorySession = z.infer<typeof SessionSchema>;
type HistoryTurn = Omit<z.infer<typeof TurnSchema>, 'id' | 'at'>;
let postgresPool: Pool | null = null;

export function voiceHistoryBackend(): 'json' | 'postgres' {
  return process.env.VOICE_HISTORY_BACKEND === 'postgres' ? 'postgres' : 'json';
}

export function setVoiceHistoryPool(pool: Pool | null): void { postgresPool = pool; }

export function assertVoiceHistoryConfiguration(): void {
  if (process.env.VOICE_HISTORY_BACKEND && !['json', 'postgres'].includes(process.env.VOICE_HISTORY_BACKEND)) {
    throw new Error('VOICE_HISTORY_BACKEND must be json or postgres');
  }
  if (voiceHistoryBackend() === 'postgres') postgresConfig();
}

function requiredPool(): Pool {
  if (!postgresPool) throw new Error('PostgreSQL voice history is not initialized');
  return postgresPool;
}

export async function listVoiceHistory(deviceId?: string, limit = 50, offset = 0): Promise<VoiceHistorySession[]> {
  if (voiceHistoryBackend() === 'postgres') {
    const sessions = await pagePostgresVoiceSessions(requiredPool(), deviceId, limit, offset);
    return sessions.map((session) => SessionSchema.parse({
      ...session,
      turns: session.turns.map((turn) => ({
        id: turn.id, at: turn.createdAt, text: turn.inputText, reply: turn.replyText,
        route: turn.route, error: null,
        latencyMs: typeof turn.usage.latencyMs === 'number' ? turn.usage.latencyMs : null,
        costCny: typeof turn.usage.costCny === 'number' ? turn.usage.costCny : null,
      })),
    }));
  }
  const sessions = z.array(SessionSchema).parse(await readJsonFile<VoiceHistorySession[]>(FILE_NAME, []));
  return pruneVoiceHistory(sessions)
    .filter((session) => !deviceId || session.deviceId === deviceId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(offset, offset + limit);
}

export async function appendVoiceHistoryTurn(input: {
  conversationId: string;
  deviceId: string;
  channel: VoiceHistorySession['channel'];
  turn: HistoryTurn;
}): Promise<void> {
  if (voiceHistoryBackend() === 'postgres') {
    await appendPostgresVoiceTurn(requiredPool(), {
      sessionId: input.conversationId, deviceId: input.deviceId,
      channel: input.channel, inputText: input.turn.text, replyText: input.turn.reply,
      route: input.turn.route,
      usage: { latencyMs: input.turn.latencyMs ?? undefined, costCny: input.turn.costCny },
    });
    return;
  }
  await updateJsonFile<VoiceHistorySession[], void>(FILE_NAME, [], (source) => {
    const now = new Date().toISOString();
    const sessions = z.array(SessionSchema).parse(source);
    return { value: updateVoiceHistorySessions(sessions, input, now), result: undefined };
  });
}

export function pruneVoiceHistory(source: VoiceHistorySession[], now = Date.now()): VoiceHistorySession[] {
  const settings = retentionSettings();
  return retainRecent(source, (session) => session.updatedAt, settings.historySessions, now)
    .map((session) => ({ ...session, turns: retainRecent(session.turns, (turn) => turn.at, settings.historyTurns, now) }))
    .filter((session) => session.turns.length > 0);
}

export function updateVoiceHistorySessions(
  source: VoiceHistorySession[],
  input: { conversationId: string; deviceId: string; channel: VoiceHistorySession['channel']; turn: HistoryTurn },
  now: string,
): VoiceHistorySession[] {
  const sessions = pruneVoiceHistory(source, Date.parse(now));
  const existing = sessions.find((session) => session.id === input.conversationId);
  if (existing && (existing.deviceId !== input.deviceId || existing.channel !== input.channel)) {
    throw new Error('Conversation history scope mismatch');
  }
  const turn = TurnSchema.parse({ ...input.turn, text: input.turn.text.slice(0, 4000), reply: input.turn.reply.slice(0, 4000), id: randomUUID(), at: now });
  if (existing) {
    return pruneVoiceHistory(sessions.map((session) => session.id === existing.id
      ? { ...session, updatedAt: now, turns: [...session.turns, turn] }
      : session), Date.parse(now));
  }
  return pruneVoiceHistory([...sessions, SessionSchema.parse({
    id: input.conversationId,
    deviceId: input.deviceId,
    channel: input.channel,
    createdAt: now,
    updatedAt: now,
    turns: [turn],
  })], Date.parse(now));
}
