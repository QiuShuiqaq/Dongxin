import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import Fastify from 'fastify';
import { ApiError } from '../http/apiError.js';

let edits = 0;
const replace = (path: string, namedExports: Record<string, unknown>) =>
  mock.module(new URL(path, import.meta.url).href, { namedExports });

replace('../services/console.service.js', {
  getDevelopmentConsoleData: async () => ({}),
  getOperationsConsoleData: async () => ({}),
  getOperationsDevicePage: async () => ({ items: [], total: 0, page: 1 }),
  getOperationsDeviceDetail: async () => ({ device: { id: 'DX-PILOT-001' }, lastReport: null, recentEvents: [], recentCommands: [] }),
  updateOperationsDeviceProfile: async (deviceId: string, input: { name?: string; notes?: string }, actor: string) => {
    edits++;
    return { device: { id: deviceId, ...input }, actor };
  },
});
replace('../services/operationsAuth.service.js', {
  requireOperationsRole: (authorization: string | undefined, roles: string[]) => {
    if (authorization !== 'admin' || !roles.includes('ADMIN')) throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
    return { username: 'admin', role: 'ADMIN' };
  },
});
replace('../services/developmentLive.service.js', { getDevelopmentLiveData: async () => ({}) });
replace('../services/developmentScenario.service.js', { evaluateDevelopmentScenario: async () => ({}) });
replace('../runtime/status.js', { getRuntimeStatus: () => ({}) });

const { registerConsoleRoutes } = await import('./consoles.routes.js');

test('operations device profile edits require admin and reject identity changes', async () => {
  const server = Fastify();
  await server.register(registerConsoleRoutes);
  const url = '/api/operations/devices/DX-PILOT-001';
  try {
    edits = 0;
    const denied = await server.inject({ method: 'PATCH', url, headers: { authorization: 'viewer' }, payload: { name: 'Test' } });
    assert.equal(denied.statusCode, 403);
    assert.equal(edits, 0);
    const forbiddenField = await server.inject({ method: 'PATCH', url, headers: { authorization: 'admin' }, payload: { model: 'other-model' } });
    assert.notEqual(forbiddenField.statusCode, 200);
    assert.equal(edits, 0);
    const updated = await server.inject({ method: 'PATCH', url, headers: { authorization: 'admin' }, payload: { name: 'Pilot', notes: 'Lab' } });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().actor, 'admin');
    assert.equal(edits, 1);
  } finally { await server.close(); }
});

test('operations read endpoints reject unauthenticated requests', async () => {
  const server = Fastify();
  await server.register(registerConsoleRoutes);
  try {
    for (const url of [
      '/api/operations/runtime',
      '/api/operations/devices',
      '/api/operations/devices/DX-PILOT-001',
      '/api/operations/console?section=overview',
    ]) {
      const denied = await server.inject({ method: 'GET', url });
      assert.equal(denied.statusCode, 403, url);
      const allowed = await server.inject({ method: 'GET', url, headers: { authorization: 'admin' } });
      assert.equal(allowed.statusCode, 200, url);
    }
  } finally { await server.close(); }
});
