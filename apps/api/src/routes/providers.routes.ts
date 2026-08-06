import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ModelProviderSchema } from '@dongxin/shared';
import {
  clearProviderApiKey,
  listProviderSecretStatuses,
  listProviders,
  ProviderParamsSchema,
  saveProviderApiKey,
  saveProviders
} from '../services/provider.service.js';

export async function registerProvidersRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/providers', async () => listProviders());

  server.put('/api/providers', async (request) => {
    const providers = z.array(ModelProviderSchema).parse(request.body);
    return saveProviders(providers);
  });

  server.get('/api/providers/secret-status', async () => listProviderSecretStatuses());

  server.put('/api/providers/:providerId/api-key', async (request) => {
    const params = ProviderParamsSchema.parse(request.params);
    return saveProviderApiKey(params.providerId, request.body);
  });

  server.delete('/api/providers/:providerId/api-key', async (request) => {
    const params = ProviderParamsSchema.parse(request.params);
    return clearProviderApiKey(params.providerId);
  });
}

