import type { FastifyInstance } from 'fastify';
import { handleVoiceTurn } from '../services/voice.service.js';

export async function registerVoiceRoutes(server: FastifyInstance): Promise<void> {
  server.post('/api/voice/turn', async (request) => handleVoiceTurn(request.body));
}

