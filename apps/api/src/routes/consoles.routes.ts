import type { FastifyInstance } from "fastify";
import { getDevelopmentConsoleData, getOperationsConsoleData } from "../services/console.service.js";

export async function registerConsoleRoutes(server: FastifyInstance): Promise<void> {
  server.get("/api/development/console", async () => getDevelopmentConsoleData());
  server.get("/api/operations/console", async () => getOperationsConsoleData());
}
