import type { FastifyInstance } from 'fastify';
import {
  CreateTestSetRequestSchema,
  ImportTestSetMarkdownRequestSchema,
  UpdateTestSetRequestSchema
} from '@dongxin/shared';
import { z } from 'zod';
import {
  createTestSet,
  deleteTestSet,
  getTestSet,
  importTestSetMarkdown,
  listTestSetSummaries,
  updateTestSet
} from '../services/testSet.service.js';

const TestSetParamsSchema = z.object({
  testSetId: z.string().min(1)
});

export async function registerTestSetsRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/test-sets', async () => listTestSetSummaries());

  server.get('/api/test-sets/:testSetId', async (request) => {
    const params = TestSetParamsSchema.parse(request.params);
    return getTestSet(params.testSetId);
  });

  server.post('/api/test-sets', async (request) => {
    CreateTestSetRequestSchema.parse(request.body);
    return createTestSet(request.body);
  });

  server.post('/api/test-sets/import-md', async (request) => {
    ImportTestSetMarkdownRequestSchema.parse(request.body);
    return importTestSetMarkdown(request.body);
  });

  server.patch('/api/test-sets/:testSetId', async (request) => {
    const params = TestSetParamsSchema.parse(request.params);
    UpdateTestSetRequestSchema.parse(request.body);
    return updateTestSet(params.testSetId, request.body);
  });

  server.delete('/api/test-sets/:testSetId', async (request) => {
    const params = TestSetParamsSchema.parse(request.params);
    await deleteTestSet(params.testSetId);
    return { success: true };
  });
}
