import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../http/apiError.js";
import { getDevice } from "./deviceRegistry.service.js";
import { publishAudioTestControl } from "./mqttGateway.service.js";
import { synthesizeSpeech } from "./speech.service.js";
import { runLlmModuleTest } from "./voicePipeline.service.js";

const LlmTestSchema = z.object({
  deviceId: z.string().min(1),
  text: z.string().trim().min(1).max(500),
  providerId: z.string().min(1).optional(),
  promptId: z.string().min(1).optional(),
});
const TtsTestSchema = z.object({
  deviceId: z.string().min(1).optional(),
  text: z.string().trim().min(1).max(100),
  providerId: z.string().min(1).optional(),
  target: z.enum(["BROWSER", "DEVICE"]).default("BROWSER"),
  volumePercent: z.number().int().min(5).max(80).default(20),
});
const AudioStatusSchema = z.object({
  deviceId: z.string().min(1),
  testId: z.string().uuid(),
  status: z.enum(["PLAYING", "COMPLETED", "CANCELLED", "FAILED"]),
  message: z.string().default(""),
});

export type AudioTestStatus =
  | "GENERATING"
  | "COMMAND_SENT"
  | "PLAYING"
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
  createdAt: string;
  updatedAt: string;
}

const audioRecords = new Map<string, AudioTestRecord>();
const pcmAssets = new Map<string, Buffer>();
const AUDIO_ASSET_TTL_MS = 10 * 60 * 1000;
const DEVICE_RESPONSE_TIMEOUT_MS = 15 * 1000;

export async function testLlm(requestBody: unknown) {
  return runLlmModuleTest(LlmTestSchema.parse(requestBody));
}

