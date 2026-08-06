import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listLogs } from '../services/log.service.js';

const LogsQuerySchema = z.object({
  type: z.enum(['VOICE', 'AI', 'DEVICE', 'COMMAND', 'KNOWLEDGE', 'PROACTIVE', 'ERROR']).optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

export async function registerLogsRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/logs', async (request) => {
    const query = LogsQuerySchema.parse(request.query);
    return listLogs({ type: query.type, limit: query.limit });
  });
}

