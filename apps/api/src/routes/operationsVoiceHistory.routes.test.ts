import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import Fastify from 'fastify';

const calls: unknown[] = [];
mock.module(new URL('../repositories/productionVoiceHistory.repository.js', import.meta.url).href, {
  namedExports: {
    pageProductionVoiceHistory: async (filter: unknown) => {
      calls.push(filter);
      return {
        items: [{
          id: '269d9a5e-4576-4a32-a897-928ad0f6bd3f',
          sessionId: 'device-session-1',
          deviceId: 'DX-001',
          inputSource: 'DEVICE_TEXT',
          inputText: '开灯',
          replyText: '已打开照明。',
          route: 'ONLINE_RULE',
          result: 'COMPLETED',
          intent: 'LIGHT_ON',
          safetyDecision: 'APPROVED',
          commandStatus: 'QUEUED',
          latencyMs: 12,
          costCny: 0,
          error: null,
          createdAt: '2026-11-11T07:00:00.000Z',
        }],
        page: 2,
        pageSize: 10,
        total: 1,
      };
    },
  },
});

const { OperationsVoiceHistoryQuerySchema, registerOperationsVoiceHistoryRoutes } =
  await import('./operationsVoiceHistory.routes.js');

test('operations voice history forwards bounded filters and disables caching', async () => {
  const server = Fastify();
  await server.register(registerOperationsVoiceHistoryRoutes);
  try {
    calls.length = 0;
    const response = await server.inject({
      method: 'GET',
      url: '/api/operations/voice-history?page=2&pageSize=10&deviceId=DX-001&result=COMPLETED&from=2026-11-01T00%3A00%3A00.000Z&to=2026-11-11T23%3A59%3A59.999Z',
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(calls, [{
      page: 2,
      pageSize: 10,
      deviceId: 'DX-001',
      result: 'COMPLETED',
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-11T23:59:59.999Z',
    }]);
    const body = response.json();
    assert.equal(body.total, 1);
    assert.equal(body.items[0].inputSource, 'DEVICE_TEXT');
    assert.equal('audioBase64' in body.items[0], false);
  } finally {
    await server.close();
  }
});

test('operations voice history query rejects invalid pages, filters and date ranges', () => {
  assert.deepEqual(OperationsVoiceHistoryQuerySchema.parse({}), { page: 1, pageSize: 20 });
  for (const query of [
    { page: '0' },
    { pageSize: '101' },
    { result: 'UNKNOWN' },
    { from: 'not-a-date' },
    { from: '2026-11-12T00:00:00.000Z', to: '2026-11-11T00:00:00.000Z' },
  ]) {
    assert.equal(OperationsVoiceHistoryQuerySchema.safeParse(query).success, false);
  }
});
