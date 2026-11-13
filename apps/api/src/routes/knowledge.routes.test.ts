import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import Fastify from 'fastify';
import { z } from 'zod';
import { ApiError } from '../http/apiError.js';

const replace = (path: string, namedExports: Record<string, unknown>) =>
  mock.module(new URL(path, import.meta.url).href, { namedExports });

let reads = 0;
const read = <T>(result: T) => async () => { reads += 1; return result; };

replace('../services/knowledge.service.js', {
  answerKnowledgeQuestion: read({ answer: '' }),
  getKnowledgeHistory: read({ versions: [], events: [] }),
  KnowledgeDocumentParamsSchema: z.object({ documentId: z.string().min(1) }),
  listKnowledgeDocuments: read([]),
  listKnowledgeSources: read([]),
  updateKnowledgeDocument: async () => ({}),
  upsertKnowledgeDocument: async () => ({}),
});
replace('../services/knowledgeSource.service.js', {
  getKnowledgeSourceFile: read({ source: { fileName: 'source.txt' }, buffer: Buffer.from('source') }),
  importKnowledgeSourceSections: async () => ({}),
  previewKnowledgeSource: read({}),
  uploadKnowledgeSource: async () => ({}),
});
replace('../services/operationsAuth.service.js', {
  requireOperationsRole: (authorization: string | undefined, roles: string[]) => {
    const role = authorization === 'admin' ? 'ADMIN' : authorization === 'editor' ? 'EDITOR'
      : authorization === 'reviewer' ? 'REVIEWER' : null;
    if (!role || !roles.includes(role)) throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
    return { username: role.toLowerCase(), role };
  },
});

const { registerKnowledgeRoutes } = await import('./knowledge.routes.js');

test('knowledge reads and query require a staff session before accessing content', async () => {
  const server = Fastify();
  await server.register(registerKnowledgeRoutes);
  const routes = [
    { method: 'GET', url: '/api/knowledge/documents' },
    { method: 'GET', url: '/api/knowledge/sources' },
    { method: 'GET', url: '/api/knowledge/entries' },
    { method: 'GET', url: '/api/knowledge/documents/doc-1/history' },
    { method: 'GET', url: '/api/knowledge/sources/source-1/preview' },
    { method: 'GET', url: '/api/knowledge/sources/source-1/file' },
    { method: 'POST', url: '/api/knowledge/query', payload: { question: 'What is this product?' } },
  ] as const;
  try {
    reads = 0;
    for (const route of routes) {
      const denied = await server.inject(route);
      assert.equal(denied.statusCode, 403, `${route.method} ${route.url}`);
    }
    assert.equal(reads, 0, 'unauthenticated requests must not reach knowledge storage');
    for (const route of routes) {
      const allowed = await server.inject({ ...route, headers: { authorization: 'reviewer' } });
      assert.equal(allowed.statusCode, 200, `${route.method} ${route.url}`);
    }
    assert.ok(reads > 0);
  } finally {
    await server.close();
  }
});
