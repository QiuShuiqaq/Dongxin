import type { FastifyInstance } from 'fastify';
import { getMqttGatewayStatus } from '../services/mqttGateway.service.js';

export async function registerHealthRoutes(server: FastifyInstance): Promise<void> {
  server.get('/', async () => ({
    ok: true,
    service: 'dongxin-ai-lab-api',
    message: 'API service is running. Open the web console at http://127.0.0.1:5173.',
    frontendUrl: 'http://127.0.0.1:5173',
    healthUrl: '/api/health',
    time: new Date().toISOString()
  }));

  server.get('/api/health', async () => ({
    ok: true,
    service: 'dongxin-ai-lab-api',
    mqtt: getMqttGatewayStatus(),
    time: new Date().toISOString()
  }));
}
