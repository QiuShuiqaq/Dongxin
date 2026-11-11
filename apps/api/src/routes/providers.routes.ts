import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ModelProviderSchema } from '@dongxin/shared';
import { saveProviderPricing } from '../services/modelPricing.service.js';
import { auditAiChange } from '../services/operationsAiAudit.service.js';
import { requireOperationsRole } from '../services/operationsAuth.service.js';
import {
  addCatalogModel,
  fetchCatalogModels,
  listCatalogVendors,
  saveCatalogApiKey,
  useCatalogModel,
} from '../services/providerCatalog.service.js';
import {
  clearProviderApiKey,
  listProviderSecretStatuses,
  listProviders,
  ProviderParamsSchema,
  saveProviderApiKey,
  saveProviders
} from '../services/provider.service.js';

export async function registerProvidersRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/providers/catalog/vendors', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    return listCatalogVendors();
  });
  server.put('/api/providers/catalog/:vendor/api-key', async (request) => {
    const actor = requireOperationsRole(request.headers.authorization, ['ADMIN']);
    const params = z.object({ vendor: z.string() }).parse(request.params);
    const result = await saveCatalogApiKey(params.vendor, request.body);
    await auditAiChange(request, actor.username, 'Save AI vendor API key', { vendor: params.vendor, fields: ['apiKey'] });
    return result;
  });
  server.get('/api/providers/catalog/:vendor/models', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    const params = z.object({ vendor: z.string() }).parse(request.params);
    return fetchCatalogModels(params.vendor);
  });
  server.post('/api/providers/catalog/:vendor/models', async (request) => {
    const actor = requireOperationsRole(request.headers.authorization, ['ADMIN']);
    const params = z.object({ vendor: z.string() }).parse(request.params);
    const result = await addCatalogModel(params.vendor, request.body);
    await auditAiChange(request, actor.username, 'Add AI model', { vendor: params.vendor, providerId: result.id, model: result.model });
    return result;
  });
  server.put('/api/providers/catalog/:vendor/default', async (request) => {
    const actor = requireOperationsRole(request.headers.authorization, ['ADMIN']);
    const params = z.object({ vendor: z.string() }).parse(request.params);
    const result = await useCatalogModel(params.vendor, request.body);
    await auditAiChange(request, actor.username, 'Set default LLM model', { vendor: params.vendor, providerId: result.provider.id, model: result.provider.model });
    return result;
  });

  server.get('/api/providers', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    return listProviders();
  });
  server.put('/api/providers/:providerId/pricing', async (request) => {
    const actor = requireOperationsRole(request.headers.authorization, ['ADMIN']);
    const params = ProviderParamsSchema.parse(request.params);
    const result = await saveProviderPricing(params.providerId, request.body);
    await auditAiChange(request, actor.username, 'Update AI model pricing', { providerId: result.id, model: result.model, fields: ['pricing'] });
    return result;
  });

  server.put('/api/providers', async (request) => {
    const actor = requireOperationsRole(request.headers.authorization, ['ADMIN']);
    const providers = z.array(ModelProviderSchema).parse(request.body);
    const result = await saveProviders(providers);
    await auditAiChange(request, actor.username, 'Update AI model catalog', { providers: result.map(({ id, model, serviceType }) => ({ id, model, serviceType })) });
    return result;
  });

  server.get('/api/providers/secret-status', async (request) => {
    requireOperationsRole(request.headers.authorization, ['ADMIN', 'EDITOR', 'REVIEWER']);
    return listProviderSecretStatuses();
  });

  server.put('/api/providers/:providerId/api-key', async (request) => {
    const actor = requireOperationsRole(request.headers.authorization, ['ADMIN']);
    const params = ProviderParamsSchema.parse(request.params);
    const result = await saveProviderApiKey(params.providerId, request.body);
    await auditAiChange(request, actor.username, 'Save AI model API key', { providerId: params.providerId, fields: ['apiKey'] });
    return result;
  });

  server.delete('/api/providers/:providerId/api-key', async (request) => {
    const actor = requireOperationsRole(request.headers.authorization, ['ADMIN']);
    const params = ProviderParamsSchema.parse(request.params);
    const result = await clearProviderApiKey(params.providerId);
    await auditAiChange(request, actor.username, 'Delete AI model API key', { providerId: params.providerId, fields: ['apiKey'] });
    return result;
  });
}

