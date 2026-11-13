import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import Fastify from 'fastify';
import { ApiError } from '../http/apiError.js';
import { ZodError } from 'zod';

mock.module(new URL('../services/operationsAuth.service.js', import.meta.url).href, {
  namedExports: {
    requireOperationsRole: (authorization: string | undefined, roles: string[]) => {
      const role = authorization === 'admin' ? 'ADMIN' : authorization === 'viewer' ? 'REVIEWER' : null;
      if (!role || !roles.includes(role)) throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
      return { username: role.toLowerCase(), role };
    },
  },
});

const { registerLabRoutes } = await import('./lab.routes.js');

test('cloud lab catalog and evaluation require administrator access', async () => {
  const server = Fastify();
  await server.register(registerLabRoutes);
  try {
    for (const method of ['GET', 'POST'] as const) {
      const url = method === 'GET' ? '/api/operations/lab/scenarios' : '/api/operations/lab/scenarios/evaluate';
      const payload = method === 'POST' ? { deviceId: 'DX-SIM-001', scenario: 'CI_WAKE_ONLY' } : undefined;
      assert.equal((await server.inject({ method, url, payload })).statusCode, 403);
      assert.equal((await server.inject({ method, url, payload, headers: { authorization: 'viewer' } })).statusCode, 403);
      assert.equal((await server.inject({ method, url, payload, headers: { authorization: 'admin' } })).statusCode, 200);
    }
  } finally {
    await server.close();
  }
});

test('each cloud lab scenario is explicitly a non-operative simulation', async () => {
  const server = Fastify();
  await server.register(registerLabRoutes);
  try {
    const catalogResponse = await server.inject({ method: 'GET', url: '/api/operations/lab/scenarios', headers: { authorization: 'admin' } });
    assert.equal(catalogResponse.statusCode, 200);
    const catalog = catalogResponse.json() as { scenarios: Array<{ id: string; title: string; category: string; summary: string }> };
    assert.equal(catalog.scenarios.length, 8);
    assert.ok(catalog.scenarios.some((scenario) => scenario.id === 'PROVISIONING_LONG_PRESS'));
    for (const scenario of catalog.scenarios) {
      const response = await server.inject({
        method: 'POST', url: '/api/operations/lab/scenarios/evaluate',
        headers: { authorization: 'admin' },
        payload: { deviceId: 'DX-SIM-001', scenario: scenario.id },
      });
      assert.equal(response.statusCode, 200, scenario.id);
      const result = response.json();
      assert.equal(result.scenario, scenario.id);
      assert.equal(result.deviceId, 'DX-SIM-001');
      assert.equal(result.simulation, true);
      assert.equal(result.actionExecuted, false);
      assert.equal(result.deviceStateChanged, false);
      assert.equal(result.audioPlayed, false);
      assert.equal(result.mqttPublished, false);
      assert.ok(result.steps.length > 0);
      assert.match(result.note, /不代表真实/);
      if (scenario.id === 'PROVISIONING_LONG_PRESS') assert.match(result.expected, /尚未接入当前样机/);
    }
  } finally {
    await server.close();
  }
});

test('cloud lab rejects unknown scenarios and operational parameters', async () => {
  const server = Fastify();
  server.setErrorHandler((error, _request, reply) => reply.status(error instanceof ZodError ? 422 : 500).send());
  await server.register(registerLabRoutes);
  try {
    const run = (payload: Record<string, string | boolean>) => server.inject({
      method: 'POST', url: '/api/operations/lab/scenarios/evaluate', headers: { authorization: 'admin' }, payload,
    });
    assert.equal((await run({ deviceId: 'DX-PILOT-001', scenario: 'UNKNOWN' })).statusCode, 422);
    assert.equal((await run({ deviceId: 'DX-PILOT-001', scenario: 'CI_WAKE_ONLY' })).statusCode, 422);
    assert.equal((await run({ deviceId: 'DX-PILOT-001', scenario: 'OCCUPANCY_ENTER', playToDevice: true })).statusCode, 422);
    assert.equal((await run({ deviceId: '../device', scenario: 'CI_WAKE_ONLY' })).statusCode, 422);
  } finally {
    await server.close();
  }
});
