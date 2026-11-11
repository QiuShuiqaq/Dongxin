import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { retainRecent, retentionSettings } from '../runtime/retention.js';
import { readJsonFile, updateJsonFile } from '../storage.js';
import {
  appendPostgresVoiceTurn,
  pagePostgresDeviceVoiceTurns,
  type DeviceVoiceHistoryResult,
} from './postgresVoice.repository.js';
import { voiceHistoryBackend } from './voiceHistory.repository.js';

const FILE_NAME = 'production-device-voice-history.json';

export const ProductionVoiceHistoryRecordSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().min(1).max(256),
  deviceId: z.string().min(1).max(256),
  inputSource: z.enum(['DEVICE_TEXT', 'DEVICE_AUDIO']),
  inputText: z.string().max(4000),
  replyText: z.string().max(4000),
  route: z.string().min(1).max(128),
  result: z.enum(['COMPLETED', 'FAILED']),
  intent: z.string().max(128).nullable(),
  safetyDecision: z.string().max(64).nullable(),
  commandStatus: z.string().max(64).nullable(),
  latencyMs: z.number().nonnegative().nullable(),
  costCny: z.number().nonnegative().nullable(),
  error: z.string().max(500).nullable(),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export type ProductionVoiceHistoryRecord = z.infer<typeof ProductionVoiceHistoryRecordSchema>;
export type ProductionVoiceHistoryInput = Omit<ProductionVoiceHistoryRecord, 'id' | 'createdAt'>;
export type ProductionVoiceHistoryFilter = {
  deviceId?: string;
  result?: DeviceVoiceHistoryResult;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
};

let postgresPool: Pool | null = null;

export function setProductionVoiceHistoryPool(pool: Pool | null): void {
  postgresPool = pool;
}

function requiredPool(): Pool {
  if (!postgresPool) throw new Error('PostgreSQL production voice history is not initialized');
  return postgresPool;
}

export async function appendProductionVoiceHistory(input: ProductionVoiceHistoryInput): Promise<ProductionVoiceHistoryRecord> {
  const parsed = ProductionVoiceHistoryRecordSchema.omit({ id: true, createdAt: true }).parse(input);
  const createdAt = new Date().toISOString();
  if (voiceHistoryBackend() === 'postgres') {
    const stored = await appendPostgresVoiceTurn(requiredPool(), {
      sessionId: storageSessionId(parsed.deviceId, parsed.sessionId),
      deviceId: parsed.deviceId,
      channel: 'device',
      inputText: parsed.inputText,
      replyText: parsed.replyText,
      route: parsed.route,
      usage: {
        inputSource: parsed.inputSource,
        result: parsed.result,
        intent: parsed.intent,
        safetyDecision: parsed.safetyDecision,
        commandStatus: parsed.commandStatus,
        latencyMs: parsed.latencyMs ?? undefined,
        totalCny: parsed.costCny ?? undefined,
        error: parsed.error,
        externalSessionId: parsed.sessionId,
      },
      sessionTtlMs: 60 * 60_000,
    });
    return ProductionVoiceHistoryRecordSchema.parse({
      ...parsed,
      id: stored.id,
      createdAt: stored.createdAt,
    });
  }
  return updateJsonFile<ProductionVoiceHistoryRecord[], ProductionVoiceHistoryRecord>(FILE_NAME, [], (source) => {
    const record = ProductionVoiceHistoryRecordSchema.parse({ ...parsed, id: randomUUID(), createdAt });
    return {
      value: updateProductionVoiceHistory(z.array(ProductionVoiceHistoryRecordSchema).parse(source), record),
      result: record,
    };
  });
}

export async function pageProductionVoiceHistory(filter: ProductionVoiceHistoryFilter): Promise<{
  items: ProductionVoiceHistoryRecord[];
  page: number;
  pageSize: number;
  total: number;
}> {
  validatePage(filter.page, filter.pageSize);
  const offset = (filter.page - 1) * filter.pageSize;
  if (voiceHistoryBackend() === 'postgres') {
    const result = await pagePostgresDeviceVoiceTurns(requiredPool(), {
      deviceId: filter.deviceId,
      result: filter.result,
      from: filter.from,
      to: filter.to,
      limit: filter.pageSize,
      offset,
    });
    return {
      items: z.array(ProductionVoiceHistoryRecordSchema).parse(result.items),
      page: filter.page,
      pageSize: filter.pageSize,
      total: result.total,
    };
  }
  const source = z.array(ProductionVoiceHistoryRecordSchema).parse(
    await readJsonFile<ProductionVoiceHistoryRecord[]>(FILE_NAME, []),
  );
  const filtered = filterProductionVoiceHistory(pruneProductionVoiceHistory(source), filter);
  return {
    items: filtered.slice(offset, offset + filter.pageSize),
    page: filter.page,
    pageSize: filter.pageSize,
    total: filtered.length,
  };
}

export function updateProductionVoiceHistory(
  source: ProductionVoiceHistoryRecord[],
  record: ProductionVoiceHistoryRecord,
  now = Date.parse(record.createdAt),
): ProductionVoiceHistoryRecord[] {
  return pruneProductionVoiceHistory([...source, ProductionVoiceHistoryRecordSchema.parse(record)], now);
}

export function pruneProductionVoiceHistory(
  source: ProductionVoiceHistoryRecord[],
  now = Date.now(),
): ProductionVoiceHistoryRecord[] {
  return retainRecent(
    source,
    (record) => record.createdAt,
    retentionSettings().historySessions,
    now,
  );
}

export function filterProductionVoiceHistory(
  source: ProductionVoiceHistoryRecord[],
  filter: Pick<ProductionVoiceHistoryFilter, 'deviceId' | 'result' | 'from' | 'to'>,
): ProductionVoiceHistoryRecord[] {
  const from = filter.from ? Date.parse(filter.from) : Number.NEGATIVE_INFINITY;
  const to = filter.to ? Date.parse(filter.to) : Number.POSITIVE_INFINITY;
  return source
    .filter((record) => !filter.deviceId || record.deviceId === filter.deviceId)
    .filter((record) => !filter.result || record.result === filter.result)
    .filter((record) => {
      const at = Date.parse(record.createdAt);
      return at >= from && at <= to;
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
}

function validatePage(page: number, pageSize: number): void {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('Invalid production voice history page');
  }
}

function storageSessionId(deviceId: string, externalSessionId: string): string {
  const bytes = createHash('sha256').update(`device\0${deviceId}\0${externalSessionId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const value = bytes.toString('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
