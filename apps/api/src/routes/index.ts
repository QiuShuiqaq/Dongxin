import type { FastifyInstance } from 'fastify';
import { registerBootstrapRoutes } from './bootstrap.routes.js';
import { registerChatRoutes } from './chat.routes.js';
import { registerDeviceAccessRoutes } from './deviceAccess.routes.js';
import { registerDevicesRoutes } from './devices.routes.js';
import { registerEvaluationsRoutes } from './evaluations.routes.js';
import { registerHealthRoutes } from './health.routes.js';
import { registerKnowledgeRoutes } from './knowledge.routes.js';
import { registerLogsRoutes } from './logs.routes.js';
import { registerProactiveRoutes } from './proactive.routes.js';
import { registerProductionCostRoutes } from './productionCost.routes.js';
import { registerPromptsRoutes } from './prompts.routes.js';
import { registerProvidersRoutes } from './providers.routes.js';
import { registerTestSetsRoutes } from './testSets.routes.js';
import { registerVoiceRoutes } from './voice.routes.js';

export async function registerRoutes(server: FastifyInstance): Promise<void> {
  await registerHealthRoutes(server);
  await registerBootstrapRoutes(server);
  await registerProvidersRoutes(server);
  await registerPromptsRoutes(server);
  await registerEvaluationsRoutes(server);
  await registerChatRoutes(server);
  await registerDeviceAccessRoutes(server);
  await registerDevicesRoutes(server);
  await registerVoiceRoutes(server);
  await registerTestSetsRoutes(server);
  await registerKnowledgeRoutes(server);
  await registerProactiveRoutes(server);
  await registerProductionCostRoutes(server);
  await registerLogsRoutes(server);
}
