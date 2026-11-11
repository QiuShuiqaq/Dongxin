import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../http/apiError.js';
import { getDeviceControlRevision } from '../deviceSimulator.js';
import { limitSetting } from './limits.js';

type Entry = { fingerprint: string; promise: Promise<unknown>; expires: number; bytes: number };

/** Bounded, process-local retry window. Never stores microphone audio. */
export class RequestReplay {
  private entries = new Map<string, Entry>();
  private bytes = 0;
  private reused = 0;
  constructor(private maxEntries = 256, private maxBytes = 4 * 1024 * 1024, private ttlMs = 60_000, private now = Date.now) {}

  run<T>(key: string, fingerprint: string, operation: () => Promise<T>): Promise<T> {
    this.prune();
    const previous = this.entries.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) return Promise.reject(new ApiError(409, 'REQUEST_ID_CONFLICT', '请求编号已用于其他内容'));
      this.reused++;
      return previous.promise as Promise<T>;
    }
    if (this.entries.size >= this.maxEntries) return Promise.reject(new ApiError(429, 'SERVICE_BUSY', '请求重试窗口已满，请稍后再试'));
    const entry: Entry = { fingerprint, expires: Infinity, bytes: 0, promise: Promise.resolve() };
    entry.promise = Promise.resolve().then(operation).then((value) => {
      const bytes = Buffer.byteLength(JSON.stringify(value) ?? 'null');
      // Responses with inline audio are shared in flight only.
      if (bytes > 128 * 1024 || this.bytes + bytes > this.maxBytes) this.entries.delete(key);
      else { entry.bytes = bytes; this.bytes += bytes; entry.expires = this.now() + this.ttlMs; }
      return value;
    }, (error) => { this.entries.delete(key); throw error; });
    this.entries.set(key, entry);
    return entry.promise as Promise<T>;
  }
  snapshot() { this.prune(); return { entries: this.entries.size, bytes: this.bytes, reused: this.reused, ttlMs: this.ttlMs }; }
  private prune() {
    for (const [key, entry] of this.entries) if (entry.expires <= this.now()) { this.bytes -= entry.bytes; this.entries.delete(key); }
  }
}

export const voiceRequestReplay = new RequestReplay();
export async function replayDeviceVoice<T>(request: FastifyRequest, operation: () => Promise<T>): Promise<T> {
  const id = request.headers['x-request-id'];
  if (id === undefined) return operation();
  if (typeof id !== 'string' || !id.trim() || id.length > 128) throw new ApiError(422, 'INVALID_REQUEST_ID', '请求编号格式无效');
  const deviceId = request.headers['x-device-id'] ?? (request.body as { deviceId?: string })?.deviceId ?? (request.query as { deviceId?: string })?.deviceId;
  if (!deviceId) return operation();
  const body = Buffer.isBuffer(request.body) ? request.body : JSON.stringify(request.body ?? null);
  const fingerprint = createHash('sha256').update(request.url).update(String(request.headers['x-voice-test-session-id'] ?? '')).update(body).digest('hex');
  // A retry may refresh its authentication timestamp. Identity + request ID
  // must still refer to the same operation within the retry window.
  const result = await voiceRequestReplay.run(JSON.stringify([deviceId, id]), fingerprint, async () => {
    const revision = getDeviceControlRevision(String(deviceId));
    const expiresAt = Date.now() + limitSetting('VOICE_TASK_TIMEOUT_MS', 10000, 100);
    return { value: await operation(), revision, expiresAt };
  });
  // Reusing a successful response must not resurrect an older action after a
  // local operation or its delivery deadline. Ordinary chat stays reusable.
  if (hasDirectActions(result.value) &&
      (result.revision !== getDeviceControlRevision(String(deviceId)) || Date.now() >= result.expiresAt)) {
    throw new ApiError(409, 'STALE_VOICE_COMMAND', '设备状态已变化或语音命令已过期，请重新操作');
  }
  return result.value;
}

function hasDirectActions(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const payload = 'data' in value ? value.data : value;
  return !!payload && typeof payload === 'object' && 'actions' in payload &&
    Array.isArray(payload.actions) && payload.actions.length > 0;
}
