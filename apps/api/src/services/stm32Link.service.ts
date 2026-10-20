import type { DeviceEvent } from "@dongxin/shared";
import { z } from "zod";
import {
  appendDeviceEvent,
  listDeviceEvents,
} from "../repositories/system.repository.js";
import { getDevice } from "./deviceRegistry.service.js";

const Stm32LinkReportSchema = z.object({
  deviceId: z.string().min(1),
  direction: z.enum(["RX", "TX"]),
  eventType: z.enum([
    "STATUS",
    "NETWORK_STATUS_REQUEST",
    "COMMAND",
    "COMMAND_ACK",
    "COMMAND_ACK_MISMATCH",
    "COMMAND_TIMEOUT",
    "FRAME_REJECTED",
  ]),
  valid: z.boolean(),
  result: z.string(),
  frame: z.string(),
  command: z.number().int().min(0).max(255).optional(),
  value: z.number().int().min(0).max(255).optional(),
  rejectedFrames: z.number().int().nonnegative().default(0),
  discardedBytes: z.number().int().nonnegative().default(0),
  state: z
    .object({
      temperatureCelsius: z.number(),
      remainingMinutes: z.number().int().nonnegative(),
      light: z.boolean(),
      ventilation: z.boolean(),
      fan: z.boolean(),
      heater: z.enum(["off", "weak", "strong"]),
      swing: z.boolean(),
      dry: z.boolean(),
      networkControlEnabled: z.boolean(),
    })
    .optional(),
});

export type Stm32LinkReport = z.infer<typeof Stm32LinkReportSchema>;

export async function handleStm32LinkReport(input: unknown): Promise<DeviceEvent> {
  const report = Stm32LinkReportSchema.parse(input);
  await getDevice(report.deviceId);
  return appendDeviceEvent({
    deviceId: report.deviceId,
    type: "PROTOCOL_TRACE",
    payload: report,
  });
}

export async function listStm32LinkEvents(
  deviceId: string,
  limit = 100,
): Promise<DeviceEvent[]> {
  await getDevice(deviceId);
  const events = await listDeviceEvents();
  return events
    .filter(
      (event) =>
        event.deviceId === deviceId && event.type === "PROTOCOL_TRACE",
    )
    .slice(-limit)
    .reverse();
}
