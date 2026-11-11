import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Explicit isolated directory under D:\workspace; no project runtime data is touched.
const tempRoot = fileURLToPath(new URL('../../../../../.runtime-test-', import.meta.url));
const directory = await mkdtemp(tempRoot);
const previous = process.env.DONGXIN_DATA_DIR;
process.env.DONGXIN_DATA_DIR = directory;
const storage = await import('../storage.js');
const usage = await import('./usage.js');
const cap = process.env.ASR_DAILY_CALL_LIMIT;
const budget = process.env.AI_DAILY_ESTIMATED_BUDGET_CNY;
after(async () => {
  if (previous === undefined) delete process.env.DONGXIN_DATA_DIR; else process.env.DONGXIN_DATA_DIR = previous;
  if (cap === undefined) delete process.env.ASR_DAILY_CALL_LIMIT; else process.env.ASR_DAILY_CALL_LIMIT = cap;
  if (budget === undefined) delete process.env.AI_DAILY_ESTIMATED_BUDGET_CNY; else process.env.AI_DAILY_ESTIMATED_BUDGET_CNY = budget;
  assert.ok(directory.startsWith(tempRoot));
  await rm(directory, { recursive: true });
});

test('parallel writes retain every update; readers never overwrite a newly created file', async () => {
  const operations = Array.from({ length: 30 }, () => storage.updateJsonFile('counter.json', { count: 0 }, (row) => ({ value: { count: row.count + 1 }, result: undefined })));
  const readers = Array.from({ length: 30 }, () => storage.readJsonFile('counter.json', { count: 0 }));
  await Promise.all([...operations, ...readers]);
  assert.equal((await storage.readJsonFile('counter.json', { count: 0 })).count, 30);
  await assert.rejects(storage.updateJsonFile('counter.json', { count: 0 }, () => { throw new Error('invalid update'); }), /invalid update/);
  await storage.updateJsonFile('counter.json', { count: 0 }, (row) => ({ value: { count: row.count + 1 }, result: undefined }));
  assert.equal((await storage.readJsonFile('counter.json', { count: 0 })).count, 31);
  assert.equal((await readdir(directory)).filter((name) => name.endsWith('.tmp')).length, 0);
});

test('daily call reservation is atomic, survives reload and enforces the estimated threshold', async () => {
  process.env.ASR_DAILY_CALL_LIMIT = '3';
  process.env.AI_DAILY_ESTIMATED_BUDGET_CNY = '0';
  await usage.initializeUsage();
  const attempts = await Promise.allSettled(Array.from({ length: 10 }, () => usage.reserveAiAttempt('ASR')));
  assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 3);
  assert.equal(usage.getUsageStatus().ASR, 3);
  await usage.initializeUsage();
  await assert.rejects(usage.reserveAiAttempt('ASR'), (error: unknown) => (error as { code?: string }).code === 'AI_DAILY_LIMIT');
  process.env.AI_DAILY_ESTIMATED_BUDGET_CNY = '0.1';
  await usage.recordAiOutcome(new Date().toISOString().slice(0, 10), 0.11, true);
  await assert.rejects(usage.reserveAiAttempt('TTS'), (error: unknown) => (error as { code?: string }).code === 'AI_DAILY_LIMIT');
  assert.equal(usage.getUsageStatus().failed, 1);
});
