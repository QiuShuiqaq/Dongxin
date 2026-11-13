import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../http/apiError.js";
import { convertWavToPcm16Mono } from "./deviceAudioAsset.service.js";
import { getDevice } from "./deviceRegistry.service.js";
import { publishAudioTestControl } from "./mqttGateway.service.js";
import { synthesizeSpeech } from "./speech.service.js";
import { runLlmModuleTest } from "./voicePipeline.service.js";
import {
  clearProactiveConfirmation,
  finishProactivePlayback,
} from "./proactiveConfirmation.service.js";

const LlmTestSchema = z.object({
  deviceId: z.string().min(1),
  text: z.string().trim().min(1).max(500),
  providerId: z.string().min(1).optional(),
  promptId: z.string().min(1).optional(),
  conversationId: z.string().uuid().optional(),
  llmTemperature: z.number().min(0).max(1).optional(),
  llmMaxOutputTokens: z.number().int().min(256).max(2048).optional(),
  llmHistoryTurns: z.number().int().min(0).max(12).optional(),
  knowledgeContext: z.string().trim().min(1).max(3000).optional(),
  deviceStatePatch: z.object({
    isOnline: z.boolean().optional(),
    faultCode: z.string().trim().min(1).max(40).nullable().optional(),
  }).strict().optional(),
});
const TtsTestSchema = z.object({
  deviceId: z.string().min(1).optional(),
  text: z.string().trim().min(1).max(100),
  providerId: z.string().min(1).optional(),
  target: z.enum(["BROWSER", "DEVICE"]).default("BROWSER"),
  voice: z
    .string()
    .regex(/^[a-zA-Z0-9_.-]{1,64}$/)
    .optional(),
  volumePercent: z.number().int().min(5).max(80).default(20),
  listenAfterPlayback: z.boolean().default(false),
});
const AudioStatusSchema = z.object({
  deviceId: z.string().min(1),
  testId: z.string().uuid(),
  status: z.enum(["PLAYING", "LISTENING", "COMPLETED", "CANCELLED", "FAILED"]),
  message: z.string().default(""),
});

export type AudioTestStatus =
  | "GENERATING"
  | "COMMAND_SENT"
  | "PLAYING"
  | "LISTENING"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";

interface AudioTestRecord {
  id: string;
  deviceId: string;
  text: string;
  target: "DEVICE";
  status: AudioTestStatus;
  message: string;
  providerId: string | null;
  providerName: string | null;
  latencyMs: number;
  costCny: number;
  durationMs: number;
  byteLength: number;
  volumePercent: number;
  listenAfterPlayback: boolean;
  createdAt: string;
  updatedAt: string;
}

const audioRecords = new Map<string, AudioTestRecord>();
const pcmAssets = new Map<string, Buffer>();
const audioGenerationLocks = new Set<string>();
const AUDIO_ASSET_TTL_MS = 10 * 60 * 1000;
const DEVICE_RESPONSE_TIMEOUT_MS = 15 * 1000;

export async function testLlm(requestBody: unknown) {
  return runLlmModuleTest(LlmTestSchema.parse(requestBody));
}

