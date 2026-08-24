import type { FastifyInstance } from 'fastify';
import { ProductionCostSettingsSchema } from '@dongxin/shared';
import {
  getProductionCostSettings,
  saveProductionCostSettings
} from '../repositories/productionCost.repository.js';

export async function registerProductionCostRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/production-cost-settings', async () => getProductionCostSettings());

  server.put('/api/production-cost-settings', async (request) => {
    const settings = ProductionCostSettingsSchema.parse({
      ...(request.body as Record<string, unknown>),
      updatedAt: new Date().toISOString()
    });
    return saveProductionCostSettings(settings);
  });
}
