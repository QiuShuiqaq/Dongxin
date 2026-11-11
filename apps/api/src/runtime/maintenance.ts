import { updateJsonFile } from '../storage.js';
import type { Pool } from 'pg';
import type { VoiceHistorySession } from '../repositories/voiceHistory.repository.js';
import type { VoiceTestSession } from '@dongxin/shared';
import { pruneVoiceHistory } from '../repositories/voiceHistory.repository.js';
import { pruneVoiceTestSessions } from '../repositories/voiceTest.repository.js';
import { retainRecent, retentionSettings } from './retention.js';
import { runPostgresRetention } from '../repositories/postgresRetention.repository.js';

let status = { lastRunAt: null as string | null, removedRecords: 0, error: null as string | null };

/** Explicit allowlist: never touches knowledge, product configuration or manually archived audio datasets. */
export async function maintainRuntimeData(postgresPool?: Pool | null): Promise<void> {
  const settings = retentionSettings();
  let removed = 0;
  try {
    for (const [name, max] of [['device-events.json', settings.events], ['device-commands.json', settings.commands], ['system-logs.json', settings.logs]] as const) {
      await updateJsonFile<Array<{ createdAt: string }>, void>(name, [], (current) => {
        const value = retainRecent(current, (item) => item.createdAt, max);
        removed += current.length - value.length;
        return { value, result: undefined };
      });
    }
    await updateJsonFile<VoiceHistorySession[], void>('development-voice-history.json', [], (current) => {
      const value = pruneVoiceHistory(current);
      removed += current.length - value.length;
      return { value, result: undefined };
    });
    await updateJsonFile<VoiceTestSession[], void>('voice-test-sessions.json', [], (current) => {
      const value = pruneVoiceTestSessions(current);
      removed += current.length - value.length;
      return { value, result: undefined };
    });
    if (postgresPool) removed += await maintainPostgresData(postgresPool);
    status = { lastRunAt: new Date().toISOString(), removedRecords: removed, error: null };
  } catch {
    status = { ...status, error: '运行数据维护失败，请检查服务器日志' };
    throw new Error('运行数据维护失败，请检查服务器日志');
  }
}

export async function maintainPostgresData(pool: Pool, now = Date.now()): Promise<number> {
  const cutoff = new Date(now - retentionSettings().textDays * 86400000);
  const removed = await runPostgresRetention(pool, cutoff);
  return Object.values(removed).reduce((sum, count) => sum + count, 0);
}

export function getRetentionStatus() { return { ...status, policy: retentionSettings() }; }

export function startRuntimeMaintenance(
  onError: (error: unknown) => void,
  postgresPool?: Pool | null,
  runMaintenance: (pool?: Pool | null) => Promise<void> = maintainRuntimeData,
): () => Promise<void> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activeRun: Promise<void> | null = null;
  const tick = async () => {
    try { await runMaintenance(postgresPool); } catch (error) { onError(error); }
    if (!stopped) {
      timer = setTimeout(() => { activeRun = tick(); }, 60 * 60 * 1000);
      timer.unref();
    }
  };
  activeRun = tick();
  return async () => { stopped = true; clearTimeout(timer); await activeRun; };
}
