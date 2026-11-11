import { limitSetting } from './limits.js';

export class TtsCache<T extends { audioBase64: string | null }> {
  private entries = new Map<string, { value: T; bytes: number; expiresAt: number }>();
  private bytes = 0;
  private hits = 0;
  constructor(private maxBytes: number, private ttlMs: number, private now = Date.now) {}

  get(key: string): T | undefined {
    this.prune();
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits++;
    return { ...entry.value };
  }

  set(key: string, value: T): void {
    this.prune();
    const bytes = Buffer.byteLength(value.audioBase64 ?? '', 'utf8');
    if (!bytes || bytes > Math.min(this.maxBytes, 512 * 1024)) return;
    this.remove(key);
    while (this.bytes + bytes > this.maxBytes || this.entries.size >= 64) this.remove(this.entries.keys().next().value!);
    this.entries.set(key, { value: { ...value }, bytes, expiresAt: this.now() + this.ttlMs });
    this.bytes += bytes;
  }

  snapshot() { this.prune(); return { entries: this.entries.size, bytes: this.bytes, maxBytes: this.maxBytes, hits: this.hits, ttlMs: this.ttlMs }; }
  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(key); }
  }
  private prune() {
    for (const [key, entry] of this.entries) if (entry.expiresAt <= this.now()) this.remove(key);
  }
}

// Short replies only, memory only. No raw microphone audio is cached.
export const speechCache = new TtsCache<import('../services/speech.service.js').SpeechResult>(
  limitSetting('TTS_CACHE_MAX_BYTES', 8 * 1024 * 1024, 0, 64 * 1024 * 1024),
  limitSetting('TTS_CACHE_TTL_MS', 15 * 60 * 1000, 1, 60 * 60 * 1000),
);