export async function testTts(requestBody: unknown) {
  const body = TtsTestSchema.parse(requestBody);
  if (body.target === "BROWSER") {
    const result = await synthesizeSpeech({
      text: body.text,
      providerId: body.providerId,
      audioFormat: "wav",
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
  const activeTest = [...audioRecords.values()].find(
    (record) =>
      record.deviceId === body.deviceId &&
      ["GENERATING", "COMMAND_SENT", "PLAYING"].includes(record.status),
  );
  if (activeTest) {
    throw new ApiError(409, "AUDIO_TEST_ALREADY_ACTIVE", "该开发板已有语音正在等待或播放，请先停止");
  }
  const device = await getDevice(body.deviceId);
  if (device.status !== "ONLINE" || device.capabilities?.audioPlayback !== true) {
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
  });
  if (result.status !== "COMPLETED" || !result.audioBase64) {
    throw new ApiError(503, "TTS_FAILED", result.error || "TTS 未返回 WAV 音频");
  }
  const pcm = convertWavToPcm16Mono(Buffer.from(result.audioBase64, "base64"), 16000, 0.28);
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
    createdAt: now,
    updatedAt: now,
  };
  pruneAudioTests();
  audioRecords.set(record.id, record);
  pcmAssets.set(record.id, pcm);
  try {
    await publishAudioTestControl({
      deviceId: body.deviceId,
      testId: record.id,
      action: "play",
      audioPath: `/api/device/v1/audio-tests/${record.id}/pcm`,
      volumePercent: record.volumePercent,
    });
    patchRecord(record.id, "COMMAND_SENT", "播放命令已发送，等待开发板响应");
    return audioRecords.get(record.id);
  } catch (error) {
    patchRecord(record.id, "FAILED", errorMessage(error));
    throw new ApiError(503, "AUDIO_TEST_DELIVERY_FAILED", "无法向开发板发送播放命令");
  }
}

export function getAudioTest(testId: string): AudioTestRecord {
  expireAudioTests();
  const record = audioRecords.get(z.string().uuid().parse(testId));
  if (!record) throw new ApiError(404, "AUDIO_TEST_NOT_FOUND", "设备语音播放测试不存在或已过期");
  return record;
}

export function getAudioTestPcm(testId: string): Buffer {
  getAudioTest(testId);
  const pcm = pcmAssets.get(testId);
  if (!pcm) throw new ApiError(410, "AUDIO_TEST_PCM_EXPIRED", "测试音频已过期，请重新生成");
  return pcm;
}

export async function stopAudioTest(testId: string): Promise<AudioTestRecord> {
  const record = getAudioTest(testId);
  if (["COMPLETED", "CANCELLED", "FAILED"].includes(record.status)) return record;
  await publishAudioTestControl({
    deviceId: record.deviceId,
    testId: record.id,
    action: "stop",
  });
  patchRecord(record.id, "CANCELLED", "停止命令已发送");
  return getAudioTest(record.id);
}

export function handleAudioTestDeviceStatus(requestBody: unknown): AudioTestRecord | null {
  const body = AudioStatusSchema.parse(requestBody);
  const record = audioRecords.get(body.testId);
  if (!record || record.deviceId !== body.deviceId) return record ?? null;
  patchRecord(body.testId, body.status, body.message || audioStatusMessage(body.status));
  if (["COMPLETED", "CANCELLED", "FAILED"].includes(body.status)) pcmAssets.delete(body.testId);
  return getAudioTest(body.testId);
}

function patchRecord(id: string, status: AudioTestStatus, message: string): void {
  const current = audioRecords.get(id);
  if (!current) return;
  audioRecords.set(id, { ...current, status, message, updatedAt: new Date().toISOString() });
}

function pruneAudioTests(): void {
  expireAudioTests();
  const expiredBefore = Date.now() - AUDIO_ASSET_TTL_MS;
  for (const [id, record] of audioRecords) {
    if (new Date(record.updatedAt).getTime() < expiredBefore || audioRecords.size >= 30) {
      audioRecords.delete(id);
      pcmAssets.delete(id);
    }
  }
}

function expireAudioTests(): void {
  const now = Date.now();
  for (const [id, record] of audioRecords) {
    const idleMs = now - new Date(record.updatedAt).getTime();
    if (record.status === "COMMAND_SENT" && idleMs > DEVICE_RESPONSE_TIMEOUT_MS) {
      patchRecord(id, "FAILED", "开发板未在 15 秒内响应播放命令，请确认固件版本和 MQTT 连接");
      pcmAssets.delete(id);
      continue;
    }
    const playbackTimeoutMs = Math.max(record.durationMs + 10_000, 20_000);
    if (record.status === "PLAYING" && idleMs > playbackTimeoutMs) {
      patchRecord(id, "FAILED", "开发板播放状态超时，功放已按异常流程关闭");
      pcmAssets.delete(id);
    }
  }
}

function convertWavToPcm16Mono(wav: Buffer, outputRate: number, gain: number): Buffer {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new ApiError(502, "TTS_FORMAT_UNSUPPORTED", "TTS 未返回 PCM WAV 音频");
  }
  let offset = 12;
  let format: { encoding: number; channels: number; sampleRate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      format = {
        encoding: wav.readUInt16LE(start),
        channels: wav.readUInt16LE(start + 2),
        sampleRate: wav.readUInt32LE(start + 4),
        bits: wav.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      data = wav.subarray(start, start + size);
    }
    offset = start + size + (size % 2);
  }
  if (!format || !data || format.encoding !== 1 || format.bits !== 16 || format.channels < 1) {
    throw new ApiError(502, "TTS_FORMAT_UNSUPPORTED", "仅支持 16-bit PCM WAV 音频");
  }
  const frameCount = Math.floor(data.length / (format.channels * 2));
  const mono = new Int16Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel += 1) {
      sum += data.readInt16LE((frame * format.channels + channel) * 2);
    }
    mono[frame] = Math.round(sum / format.channels);
  }
  const outputLength = Math.max(1, Math.round((mono.length * outputRate) / format.sampleRate));
  const output = Buffer.alloc((outputLength + 1280) * 2);
  for (let index = 0; index < outputLength; index += 1) {
    const position = (index * format.sampleRate) / outputRate;
    const left = Math.floor(position);
    const right = Math.min(left + 1, mono.length - 1);
    const fraction = position - left;
    const sample = Math.round((mono[left] * (1 - fraction) + mono[right] * fraction) * gain);
    output.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), (index + 640) * 2);
  }
  return output;
}

function audioStatusMessage(status: string): string {
  return ({ PLAYING: "开发板正在播放", COMPLETED: "开发板播放完成", CANCELLED: "播放已停止", FAILED: "开发板播放失败" } as Record<string, string>)[status] || status;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
