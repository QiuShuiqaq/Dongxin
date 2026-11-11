import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import Fastify from 'fastify';
import { ApiError } from '../http/apiError.js';

const secret = 'sk-private-test-value';
let savedKeys = 0;
const auditEvents: Record<string, unknown>[] = [];
const replace = (path: string, namedExports: Record<string, unknown>) =>
  mock.module(new URL(path, import.meta.url).href, { namedExports });

replace('../services/operationsAuth.service.js', {
  requireOperationsRole: (authorization: string | undefined, roles: string[]) => {
    const role = authorization === 'admin' ? 'ADMIN' : authorization === 'viewer' ? 'REVIEWER' : null;
    if (!role || !roles.includes(role)) throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
    return { username: role.toLowerCase(), role };
  },
});
replace('../services/operationsAiAudit.service.js', {
  auditAiChange: async (_request: unknown, actor: string, summary: string, fields: Record<string, unknown>) => {
    auditEvents.push({ actor, summary, ...fields });
  },
});
replace('../services/modelPricing.service.js', { saveProviderPricing: async () => ({ id: 'tts', model: 'cosyvoice-v3-flash' }) });
replace('../services/providerCatalog.service.js', {
  listCatalogVendors: () => [{ id: 'aliyun', label: 'Aliyun', configured: true }],
  fetchCatalogModels: async () => ({ vendor: 'aliyun', models: [] }),
  saveCatalogApiKey: async (_vendor: string, body: { apiKey: string }) => { assert.equal(body.apiKey, secret); savedKeys++; return { configured: true }; },
  addCatalogModel: async () => ({ id: 'llm', model: 'qwen-flash' }),
  useCatalogModel: async () => ({ provider: { id: 'llm', model: 'qwen-flash' }, defaults: {} }),
});
replace('../services/provider.service.js', {
  listProviders: async () => [],
  listProviderSecretStatuses: async () => [],
  saveProviders: async () => [],
  saveProviderApiKey: async () => ({ providerId: 'tts', isConfigured: true }),
  clearProviderApiKey: async () => ({ providerId: 'tts', isConfigured: false }),
  ProviderParamsSchema: (await import('zod')).z.object({ providerId: (await import('zod')).z.string().min(1) }),
});

const { registerProvidersRoutes } = await import('./providers.routes.js');

test('only administrators can save vendor keys, and audit excludes secret values', async () => {
  const server = Fastify();
  await server.register(registerProvidersRoutes);
  try {
    savedKeys = 0;
    auditEvents.length = 0;
    const path = '/api/providers/catalog/aliyun/api-key';
    const payload = { apiKey: secret };
    const denied = await server.inject({ method: 'PUT', url: path, headers: { authorization: 'viewer' }, payload });
    assert.equal(denied.statusCode, 403);
    assert.equal(savedKeys, 0);
    const allowed = await server.inject({ method: 'PUT', url: path, headers: { authorization: 'admin' }, payload });
    assert.equal(allowed.statusCode, 200);
    assert.equal(savedKeys, 1);
    assert.equal(auditEvents.length, 1);
    assert.equal(JSON.stringify(auditEvents).includes(secret), false);
    assert.equal(auditEvents[0].actor, 'admin');
  } finally { await server.close(); }
});
