import type {
  DeviceCommandRecord,
  VoicePipelineResponse,
  VoiceTestSession,
} from "@dongxin/shared";
import { VoiceTestSessionStatusSchema } from "@dongxin/shared";
import { z } from "zod";
import { ApiError } from "../http/apiError.js";
import {
  createVoiceTestSessionRecord,
  listVoiceTestSessions,
  patchVoiceTestSession,
} from "../repositories/voiceTest.repository.js";
import { listDeviceCommands } from "../repositories/system.repository.js";
import { getDevice } from "./deviceRegistry.service.js";
import {
  getMqttGatewayStatus,
  publishVoiceTestControl,
} from "./mqttGateway.service.js";
import {
  addAsrDatasetItem,
  listAsrDatasets,
} from "./aiTesting.service.js";

const RECORD_SECONDS = 6;
const StartVoiceTestSchema = z
  .object({
    deviceId: z.string().min(1),
    mode: z
      .enum(["FULL_PIPELINE", "ASR_ONLY", "CI_WAKE_ONLINE_FALLBACK"])
      .default("FULL_PIPELINE"),
    asrDatasetId: z.string().uuid().optional(),
    expectedText: z.string().trim().min(1).max(500).optional(),
  })
  .superRefine((value, context) => {
    const hasDataset = Boolean(value.asrDatasetId);
    const hasExpectedText = Boolean(value.expectedText);
    if (hasDataset !== hasExpectedText) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "归档实板录音时必须同时提供ASR测试集和期望文字",
      });
    }
    if (hasDataset && value.mode !== "ASR_ONLY") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mode"],
        message: "实板录音归档只允许使用ASR独立测试模式",
      });
    }
  });
const VoiceTestDeviceStatusSchema = z.object({
  deviceId: z.string().min(1),
  testSessionId: z.string().uuid(),
  status: VoiceTestSessionStatusSchema.extract([
    "RECORDING",
    "UPLOADING",
    "PROCESSING",
    "COMPLETED",
    "CANCELLED",
    "FAILED",
  ]),
  message: z.string().default(""),
});

const terminalStatuses = new Set<VoiceTestSession["status"]>([
  "COMPLETED",
  "CANCELLED",
  "FAILED",
]);

export async function startVoiceTest(requestBody: unknown): Promise<VoiceTestSession> {
  const body = StartVoiceTestSchema.parse(requestBody);
  const device = await getDevice(body.deviceId);
  if (device.protocol !== "MQTT" || device.status !== "ONLINE") {
    throw new ApiError(409, "VOICE_TEST_DEVICE_OFFLINE", "所选设备当前不在线，无法开始语音测试");
  }
  if (!device.model.includes("LICHUANG-AUDIO")) {
    throw new ApiError(409, "VOICE_TEST_UNSUPPORTED", "当前仅立创 ESP32-C3 音频开发板支持网页语音测试");
  }
  if (!getMqttGatewayStatus().connected) {
    throw new ApiError(503, "MQTT_GATEWAY_OFFLINE", "MQTT 网关未连接");
  }
  if (body.asrDatasetId) {
    const datasetExists = (await listAsrDatasets())
      .some((dataset) => dataset.id === body.asrDatasetId);
    if (!datasetExists) {
      throw new ApiError(404, "ASR_DATASET_NOT_FOUND", "ASR 测试集不存在");
    }
  }

  const current = (await getVoiceTestSessions(body.deviceId))
    .find((session) => !terminalStatuses.has(session.status));
  if (current) {
    throw new ApiError(409, "VOICE_TEST_ALREADY_RUNNING", "该设备已有正在进行的语音测试");
  }

  const session = await createVoiceTestSessionRecord({
    deviceId: body.deviceId,
    recordSeconds: RECORD_SECONDS,
    mode: body.mode,
    asrDatasetId: body.asrDatasetId ?? null,
    expectedText: body.expectedText ?? null,
  });
  try {
    await publishVoiceTestControl({
      deviceId: body.deviceId,
      testSessionId: session.id,
      action: "start",
      recordSeconds: RECORD_SECONDS,
      mode: body.mode,
    });
    return (await patchVoiceTestSession(session.id, {
      status: "COMMAND_SENT",
      message:
        body.mode === "CI_WAKE_ONLINE_FALLBACK"
          ? "已模拟CI唤醒事件，等待设备采集后续命令"
          : "开始命令已发送，等待设备打开麦克风",
    })) as VoiceTestSession;
  } catch (error) {
    await patchVoiceTestSession(session.id, {
      status: "FAILED",
      message: `开始命令发送失败：${errorMessage(error)}`,
      completedAt: new Date().toISOString(),
    });
    throw new ApiError(503, "VOICE_TEST_DELIVERY_FAILED", "语音测试命令发送失败");
  }
}

export async function archiveVoiceTestPcm(
  sessionId: string,
  wav: Buffer,
): Promise<void> {
  const session = await requireVoiceTestSession(sessionId);
  if (!session.asrDatasetId || !session.expectedText) return;
  if (session.mode !== "ASR_ONLY") {
    throw new ApiError(409, "VOICE_CAPTURE_MODE_INVALID", "只有ASR独立测试可以归档录音");
  }
  if (session.capturedDatasetItemId) return;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dataset = await addAsrDatasetItem(session.asrDatasetId, {
    fileName: `c3-board-${timestamp}.wav`,
    expectedText: session.expectedText,
    mimeType: "audio/wav",
    audioBase64: wav.toString("base64"),
  });
  const item = dataset.items[dataset.items.length - 1];
  if (!item) {
    throw new Error("ASR录音归档后未返回数据项");
  }
  await patchVoiceTestSession(session.id, {
    capturedDatasetItemId: item.id,
    message: "实板录音已归档，正在执行ASR识别",
  });
}

