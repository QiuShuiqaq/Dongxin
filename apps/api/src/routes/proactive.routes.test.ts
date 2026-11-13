import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import Fastify from 'fastify';
import { ApiError } from '../http/apiError.js';

const replace = (path: string, namedExports: Record<string, unknown>) =>
  mock.module(new URL(path, import.meta.url).href, { namedExports });

let updates = 0;
replace('../services/operationsAuth.service.js', {
  requireOperationsRole: (authorization: string | undefined, roles: string[]) => {
    const role = authorization === 'admin' ? 'ADMIN' : authorization === 'viewer' ? 'REVIEWER' : null;
    if (!role || !roles.includes(role)) throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
    return { username: role.toLowerCase(), role };
  },
});
replace('../services/proactive.service.js', {
  getProactiveSettings: async () => ({ enabled: false }),
  updateProactiveSettings: async () => { updates += 1; return { enabled: true }; },
  listProactiveLogs: async () => [],
  handleProactiveEvent: async () => ({}),
  simulateProactiveEvent: async () => ({}),
  simulateProactiveEntrance: async () => ({}),
});

const { registerProactiveRoutes } = await import('./proactive.routes.js');

test('proactive settings and logs require staff login; changes require admin', async () => {
  const server = Fastify();
  await server.register(registerProactiveRoutes);
  try {
    for (const url of ['/api/proactive/settings', '/api/proactive/logs']) {
      assert.equal((await server.inject({ method: 'GET', url })).statusCode, 403);
      assert.equal((await server.inject({ method: 'GET', url, headers: { authorization: 'viewer' } })).statusCode, 200);
    }
    for (const authorization of [undefined, 'viewer']) {
      assert.equal((await server.inject({ method: 'PATCH', url: '/api/proactive/settings',
        headers: authorization ? { authorization } : {}, payload: {} })).statusCode, 403);
    }
    assert.equal(updates, 0);
    assert.equal((await server.inject({ method: 'PATCH', url: '/api/proactive/settings',
      headers: { authorization: 'admin' }, payload: {} })).statusCode, 200);
    assert.equal(updates, 1);
  } finally {
    await server.close();
  }
});
