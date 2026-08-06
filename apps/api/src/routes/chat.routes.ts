import type { FastifyInstance } from 'fastify';
import { runChatTest } from '../services/chatTest.service.js';

export async function registerChatRoutes(server: FastifyInstance): Promise<void> {
  server.post('/api/chat/test', async (request) => runChatTest(request.body));
}

