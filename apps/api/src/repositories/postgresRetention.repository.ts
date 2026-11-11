import type { Pool } from 'pg';

const allowedTables = {
  deviceEvents: { table: 'device_events', time: 'created_at' },
  voiceTurns: { table: 'voice_turns', time: 'created_at' },
  voiceSessions: { table: 'voice_sessions', time: 'updated_at' },
  deviceCommands: { table: 'device_commands', time: 'created_at' },
  auditLogs: { table: 'audit_logs', time: 'created_at' },
} as const;

export type RetentionTable = keyof typeof allowedTables;
export const retentionOrder: readonly RetentionTable[] = [
  'voiceTurns', 'voiceSessions', 'deviceEvents', 'deviceCommands', 'auditLogs',
];

/** Delete at most one small batch per call to avoid long locks on a shared RDS instance. */
export async function prunePostgresTextBatch(
  pool: Pool, table: RetentionTable, cutoff: Date, limit = 500,
): Promise<number> {
  if (!(cutoff instanceof Date) || !Number.isFinite(cutoff.getTime())) throw new Error('Invalid retention cutoff');
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid retention batch size');
  const config = allowedTables[table];
  if (!config) throw new Error('Unsupported retention table');
  const result = await pool.query(
    `DELETE FROM dongxin.${config.table} WHERE id IN (
       SELECT id FROM dongxin.${config.table}
       WHERE ${config.time} < $1
       ORDER BY ${config.time} ASC LIMIT $2
     )`,
    [cutoff, limit],
  );
  return result.rowCount ?? 0;
}

export async function runPostgresRetention(
  pool: Pool, cutoff: Date, maxBatchesPerTable = 20,
): Promise<Record<RetentionTable, number>> {
  if (!Number.isInteger(maxBatchesPerTable) || maxBatchesPerTable < 1 || maxBatchesPerTable > 100) {
    throw new Error('Invalid retention batch count');
  }
  const removed = { deviceEvents: 0, voiceTurns: 0, voiceSessions: 0, deviceCommands: 0, auditLogs: 0 };
  for (const table of retentionOrder) {
    for (let batch = 0; batch < maxBatchesPerTable; batch++) {
      const count = await prunePostgresTextBatch(pool, table, cutoff);
      removed[table] += count;
      if (count < 500) break;
    }
  }
  return removed;
}
