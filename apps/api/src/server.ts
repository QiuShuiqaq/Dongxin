import cors from '@fastify/cors';
import Fastify from 'fastify';
import { z } from 'zod';
import { ApiError, errorBody } from './http/apiError.js';
import { registerRoutes } from './routes/index.js';

export async function createServer() {
  const server = Fastify({
    logger: true,
    bodyLimit: 10 * 1024 * 1024
  });

  await server.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Device-Id', 'X-Request-Id', 'X-Timestamp', 'X-Signature']
  });

  await registerRoutes(server);

  server.setErrorHandler((error, _request, reply) => {
    const isValidationError = error instanceof z.ZodError;
    const isApiError = error instanceof ApiError;
    const statusCode = isValidationError ? 422 : isApiError ? error.statusCode : 500;
    const code = isValidationError ? 'VALIDATION_ERROR' : isApiError ? error.code : 'INTERNAL_ERROR';
    const message = error instanceof Error ? error.message : String(error);

    server.log.error(error);
    reply.status(statusCode).send(errorBody(code, message));
  });

  return server;
}