export async function stopVoiceTest(sessionId: string): Promise<VoiceTestSession> {
  const session = await requireVoiceTestSession(sessionId);
  if (terminalStatuses.has(session.status) || session.status === "PROCESSING") {
    return hydrateCommandRecord(session);
  }
  await patchVoiceTestSession(session.id, {
    status: "STOPPING",
    message: "停止命令已发送，等待设备取消录音",
  });
  try {
    await publishVoiceTestControl({
      deviceId: session.deviceId,
      testSessionId: session.id,
      action: "stop",
      recordSeconds: session.recordSeconds,
      mode: session.mode,
    });
  } catch (error) {
    const failed = await patchVoiceTestSession(session.id, {
      status: "FAILED",
      message: `停止命令发送失败：${errorMessage(error)}`,
      completedAt: new Date().toISOString(),
    });
    return failed as VoiceTestSession;
  }
  return requireVoiceTestSession(session.id);
}

export async function getVoiceTestSession(sessionId: string): Promise<VoiceTestSession> {
  return hydrateCommandRecord(await expireStaleSession(await requireVoiceTestSession(sessionId)));
}

export async function getVoiceTestSessions(deviceId?: string): Promise<VoiceTestSession[]> {
  const sessions = (await listVoiceTestSessions())
    .filter((session) => !deviceId || session.deviceId === deviceId)
    .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
  return Promise.all(sessions.slice(0, 20).map(async (session) =>
    hydrateCommandRecord(await expireStaleSession(session))
  ));
}

export async function handleVoiceTestDeviceStatus(requestBody: unknown): Promise<VoiceTestSession | null> {
  const body = VoiceTestDeviceStatusSchema.parse(requestBody);
  const session = (await listVoiceTestSessions()).find((item) => item.id === body.testSessionId);
  if (!session || session.deviceId !== body.deviceId || terminalStatuses.has(session.status)) {
    return session ?? null;
  }
  const now = new Date().toISOString();
  return patchVoiceTestSession(session.id, {
    status: body.status,
    message: body.status === "FAILED" && body.message
      ? body.message
      : deviceStatusMessage(body.status),
    startedAt: body.status === "RECORDING" ? session.startedAt ?? now : session.startedAt,
    completedAt: terminalStatuses.has(body.status) ? now : null,
  });
}

export async function markVoiceTestProcessing(sessionId: string): Promise<void> {
  const session = await requireVoiceTestSession(sessionId);
  if (terminalStatuses.has(session.status)) return;
  await patchVoiceTestSession(session.id, {
    status: "PROCESSING",
    message: "音频上传完成，正在执行 ASR 与语义处理",
    startedAt: session.startedAt ?? new Date().toISOString(),
  });
}

export async function completeVoiceTest(
  sessionId: string,
  result: VoicePipelineResponse,
): Promise<void> {
  const session = await requireVoiceTestSession(sessionId);
  if (session.status === "CANCELLED" || session.status === "FAILED") return;
  await patchVoiceTestSession(session.id, {
    status: "COMPLETED",
    message: "语音流水线处理完成",
    result,
    completedAt: new Date().toISOString(),
  });
}

export async function failVoiceTest(sessionId: string, error: unknown): Promise<void> {
  const session = await requireVoiceTestSession(sessionId);
  if (session.status === "CANCELLED") return;
  await patchVoiceTestSession(session.id, {
    status: "FAILED",
    message: `语音处理失败：${errorMessage(error)}`,
    completedAt: new Date().toISOString(),
  });
}

async function requireVoiceTestSession(sessionId: string): Promise<VoiceTestSession> {
  const parsedId = z.string().uuid().parse(sessionId);
  const session = (await listVoiceTestSessions()).find((item) => item.id === parsedId);
  if (!session) {
    throw new ApiError(404, "VOICE_TEST_NOT_FOUND", "语音测试会话不存在");
  }
  return session;
}

async function hydrateCommandRecord(session: VoiceTestSession): Promise<VoiceTestSession> {
  const commandId = session.result?.commandRecord?.id;
  if (!commandId || !session.result) return session;
  const command = (await listDeviceCommands()).find((item) => item.id === commandId);
  if (!command) return session;
  return {
    ...session,
    result: {
      ...session.result,
      commandRecord: command as DeviceCommandRecord,
    },
  };
}

async function expireStaleSession(session: VoiceTestSession): Promise<VoiceTestSession> {
  if (terminalStatuses.has(session.status)) return session;
  const ageMs = Date.now() - new Date(session.updatedAt).getTime();
  const timeoutMs = session.status === "COMMAND_SENT" || session.status === "STOPPING"
    ? 15_000
    : 60_000;
  if (ageMs <= timeoutMs) return session;
  return (await patchVoiceTestSession(session.id, {
    status: "FAILED",
    message: session.status === "COMMAND_SENT"
      ? "设备未响应开始命令，请确认固件版本和 MQTT 连接"
      : "语音测试超时，请检查设备串口和 API 日志",
    completedAt: new Date().toISOString(),
  })) as VoiceTestSession;
}

function deviceStatusMessage(status: VoiceTestSession["status"]): string {
  const messages: Partial<Record<VoiceTestSession["status"], string>> = {
    RECORDING: "设备正在录音",
    UPLOADING: "录音完成，正在上传 PCM",
    PROCESSING: "服务器正在处理语音",
    COMPLETED: "设备端测试完成",
    CANCELLED: "测试已停止",
    FAILED: "设备端测试失败",
  };
  return messages[status] ?? status;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
