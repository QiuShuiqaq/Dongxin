import type { FastifyInstance } from 'fastify';
import { getProactiveSettings } from '../services/proactive.service.js';
import { getCurrentDeviceState } from '../services/device.service.js';
import { listRecentEvaluations } from '../services/evaluation.service.js';
import { listKnowledgeDocuments } from '../services/knowledge.service.js';
import { listLogs } from '../services/log.service.js';
import { listPrompts } from '../services/prompt.service.js';
import { listProviders } from '../services/provider.service.js';
import { listTestCases } from '../services/testCase.service.js';
import { listTestSetSummaries } from '../services/testSet.service.js';
import { listDevices } from '../services/deviceRegistry.service.js';
import { getProductionCostSettings } from '../repositories/productionCost.repository.js';

export async function registerBootstrapRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/bootstrap', async () => {
    const [providers, prompts, testCases, testSets, evaluations] = await Promise.all([
      listProviders(),
      listPrompts(),
      listTestCases(),
      listTestSetSummaries(),
      listRecentEvaluations(20)
    ]);
    const [devices, knowledgeDocuments, proactiveSettings, logs, productionCostSettings] = await Promise.all([
      listDevices(),
      listKnowledgeDocuments(),
      getProactiveSettings(),
      listLogs({ limit: 20 }),
      getProductionCostSettings()
    ]);

    return {
      providers,
      prompts,
      testCases,
      testSets,
      evaluations,
      devices,
      knowledgeDocuments,
      proactiveSettings,
      logs,
      productionCostSettings,
      deviceState: getCurrentDeviceState()
    };
  });
}
