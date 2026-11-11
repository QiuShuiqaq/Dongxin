import { randomUUID } from "node:crypto";
import { ApiError } from "../http/apiError.js";

interface DeviceAudioAsset {
  id: string;
  deviceId: string;
  pcm: Buffer;
  createdAtMs: number;
  expiresAtMs: number;
}

export interface DeviceAudioAssetDescriptor {
  id: string;
  path: string;
  durationMs: number;
  byteLength: number;
  sampleRate: 16000;
  bitsPerSample: 16;
  channels: 1;
}

const assets = new Map<string, DeviceAudioAsset>();
const ASSET_TTL_MS = 10 * 60 * 1000;
const MAX_ASSETS = 30;
const MAX_PCM_BYTES = 512 * 1024;

export function createDeviceVoiceReplyAsset(input: {
  deviceId: string;
  wavBase64: string;
}): DeviceAudioAssetDescriptor {
  pruneAssets();
  const pcm = convertWavToPcm16Mono(
    Buffer.from(input.wavBase64, "base64"),
    16000,
    0.28,
  );
  if (pcm.length > MAX_PCM_BYTES) {
    throw new ApiError(
      502,
      "TTS_AUDIO_TOO_LARGE",
      "TTS 回复超过开发板单次播放上限",
    );
  }

  const id = randomUUID();
  const now = Date.now();
  assets.set(id, {
    id,
    deviceId: input.deviceId,
    pcm,
    createdAtMs: now,
    expiresAtMs: now + ASSET_TTL_MS,
  });

  return {
    id,
    path: `/api/device/v1/voice-replies/${id}/pcm`,
    durationMs: Math.round((pcm.length / 2 / 16000) * 1000),
    byteLength: pcm.length,
    sampleRate: 16000,
    bitsPerSample: 16,
    channels: 1,
  };
}

export function getDeviceVoiceReplyPcm(
  id: string,
  deviceId: string | undefined,
): Buffer {
  pruneAssets();
  const asset = assets.get(id);
  if (!asset) {
    throw new ApiError(
      404,
      "VOICE_REPLY_NOT_FOUND",
      "语音回复不存在或已过期",
    );
  }
  if (!deviceId || asset.deviceId !== deviceId) {
    throw new ApiError(403, "VOICE_REPLY_FORBIDDEN", "设备无权读取该语音回复");
  }
  return asset.pcm;
}

export function convertWavToPcm16Mono(
  wav: Buffer,
  outputRate: number,
  gain: number,
): Buffer {
  if (
    wav.toString("ascii", 0, 4) !== "RIFF" ||
    wav.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new ApiError(
      502,
      "TTS_FORMAT_UNSUPPORTED",
      "TTS 未返回 PCM WAV 音频",
    );
  }

  let offset = 12;
  let format: {
    encoding: number;
    channels: number;
    sampleRate: number;
    bits: number;
  } | null = null;
  let data: Buffer | null = null;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > wav.length) {
      // DashScope streaming WAV uses a near-2GB placeholder for RIFF/data lengths.
      const streamingData =
        id === "data" &&
        offset === 36 &&
        format !== null &&
        size >= 0x7fff0000 &&
        wav.readUInt32LE(4) === size + 36;
      if (!streamingData) {
        throw new ApiError(502, "TTS_WAV_INVALID", "TTS WAV 数据块不完整");
      }
      data = wav.subarray(start);
      break;
    }
    if (id === "fmt " && size >= 16) {
      format = {
        encoding: wav.readUInt16LE(start),
        channels: wav.readUInt16LE(start + 2),
        sampleRate: wav.readUInt32LE(start + 4),
        bits: wav.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      data = wav.subarray(start, end);
    }
    offset = end + (size % 2);
  }
  if (
    !format ||
    !data ||
    format.encoding !== 1 ||
    format.bits !== 16 ||
    format.channels < 1 ||
    format.sampleRate <= 0
  ) {
    throw new ApiError(
      502,
      "TTS_FORMAT_UNSUPPORTED",
      "仅支持 16-bit PCM WAV 音频",
    );
  }

  if (data.length % (format.channels * 2) !== 0) {
    throw new ApiError(502, "TTS_WAV_INVALID", "TTS WAV 数据块不完整");
  }

  const frameCount = Math.floor(data.length / (format.channels * 2));
  if (frameCount < 1) {
    throw new ApiError(502, "TTS_WAV_EMPTY", "TTS WAV 未包含有效采样");
  }
  const mono = new Int16Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel += 1) {
      sum += data.readInt16LE((frame * format.channels + channel) * 2);
    }
    mono[frame] = Math.round(sum / format.channels);
  }

  const outputLength = Math.max(
    1,
    Math.round((mono.length * outputRate) / format.sampleRate),
  );
  const leadingSilenceSamples = 640;
  const trailingSilenceSamples = 640;
  const output = Buffer.alloc(
    (outputLength + leadingSilenceSamples + trailingSilenceSamples) * 2,
  );
  for (let index = 0; index < outputLength; index += 1) {
    const position = (index * format.sampleRate) / outputRate;
    const left = Math.floor(position);
    const right = Math.min(left + 1, mono.length - 1);
    const fraction = position - left;
    const sample = Math.round(
      (mono[left] * (1 - fraction) + mono[right] * fraction) * gain,
    );
    output.writeInt16LE(
      Math.max(-32768, Math.min(32767, sample)),
      (index + leadingSilenceSamples) * 2,
    );
  }
  return output;
}

function pruneAssets(): void {
  const now = Date.now();
  for (const [id, asset] of assets) {
    if (asset.expiresAtMs <= now) assets.delete(id);
  }
  while (assets.size >= MAX_ASSETS) {
    const oldest = [...assets.values()].sort(
      (left, right) => left.createdAtMs - right.createdAtMs,
    )[0];
    if (!oldest) break;
    assets.delete(oldest.id);
  }
}
