import type { FastifyInstance } from 'fastify';
import {
  getProactiveSettings,
  handleProactiveEvent,
  listProactiveLogs,
  updateProactiveSettings
} from '../services/proactive.service.js';

export async function registerProactiveRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/proactive/settings', async () => getProactiveSettings());

  server.patch('/api/proactive/settings', async (request) => updateProactiveSettings(request.body));

  server.post('/api/proactive/events', async (request) => handleProactiveEvent(request.body));

  server.get('/api/proactive/logs', async (request) => {
    const limit = typeof request.query === 'object' && request.query && 'limit' in request.query
      ? Number((request.query as { limit?: string }).limit || 20)
      : 20;
    return listProactiveLogs(Number.isFinite(limit) && limit > 0 ? limit : 20);
  });
}

