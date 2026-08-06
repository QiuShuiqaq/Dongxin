import type { FastifyInstance } from 'fastify';
import { listRecentEvaluations, runEvaluation } from '../services/evaluation.service.js';

export async function registerEvaluationsRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/evaluations', async () => listRecentEvaluations(50));

  server.post('/api/evaluations/run', async (request) => runEvaluation(request.body));
}

