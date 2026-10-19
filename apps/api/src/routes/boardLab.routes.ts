import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  getBoardLabDeviceState,
  getBoardLabRequest,
  startBoardLabAction
} from '../services/boardLab.service.js';

const DeviceParamsSchema = z.object({ deviceId: z.string().min(1) });
const RequestParamsSchema = z.object({ requestId: z.string().uuid() });

export async function registerBoardLabRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/development/board-lab/devices/:deviceId', async (request) => {
    const { deviceId } = DeviceParamsSchema.parse(request.params);
    return getBoardLabDeviceState(deviceId);
  });
  server.post('/api/development/board-lab/devices/:deviceId/actions', async (request) => {
    const { deviceId } = DeviceParamsSchema.parse(request.params);
    return startBoardLabAction(deviceId, request.body);
  });
  server.get('/api/development/board-lab/requests/:requestId', async (request) => {
    const { requestId } = RequestParamsSchema.parse(request.params);
    return getBoardLabRequest(requestId);
  });
}
