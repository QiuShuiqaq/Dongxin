import { ApiError } from '../http/apiError.js';

/** Shares identical in-flight work; no response/audio remains after settlement. */
export class SingleFlight {
  private jobs = new Map<string, { fingerprint: string; promise: Promise<unknown> }>();
  private reused = 0;
  constructor(private maxJobs = 128) {}

  run<T>(key: string, fingerprint: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.jobs.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) return Promise.reject(new ApiError(409, 'REQUEST_ID_CONFLICT', '请求编号已用于其他内容'));
      this.reused++;
      return existing.promise as Promise<T>;
    }
    if (this.jobs.size >= this.maxJobs) return Promise.reject(new ApiError(429, 'SERVICE_BUSY', '服务繁忙，请稍后重试'));
    const promise = Promise.resolve().then(operation).finally(() => this.jobs.delete(key));
    this.jobs.set(key, { fingerprint, promise });
    return promise;
  }
  snapshot() { return { active: this.jobs.size, reused: this.reused, limit: this.maxJobs }; }
}
