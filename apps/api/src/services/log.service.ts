import type { SystemLog, SystemLogType } from '@dongxin/shared';
import * as systemRepository from '../repositories/system.repository.js';

export async function appendLog(log: Omit<SystemLog, 'id' | 'createdAt'>): Promise<SystemLog> {
  return systemRepository.appendSystemLog(log);
}

export async function listLogs(input?: { type?: SystemLogType; limit?: number }): Promise<SystemLog[]> {
  const logs = await systemRepository.listSystemLogs();
  const filtered = input?.type ? logs.filter((log) => log.type === input.type) : logs;
  const limit = input?.limit ?? 50;
  return filtered.slice(-limit).reverse();
}

