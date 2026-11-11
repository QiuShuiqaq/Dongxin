import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pageProductionVoiceHistory } from '../repositories/productionVoiceHistory.repository.js';

export const OperationsVoiceHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  deviceId: z.string().trim().min(1).max(256).optional(),
  result: z.enum(['COMPLETED', 'FAILED']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).superRefine((value, context) => {
  if (value.from && value.to && Date.parse(value.from) > Date.parse(value.to)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['from'],
      message: 'from must not be later than to',
    });
  }
});

export async function registerOperationsVoiceHistoryRoutes(server: FastifyInstance): Promise<void> {
  server.get('/api/operations/voice-history', async (request, reply) => {
    const query = OperationsVoiceHistoryQuerySchema.parse(request.query);
    reply.header('Cache-Control', 'no-store');
    return pageProductionVoiceHistory(query);
  });
}
