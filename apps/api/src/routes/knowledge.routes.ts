import type { FastifyInstance } from 'fastify';
import {
  answerKnowledgeQuestion,
  listKnowledgeDocuments,
  upsertKnowledgeDocument
} from '../services/knowledge.service.js';

export async function registerKnowledgeRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/knowledge/documents', async () => listKnowledgeDocuments());

  server.post('/api/knowledge/documents', async (request) => upsertKnowledgeDocument(request.body));

  server.post('/api/knowledge/query', async (request) => answerKnowledgeQuestion(request.body));
}

