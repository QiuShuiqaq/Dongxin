import { ApiError } from '../http/apiError.js';

interface Job {
  key: string;
  priority: number;
  start: () => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  cancel: () => void;
}

/** Bounded admission, FIFO per key, priority between keys, one active operation per key. */
export class TaskScheduler {
  private active = 0;
  private keys = new Set<string>();
  private waiting: Job[] = [];
  private counts = { completed: 0, failed: 0, rejected: 0, expired: 0, cancelled: 0, waitTotalMs: 0 };
  constructor(readonly options: { concurrency: number; maxWaiting: number; maxWaitMs: number; perKeyWaiting?: number }) {
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1 ||
        !Number.isInteger(options.maxWaiting) || options.maxWaiting < 0 ||
        !Number.isInteger(options.maxWaitMs) || options.maxWaitMs < 1 ||
        (options.perKeyWaiting !== undefined && (!Number.isInteger(options.perKeyWaiting) || options.perKeyWaiting < 1))) {
      throw new Error('Invalid scheduler limits');
    }
  }

  run<T>(key: string, operation: () => Promise<T>, options: { priority?: number; signal?: AbortSignal } = {}): Promise<T> {
    if (options.signal?.aborted) return Promise.reject(options.signal.reason);
    const queuedAt = Date.now();
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active++;
        this.keys.add(key);
        this.counts.waitTotalMs += Date.now() - queuedAt;
        Promise.resolve().then(() => {
          options.signal?.throwIfAborted();
          return operation();
        }).then((value) => { this.counts.completed++; resolve(value); }, (error) => {
          this.counts.failed++; reject(error);
        }).finally(() => { this.active--; this.keys.delete(key); this.drain(); });
      };
      // Existing waiters may all be blocked by their own active key. Do not
      // reject an unrelated device while a concurrency slot is available.
      if (this.active < this.options.concurrency && !this.keys.has(key)) {
        start();
        return;
      }
      if (this.waiting.length >= this.options.maxWaiting ||
          this.waiting.filter((job) => job.key === key).length >= (this.options.perKeyWaiting ?? 1)) {
        this.counts.rejected++;
        reject(new ApiError(429, 'SERVICE_BUSY', '服务繁忙，请稍后再试'));
        return;
      }
      const remove = (reason: unknown) => {
        const index = this.waiting.indexOf(job);
        if (index < 0) return;
        this.waiting.splice(index, 1);
        clearTimeout(job.timer);
        job.signal?.removeEventListener('abort', job.cancel);
        reject(reason);
        this.drain();
      };
      const job: Job = {
        key, priority: options.priority ?? 0, start, reject, signal: options.signal,
        cancel: () => { this.counts.cancelled++; remove(options.signal?.reason ?? new Error('Cancelled')); },
        timer: setTimeout(() => {
          this.counts.expired++;
          remove(new ApiError(429, 'QUEUE_WAIT_EXPIRED', '等待超时，请重新发起请求'));
        }, this.options.maxWaitMs),
      };
      options.signal?.addEventListener('abort', job.cancel, { once: true });
      this.waiting.push(job);
      this.drain();
    });
  }

  snapshot() { return { active: this.active, waiting: this.waiting.length, limits: this.options, ...this.counts }; }

  private drain(): void {
    while (this.active < this.options.concurrency) {
      let selected = -1;
      const seenKeys = new Set<string>();
      for (let i = 0; i < this.waiting.length; i++) {
        const key = this.waiting[i].key;
        // Priority must never reorder reports/results from the same device.
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        if (!this.keys.has(key) &&
            (selected < 0 || this.waiting[i].priority > this.waiting[selected].priority)) selected = i;
      }
      if (selected < 0) break;
      const [job] = this.waiting.splice(selected, 1);
      clearTimeout(job.timer);
      job.signal?.removeEventListener('abort', job.cancel);
      if (job.signal?.aborted) job.reject(job.signal.reason);
      else job.start();
    }
  }
}
