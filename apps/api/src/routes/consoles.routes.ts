import type { FastifyInstance } from "fastify";
import { getDevelopmentConsoleData, getOperationsConsoleData, getOperationsDeviceDetail, getOperationsDevicePage, updateOperationsDeviceProfile } from "../services/console.service.js";
import { getDevelopmentLiveData } from '../services/developmentLive.service.js';
import { z } from 'zod';
import { getRuntimeStatus } from '../runtime/status.js';
import { evaluateDevelopmentScenario } from '../services/developmentScenario.service.js';
import { requireOperationsRole } from '../services/operationsAuth.service.js';

const DeviceProfileEditSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  notes: z.string().trim().max(500).optional(),
}).strict().refine((value) => value.name !== undefined || value.notes !== undefined, '至少修改一项');

export async function registerConsoleRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/operations/runtime', async (request, reply) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    return reply.header('Cache-Control', 'no-store').send(getRuntimeStatus());
  });
  server.get('/api/operations/devices', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    return getOperationsDevicePage(z.object({
      page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
      search: z.string().max(200).default(''), status: z.enum(['ONLINE', 'OFFLINE', 'UNKNOWN', 'FAULT']).optional(),
    }).parse(request.query));
  });
  server.get('/api/operations/devices/:deviceId', async (request, reply) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    const { deviceId } = z.object({ deviceId: z.string().min(1).max(128) }).parse(request.params);
    return reply.header('Cache-Control', 'no-store').send(await getOperationsDeviceDetail(deviceId));
  });
  server.patch('/api/operations/devices/:deviceId', async (request, reply) => {
    const actor = requireOperationsRole(request.headers.authorization, ['ADMIN']).username;
    const { deviceId } = z.object({ deviceId: z.string().min(1).max(128) }).parse(request.params);
    const input = DeviceProfileEditSchema.parse(request.body);
    return reply.header('Cache-Control', 'no-store').send(await updateOperationsDeviceProfile(deviceId, input, actor));
  });
  server.get("/api/development/console", async () => getDevelopmentConsoleData());
  server.post('/api/development/scenarios/evaluate', async (request) => evaluateDevelopmentScenario(request.body));
  server.get('/api/development/live', async (request) => {
    const { deviceId } = z.object({ deviceId: z.string().min(1) }).parse(request.query);
    return getDevelopmentLiveData(deviceId);
  });
  server.get("/api/operations/console", async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    const { section } = z.object({ section: z.enum(['overview', 'devices', 'knowledge', 'ai', 'records', 'system', 'all']).default('overview') }).parse(request.query);
    return getOperationsConsoleData(section);
  });
}
