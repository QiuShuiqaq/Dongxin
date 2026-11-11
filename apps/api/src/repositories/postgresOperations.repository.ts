import type { Pool } from 'pg';
import { operationalDeviceFilter } from './postgresDevices.repository.js';

type DeviceCounts = { total: string; online: string; fault: string };
type CommandCounts = { completed: string; successful: string };

export type PostgresOperationsMetrics = {
  totalDevices: number;
  onlineDevices: number;
  faultDevices: number;
  completedCommands24h: number;
  commandSuccessRate24h: number;
  windowHours: 24;
};

/** Counts are calculated in SQL; no fleet-sized array is returned to Node. */
export async function getPostgresOperationsMetrics(pool: Pool, now = new Date()): Promise<PostgresOperationsMetrics> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const onlineCutoff = new Date(now.getTime() - 35 * 60 * 1000);
  const [devices, commands] = await Promise.all([
    pool.query<DeviceCounts>(
      `SELECT count(*)::text AS total,
        count(*) FILTER (WHERE status = 'ONLINE' AND last_seen_at >= $1)::text AS online,
        count(*) FILTER (WHERE status = 'FAULT')::text AS fault
       FROM dongxin.devices WHERE ${operationalDeviceFilter()}`,
      [onlineCutoff],
    ),
    pool.query<CommandCounts>(
      `SELECT count(*)::text AS completed,
        count(*) FILTER (WHERE c.status = 'APPLIED')::text AS successful
       FROM dongxin.device_commands c
       JOIN dongxin.devices d ON d.id = c.device_id
       WHERE c.created_at >= $1
         AND c.status IN ('APPLIED', 'REJECTED', 'FAILED')
         AND ${operationalDeviceFilter('d.')}`,
      [cutoff],
    ),
  ]);
  const totalDevices = Number(devices.rows[0]?.total ?? 0);
  const onlineDevices = Number(devices.rows[0]?.online ?? 0);
  const faultDevices = Number(devices.rows[0]?.fault ?? 0);
  const completedCommands24h = Number(commands.rows[0]?.completed ?? 0);
  const successful = Number(commands.rows[0]?.successful ?? 0);
  return {
    totalDevices, onlineDevices, faultDevices, completedCommands24h,
    commandSuccessRate24h: completedCommands24h ? Math.round(successful / completedCommands24h * 1000) / 10 : 100,
    windowHours: 24,
  };
}
