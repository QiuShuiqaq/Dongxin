import type { FastifyInstance } from 'fastify';
import { listPrompts } from '../services/prompt.service.js';

export async function registerPromptsRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/prompts', async () => listPrompts());
}

