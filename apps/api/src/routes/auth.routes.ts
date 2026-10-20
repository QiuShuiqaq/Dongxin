import type { FastifyInstance } from "fastify";
import {
  authenticateOperationsRequest,
  getLocalOperationsSession,
  getOperationsAuthStatus,
  loginOperationsUser,
} from "../services/operationsAuth.service.js";

export async function registerAuthRoutes(
  server: FastifyInstance,
): Promise<void> {
  server.post("/api/auth/login", async (request) =>
    loginOperationsUser(request.body),
  );

  server.get("/api/auth/session", async (request) => {
    const localSession = getLocalOperationsSession();
    if (localSession) return localSession;
    return {
      mode: "ENABLED" as const,
      user: authenticateOperationsRequest(request.headers.authorization),
    };
  });

  server.get("/api/auth/status", async () => getOperationsAuthStatus());
}
