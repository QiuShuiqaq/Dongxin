import type { FastifyInstance } from 'fastify';
import {
  answerKnowledgeQuestion,
  getKnowledgeHistory,
  KnowledgeDocumentParamsSchema,
  listKnowledgeDocuments,
  listKnowledgeSources,
  updateKnowledgeDocument,
  upsertKnowledgeDocument
} from '../services/knowledge.service.js';
import { requireOperationsRole } from '../services/operationsAuth.service.js';
import { getKnowledgeSourceFile, importKnowledgeSourceSections, previewKnowledgeSource, uploadKnowledgeSource } from '../services/knowledgeSource.service.js';
import { z } from 'zod';

export async function registerKnowledgeRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/knowledge/documents', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    return listKnowledgeDocuments();
  });

  server.get('/api/knowledge/sources', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    return listKnowledgeSources();
  });

  server.get('/api/knowledge/entries', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    const query = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
      search: z.string().max(200).default(''), status: z.enum(['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED']).optional(),
      scope: z.enum(['COMPANY', 'GENERAL', 'MODEL', 'REFERENCE']).optional(), model: z.string().max(100).optional() }).parse(request.query);
    const documents = await listKnowledgeDocuments();
    const search = query.search.toLowerCase();
    const filtered = documents.filter((document) => (!query.status || document.status === query.status) && (!query.scope || document.scope === query.scope)
      && (!query.model || document.modelIds?.includes(query.model))
      && (!search || [document.title, document.content, ...document.tags, ...(document.questionVariants ?? [])].join(' ').toLowerCase().includes(search)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const published = documents.filter((document) => document.status === 'PUBLISHED' && document.scope !== 'REFERENCE');
    return { items: filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: filtered.length, page: query.page,
      coverage: { publishedTopics: published.length, questionForms: new Set(published.flatMap((document) => [document.title, ...(document.questionVariants ?? [])])
        .map((text) => text.replace(/[\s\p{P}]/gu, '').toLowerCase())).size, characters: published.reduce((sum, document) => sum + document.content.length, 0) },
      counts: { published: documents.filter((item) => item.status === 'PUBLISHED').length, review: documents.filter((item) => item.status === 'IN_REVIEW').length,
        drafts: documents.filter((item) => item.status === 'DRAFT').length, archived: documents.filter((item) => item.status === 'ARCHIVED').length } };
  });
  server.get('/api/knowledge/documents/:documentId/history', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    return getKnowledgeHistory(KnowledgeDocumentParamsSchema.parse(request.params).documentId);
  });
  server.get('/api/knowledge/sources/:sourceId/preview', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    return previewKnowledgeSource(z.object({ sourceId: z.string().min(1) }).parse(request.params).sourceId);
  });
  server.post('/api/knowledge/sources/:sourceId/import', async (request) => importKnowledgeSourceSections(
    z.object({ sourceId: z.string().min(1) }).parse(request.params).sourceId, request.body,
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR']).username));
  server.get('/api/knowledge/sources/:sourceId/file', async (request, reply) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    const { source, buffer } = await getKnowledgeSourceFile(z.object({ sourceId: z.string().min(1) }).parse(request.params).sourceId);
    return reply.header('Content-Type', 'application/octet-stream').header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(source.fileName)}`)
      .header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').send(buffer);
  });
  server.post('/api/knowledge/sources', async (request) => uploadKnowledgeSource(request.body,
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR']).username));

  server.post('/api/knowledge/documents', async (request) => upsertKnowledgeDocument(
    request.body, requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR']).username));

  server.patch('/api/knowledge/documents/:documentId', async (request) => updateKnowledgeDocument(
    KnowledgeDocumentParamsSchema.parse(request.params).documentId,
    request.body,
    requireOperationsRole(request.headers.authorization, ['PUBLISH', 'REJECT'].includes(z.object({ action: z.string().default('SAVE') }).parse(request.body).action)
      ? ['ADMIN', 'REVIEWER'] : ['ADMIN', 'EDITOR']).username));

  server.post('/api/knowledge/query', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    return answerKnowledgeQuestion(request.body);
  });
}

