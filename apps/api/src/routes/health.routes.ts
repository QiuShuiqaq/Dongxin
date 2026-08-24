import type { FastifyInstance } from 'fastify';

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
    time: new Date().toISOString()
  }));
}
