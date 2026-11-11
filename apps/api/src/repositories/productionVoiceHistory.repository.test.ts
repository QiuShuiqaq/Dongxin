import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ProductionVoiceHistoryRecordSchema,
  appendProductionVoiceHistory,
  filterProductionVoiceHistory,
  pruneProductionVoiceHistory,
  setProductionVoiceHistoryPool,
  type ProductionVoiceHistoryRecord,
} from './productionVoiceHistory.repository.js';

const now = Date.parse('2026-11-11T08:00:00.000Z');

function record(overrides: Partial<ProductionVoiceHistoryRecord> = {}): ProductionVoiceHistoryRecord {
  return {
    id: '269d9a5e-4576-4a32-a897-928ad0f6bd3f',
    sessionId: 'device-session-1',
    deviceId: 'DX-001',
    inputSource: 'DEVICE_AUDIO',
    inputText: '打开照明',
    replyText: '已打开照明。',
    route: 'ONLINE_RULE',
    result: 'COMPLETED',
    intent: 'LIGHT_ON',
    safetyDecision: 'APPROVED',
    commandStatus: 'QUEUED',
    latencyMs: 125,
    costCny: 0.001,
    error: null,
    createdAt: '2026-11-11T07:00:00.000Z',
    ...overrides,
  };
}

test('production history accepts text metadata only', () => {
  assert.equal(ProductionVoiceHistoryRecordSchema.parse(record()).inputText, '打开照明');
  assert.throws(
    () => ProductionVoiceHistoryRecordSchema.parse({ ...record(), audioBase64: 'UklGRg==' }),
    /unrecognized_key/,
  );
  assert.throws(
    () => ProductionVoiceHistoryRecordSchema.parse({ ...record(), pcm: [0, 1] }),
    /unrecognized_key/,
  );
});

test('production history is pruned to 90 days and filtered newest first', () => {
  const old = record({ id: 'd285b542-d0eb-4a9e-88ef-df349cf0711a', createdAt: '2026-08-12T07:59:59.999Z' });
  const failed = record({
    id: '8328091e-4261-4f81-9ce1-c0fd778d5735',
    deviceId: 'DX-002',
    result: 'FAILED',
    createdAt: '2026-11-10T07:00:00.000Z',
  });
  const newest = record({ createdAt: '2026-11-11T07:00:00.000Z' });

  const retained = pruneProductionVoiceHistory([newest, old, failed], now);
  assert.deepEqual(retained.map((item) => item.id), [failed.id, newest.id]);
  assert.deepEqual(
    filterProductionVoiceHistory(retained, { deviceId: 'DX-001', result: 'COMPLETED' }).map((item) => item.id),
    [newest.id],
  );
  assert.deepEqual(
    filterProductionVoiceHistory(retained, {
      from: '2026-11-10T00:00:00.000Z',
      to: '2026-11-10T23:59:59.999Z',
    }).map((item) => item.id),
    [failed.id],
  );
});

test('PostgreSQL production history fails closed until its pool is initialized', async () => {
  const previousBackend = process.env.VOICE_HISTORY_BACKEND;
  process.env.VOICE_HISTORY_BACKEND = 'postgres';
  setProductionVoiceHistoryPool(null);
  try {
    const { id: _id, createdAt: _createdAt, ...input } = record();
    await assert.rejects(appendProductionVoiceHistory(input), /not initialized/);
  } finally {
    setProductionVoiceHistoryPool(null);
    if (previousBackend === undefined) delete process.env.VOICE_HISTORY_BACKEND;
    else process.env.VOICE_HISTORY_BACKEND = previousBackend;
  }
});
