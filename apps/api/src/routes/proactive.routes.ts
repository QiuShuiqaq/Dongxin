import type { FastifyInstance } from 'fastify';
import { requireOperationsRole } from '../services/operationsAuth.service.js';
import {
  getProactiveSettings,
  handleProactiveEvent,
  listProactiveLogs,
  simulateProactiveEvent,
  simulateProactiveEntrance,
  updateProactiveSettings
} from '../services/proactive.service.js';

export async function registerProactiveRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/proactive/settings', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    return getProactiveSettings();
  });

  server.patch('/api/proactive/settings', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN']);
    return updateProactiveSettings(request.body);
  });

  server.post('/api/proactive/events', async (request) => handleProactiveEvent(request.body));
  server.post('/api/development/proactive/simulate', async (request) => simulateProactiveEvent(request.body));
  server.post('/api/development/proactive/entrance-simulation', async (request) => simulateProactiveEntrance(request.body));

  server.get('/api/proactive/logs', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    const limit = typeof request.query === 'object' && request.query && 'limit' in request.query
      ? Number((request.query as { limit?: string }).limit || 20)
      : 20;
    return listProactiveLogs(Number.isFinite(limit) && limit > 0 ? limit : 20);
  });
}

