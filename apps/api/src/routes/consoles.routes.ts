import type { FastifyInstance } from "fastify";
import { getDevelopmentConsoleData, getOperationsConsoleData, getOperationsDevicePage } from "../services/console.service.js";
import { getDevelopmentLiveData } from '../services/developmentLive.service.js';
import { z } from 'zod';
import { getRuntimeStatus } from '../runtime/status.js';
import { evaluateDevelopmentScenario } from '../services/developmentScenario.service.js';

export async function registerConsoleRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/operations/runtime', async (_request, reply) => reply.header('Cache-Control', 'no-store').send(getRuntimeStatus()));
  server.get('/api/operations/devices', async (request) => getOperationsDevicePage(z.object({
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().max(200).default(''), status: z.enum(['ONLINE', 'OFFLINE', 'FAULT']).optional(),
  }).parse(request.query)));
  server.get("/api/development/console", async () => getDevelopmentConsoleData());
  server.post('/api/development/scenarios/evaluate', async (request) => evaluateDevelopmentScenario(request.body));
  server.get('/api/development/live', async (request) => {
    const { deviceId } = z.object({ deviceId: z.string().min(1) }).parse(request.query);
    return getDevelopmentLiveData(deviceId);
  });
  server.get("/api/operations/console", async (request) => {
    const { section } = z.object({ section: z.enum(['overview', 'devices', 'knowledge', 'ai', 'records', 'system', 'all']).default('overview') }).parse(request.query);
    return getOperationsConsoleData(section);
  });
}