export async function testTts(
  requestBody: unknown,
  options: { onCreated?: (id: string) => void } = {},
) {
  const body = TtsTestSchema.parse(requestBody);
  if (body.target === "BROWSER") {
    const result = await synthesizeSpeech({
      text: body.text,
      providerId: body.providerId,
      audioFormat: "wav",
      voice: body.voice,
    });
    if (result.status !== "COMPLETED" || !result.audioBase64) {
      throw new ApiError(503, "TTS_FAILED", result.error || "TTS 未返回音频");
    }
    return { ...result, target: body.target, text: body.text };
  }

  if (!body.deviceId) {
    throw new ApiError(422, "DEVICE_ID_REQUIRED", "播放到开发板时必须选择设备");
  }
  expireAudioTests();
  if (audioGenerationLocks.has(body.deviceId)) {
    throw new ApiError(409, "AUDIO_TEST_ALREADY_ACTIVE", "该设备正在生成音频");
  }
  const activeTest = [...audioRecords.values()].find(
    (record) =>
      record.deviceId === body.deviceId &&
      ["GENERATING", "COMMAND_SENT", "PLAYING", "LISTENING"].includes(
        record.status,
      ),
  );
  if (activeTest) {
    throw new ApiError(
      409,
      "AUDIO_TEST_ALREADY_ACTIVE",
      "该开发板已有语音正在等待或播放，请先停止",
    );
  }
  audioGenerationLocks.add(body.deviceId);
  try {
    const device = await getDevice(body.deviceId);
    if (
      device.status !== "ONLINE" ||
      device.capabilities?.audioPlayback !== true
    ) {
      throw new ApiError(
        409,
        "AUDIO_TEST_DEVICE_UNAVAILABLE",
        "设备未在线或当前固件未上报 audioPlayback 播放能力",
      );
    }
    const result = await synthesizeSpeech({
      text: body.text,
      providerId: body.providerId,
      audioFormat: "wav",
      voice: body.voice,
    });
    if (result.status !== "COMPLETED" || !result.audioBase64) {
      throw new ApiError(
        503,
        "TTS_FAILED",
        result.error || "TTS 未返回 WAV 音频",
      );
    }
    const pcm = convertWavToPcm16Mono(
      Buffer.from(result.audioBase64, "base64"),
      16000,
      0.28,
    );
    const now = new Date().toISOString();
    const record: AudioTestRecord = {
      id: randomUUID(),
      deviceId: body.deviceId,
      text: body.text,
      target: "DEVICE",
      status: "GENERATING",
      message: "TTS 已生成，准备通知开发板",
      providerId: result.providerId,
      providerName: result.providerName,
      latencyMs: result.latencyMs,
      costCny: result.costCny,
      durationMs: Math.round((pcm.length / 2 / 16000) * 1000),
      byteLength: pcm.length,
      volumePercent: body.volumePercent,
      listenAfterPlayback: body.listenAfterPlayback,
      createdAt: now,
      updatedAt: now,
    };
    pruneAudioTests();
    audioRecords.set(record.id, record);
    pcmAssets.set(record.id, pcm);
    try {
      options.onCreated?.(record.id);
      if (audioRecords.get(record.id)?.status === "CANCELLED")
        return audioRecords.get(record.id);
      await publishAudioTestControl({
        deviceId: body.deviceId,
        testId: record.id,
        action: "play",
        audioPath: `/api/device/v1/audio-tests/${record.id}/pcm`,
        volumePercent: record.volumePercent,
        listenAfterPlayback: record.listenAfterPlayback,
      });
      const current = audioRecords.get(record.id);
      if (current?.status === "CANCELLED") {
        // A stop can arrive while MQTT publish is in flight; send it again after play.
        await publishAudioTestControl({
          deviceId: record.deviceId,
          testId: record.id,
          action: "stop",
        });
      } else if (current?.status === "GENERATING") {
        patchRecord(
          record.id,
          "COMMAND_SENT",
          "播放命令已发送，等待开发板响应",
        );
      }
      return audioRecords.get(record.id);
    } catch (error) {
      if (record.listenAfterPlayback)
        finishProactivePlayback(record.deviceId, record.id, false);
      if (audioRecords.get(record.id)?.status !== "CANCELLED")
        patchRecord(record.id, "FAILED", errorMessage(error));
      throw new ApiError(
        503,
        "AUDIO_TEST_DELIVERY_FAILED",
        "无法向开发板发送播放命令",
      );
    }
  } finally {
    audioGenerationLocks.delete(body.deviceId);
  }
}

export function getAudioTest(testId: string): AudioTestRecord {
  expireAudioTests();
  const record = audioRecords.get(z.string().uuid().parse(testId));
  if (!record)
    throw new ApiError(
      404,
      "AUDIO_TEST_NOT_FOUND",
      "设备语音播放测试不存在或已过期",
    );
  return record;
}

export function listDeviceAudioTests(deviceId: string): AudioTestRecord[] {
  expireAudioTests();
  return [...audioRecords.values()]
    .filter((record) => record.deviceId === deviceId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);
}

export function isDeviceAudioBusy(deviceId: string): boolean {
  expireAudioTests();
  return (
    audioGenerationLocks.has(deviceId) ||
    [...audioRecords.values()].some(
      (record) =>
        record.deviceId === deviceId &&
        ["GENERATING", "COMMAND_SENT", "PLAYING", "LISTENING"].includes(
          record.status,
        ),
    )
  );
}

export function getAudioTestPcm(testId: string, deviceId?: string): Buffer {
  const record = getAudioTest(testId);
  if (!deviceId || record.deviceId !== deviceId)
    throw new ApiError(403, "AUDIO_TEST_FORBIDDEN", "设备无权读取该测试音频");
  const pcm = pcmAssets.get(testId);
  if (!pcm)
    throw new ApiError(
      410,
      "AUDIO_TEST_PCM_EXPIRED",
      "测试音频已过期，请重新生成",
    );
  return pcm;
}

