import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listStm32LinkEvents } from "../services/stm32Link.service.js";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function registerStm32LinkRoutes(
  server: FastifyInstance,
): Promise<void> {
  server.get("/api/development/stm32-link/:deviceId", async (request) => {
    const { deviceId } = request.params as { deviceId: string };
    const { limit } = QuerySchema.parse(request.query);
    return listStm32LinkEvents(deviceId, limit);
  });
}
