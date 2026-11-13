import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import Fastify from 'fastify';
import { ApiError } from '../http/apiError.js';

const replace = (path: string, namedExports: Record<string, unknown>) =>
  mock.module(new URL(path, import.meta.url).href, { namedExports });

replace('../services/operationsAuth.service.js', {
  requireOperationsRole: (authorization: string | undefined, roles: string[]) => {
    const role = authorization === 'admin' ? 'ADMIN' : authorization === 'viewer' ? 'REVIEWER' : null;
    if (!role || !roles.includes(role)) throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
    return { username: role.toLowerCase(), role };
  },
});
replace('../services/testSet.service.js', {
  listTestSetSummaries: async () => [{ id: 'managed-1', name: 'Test set' }],
  getTestSet: async (id: string) => ({ id, name: 'Test set', cases: [] }),
  addTestCaseToSet: async () => ({}),
  createTestSet: async () => ({}),
  deleteTestCaseFromSet: async () => ({}),
  deleteTestSet: async () => undefined,
  importTestSetMarkdown: async () => ({}),
  updateTestCaseInSet: async () => ({}),
  updateTestSet: async () => ({}),
});

const { registerTestSetsRoutes } = await import('./testSets.routes.js');

test('test-set list and detail require an administrator', async () => {
  const server = Fastify();
  await server.register(registerTestSetsRoutes);
  try {
    for (const url of ['/api/test-sets', '/api/test-sets/managed-1']) {
      assert.equal((await server.inject({ method: 'GET', url })).statusCode, 403);
      assert.equal((await server.inject({ method: 'GET', url, headers: { authorization: 'viewer' } })).statusCode, 403);
      assert.equal((await server.inject({ method: 'GET', url, headers: { authorization: 'admin' } })).statusCode, 200);
    }
  } finally {
    await server.close();
  }
});

test('test-set writes require an administrator before validating or changing data', async () => {
  const server = Fastify();
  await server.register(registerTestSetsRoutes);
  const writes = [
    { method: 'POST', url: '/api/test-sets' },
    { method: 'POST', url: '/api/test-sets/import-md' },
    { method: 'PATCH', url: '/api/test-sets/managed-1' },
    { method: 'DELETE', url: '/api/test-sets/managed-1' },
    { method: 'POST', url: '/api/test-sets/managed-1/cases' },
    { method: 'PATCH', url: '/api/test-sets/managed-1/cases/case-1' },
    { method: 'DELETE', url: '/api/test-sets/managed-1/cases/case-1' },
  ] as const;
  try {
    for (const { method, url } of writes) {
      const payload = method === 'DELETE' ? undefined : {};
      for (const authorization of [undefined, 'viewer']) {
        const response = await server.inject({
          method,
          url,
          headers: authorization ? { authorization } : {},
          payload,
        });
        assert.equal(response.statusCode, 403, `${method} ${url} (${authorization ?? 'anonymous'})`);
      }
    }
  } finally {
    await server.close();
  }
});
