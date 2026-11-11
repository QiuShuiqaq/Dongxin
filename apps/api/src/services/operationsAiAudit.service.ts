import type { FastifyRequest } from 'fastify';
import { appendLog } from './log.service.js';

export async function auditAiChange(
  request: FastifyRequest,
  actor: string,
  summary: string,
  fields: Record<string, unknown>,
): Promise<void> {
  try {
    await appendLog({ type: 'AI', summary, payload: { actor, ...fields, at: new Date().toISOString() } });
  } catch (error) {
    request.log.error(error, 'AI configuration audit failed');
  }
}
