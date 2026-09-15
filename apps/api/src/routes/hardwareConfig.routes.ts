import type { FastifyInstance } from "fastify";
import { CloneVoiceProfileRequestSchema } from "@dongxin/shared";
import {
  cloneVoiceProfile,
  getHardwareConfig,
  simulateBleLocalControl,
  simulateCi1302Event,
  transitionVoiceProfile,
  updateProductProfile,
  updateVoiceProfile,
} from "../services/hardwareConfig.service.js";

export async function registerHardwareConfigRoutes(
  server: FastifyInstance,
): Promise<void> {
  server.get("/api/hardware-config", async () => getHardwareConfig());

  server.put("/api/product-profiles/:profileId", async (request) => {
    const { profileId } = request.params as { profileId: string };
    return updateProductProfile(profileId, request.body);
  });

  server.put("/api/voice-profiles/:profileId", async (request) => {
    const { profileId } = request.params as { profileId: string };
    return updateVoiceProfile(profileId, request.body);
  });

  server.post("/api/voice-profiles/:profileId/transition", async (request) => {
    const { profileId } = request.params as { profileId: string };
    return transitionVoiceProfile(profileId, request.body);
  });

  server.post("/api/voice-profiles/:profileId/clone", async (request) => {
    const { profileId } = request.params as { profileId: string };
    const body = CloneVoiceProfileRequestSchema.parse(request.body);
    return cloneVoiceProfile(profileId, body.version);
  });

  server.post("/api/hardware-config/ci1302/events/simulate", async (request) =>
    simulateCi1302Event(request.body),
  );

  server.post("/api/hardware-config/ble/commands/simulate", async (request) =>
    simulateBleLocalControl(request.body),
  );
}