export async function stopAudioTest(testId: string): Promise<AudioTestRecord> {
  const record = getAudioTest(testId);
  if (["COMPLETED", "CANCELLED", "FAILED"].includes(record.status))
    return record;
  if (record.listenAfterPlayback) {
    finishProactivePlayback(record.deviceId, record.id, false);
    clearProactiveConfirmation(record.deviceId);
  }
  patchRecord(record.id, "CANCELLED", "正在发送停止命令");
  pcmAssets.delete(record.id);
  try {
    await publishAudioTestControl({
      deviceId: record.deviceId,
      testId: record.id,
      action: "stop",
    });
    patchRecord(record.id, "CANCELLED", "停止命令已发送");
  } catch {
    patchRecord(record.id, "FAILED", "停止命令发送失败，设备可能仍在播放");
    throw new ApiError(
      503,
      "AUDIO_TEST_STOP_FAILED",
      "停止命令未送达设备，请现场确认播放状态",
    );
  }
  return getAudioTest(record.id);
}

export function handleAudioTestDeviceStatus(
  requestBody: unknown,
): AudioTestRecord | null {
  const body = AudioStatusSchema.parse(requestBody);
  const record = audioRecords.get(body.testId);
  if (!record || record.deviceId !== body.deviceId) return null;
  if (["COMPLETED", "CANCELLED", "FAILED"].includes(record.status))
    return record;
  if (body.status === "LISTENING" && !record.listenAfterPlayback) return record;
  if (body.status === "PLAYING" && record.status === "LISTENING") return record;
  patchRecord(
    body.testId,
    body.status,
    body.message || audioStatusMessage(body.status),
  );
  if (record.listenAfterPlayback) {
    if (body.status === "LISTENING")
      finishProactivePlayback(body.deviceId, body.testId, true);
    else if (["COMPLETED", "CANCELLED", "FAILED"].includes(body.status)) {
      finishProactivePlayback(body.deviceId, body.testId, false);
      clearProactiveConfirmation(body.deviceId);
    }
  }
  if (["LISTENING", "COMPLETED", "CANCELLED", "FAILED"].includes(body.status))
    pcmAssets.delete(body.testId);
  return getAudioTest(body.testId);
}

function patchRecord(
  id: string,
  status: AudioTestStatus,
  message: string,
): void {
  const current = audioRecords.get(id);
  if (!current) return;
  audioRecords.set(id, {
    ...current,
    status,
    message,
    updatedAt: new Date().toISOString(),
  });
}

function pruneAudioTests(): void {
  expireAudioTests();
  const expiredBefore = Date.now() - AUDIO_ASSET_TTL_MS;
  for (const [id, record] of audioRecords) {
    if (
      new Date(record.updatedAt).getTime() < expiredBefore ||
      audioRecords.size >= 30
    ) {
      audioRecords.delete(id);
      pcmAssets.delete(id);
    }
  }
}

function expireAudioTests(): void {
  const now = Date.now();
  for (const [id, record] of audioRecords) {
    const idleMs = now - new Date(record.updatedAt).getTime();
    if (
      record.status === "COMMAND_SENT" &&
      idleMs > DEVICE_RESPONSE_TIMEOUT_MS
    ) {
      patchRecord(
        id,
        "FAILED",
        "开发板未在 15 秒内响应播放命令，请确认固件版本和 MQTT 连接",
      );
      if (record.listenAfterPlayback)
        finishProactivePlayback(record.deviceId, id, false);
      pcmAssets.delete(id);
      continue;
    }
    const playbackTimeoutMs = Math.max(record.durationMs + 10_000, 20_000);
    if (record.status === "PLAYING" && idleMs > playbackTimeoutMs) {
      patchRecord(id, "FAILED", "开发板播放状态超时，功放已按异常流程关闭");
      if (record.listenAfterPlayback)
        finishProactivePlayback(record.deviceId, id, false);
      pcmAssets.delete(id);
    }
    if (record.status === "LISTENING" && idleMs > 90_000) {
      patchRecord(id, "FAILED", "回答收音超时，确认窗口已关闭");
      clearProactiveConfirmation(record.deviceId);
    }
  }
}

function audioStatusMessage(status: string): string {
  return (
    (
      {
        PLAYING: "开发板正在播放",
        LISTENING: "开发板正在等待回答",
        COMPLETED: "开发板播放完成",
        CANCELLED: "播放已停止",
        FAILED: "开发板播放失败",
      } as Record<string, string>
    )[status] || status
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
