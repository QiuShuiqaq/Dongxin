import { ApiError } from '../http/apiError.js';

export const DEVICE_PCM_BODY_LIMIT = 512 * 1024;
export const DEVICE_PCM_MAX_BYTES = 16_000 * 2 * 13;

export function wrapDevicePcmAsWav(pcm: Buffer): Buffer {
  if (pcm.length === 0 || pcm.length % 2 !== 0) {
    throw new ApiError(422, 'INVALID_PCM_AUDIO', '设备音频必须包含完整的 16-bit PCM 采样');
  }
  if (pcm.length > DEVICE_PCM_MAX_BYTES) {
    throw new ApiError(413, 'PCM_AUDIO_TOO_LONG', '设备单句音频超过 13 秒限制');
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
