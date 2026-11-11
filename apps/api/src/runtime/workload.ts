import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { ApiError } from '../http/apiError.js';
import { limitSetting } from './limits.js';
import { TaskScheduler } from './scheduler.js';
import { getUsageStatus, reserveAiAttempt, recordAiOutcome } from './usage.js';

const context = new AsyncLocalStorage<{ signal: AbortSignal; deviceId: string; priority: number; deadlineAt?: number; workId?: string }>();
const activeVoiceWork = new Map<string, AbortSignal>();
const voice = new TaskScheduler({ concurrency: limitSetting('VOICE_CONCURRENCY', 16), maxWaiting: limitSetting('VOICE_QUEUE_LENGTH', 4, 0), maxWaitMs: limitSetting('VOICE_QUEUE_WAIT_MS', 500) });
const stages = Object.fromEntries(['ASR', 'LLM', 'TTS'].map((stage) => [stage, new TaskScheduler({
  concurrency: limitSetting(`${stage}_CONCURRENCY`, 16), maxWaiting: limitSetting('AI_STAGE_QUEUE_LENGTH', 4, 0),
  maxWaitMs: limitSetting('AI_STAGE_QUEUE_WAIT_MS', 500), perKeyWaiting: 2,
})])) as Record<'ASR' | 'LLM' | 'TTS', TaskScheduler>;

export function currentWorkSignal(): AbortSignal | undefined { return context.getStore()?.signal; }
export function currentWorkDeadline(): number | undefined { return context.getStore()?.deadlineAt; }
export function currentWorkId(): string | undefined { return context.getStore()?.workId; }
export function isVoiceWorkActive(id: string): boolean { const signal = activeVoiceWork.get(id); return !!signal && !signal.aborted; }
export function assertWorkActive(): void { currentWorkSignal()?.throwIfAborted(); }

export function withWorkContext<T>(key: string, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  return context.run({ deviceId: key, priority: 0, signal }, operation);
}

export function runVoiceWork<T>(deviceId: string, operation: () => Promise<T>, options: { priority?: number; signal?: AbortSignal } = {}): Promise<T> {
  const parent = currentWorkSignal();
  const external = options.signal && parent ? AbortSignal.any([options.signal, parent]) : options.signal ?? parent;
  const priority = options.priority ?? 1;
  // Admission wait consumes the same budget as ASR, LLM and TTS execution.
  const timeoutMs = limitSetting('VOICE_TASK_TIMEOUT_MS', 10000, 100);
  const deadlineAt = Date.now() + timeoutMs;
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = external ? AbortSignal.any([external, deadline]) : deadline;
  return voice.run(deviceId, async () => {
    const workId = randomUUID();
    activeVoiceWork.set(workId, signal);
    // Keep the slot until the operation settles. A timed-out provider must never
    // continue unaccounted in the background or submit a late device command.
    return context.run({ deviceId, priority, signal, deadlineAt, workId }, async () => {
      try {
        signal.throwIfAborted();
        const value = await operation();
        signal.throwIfAborted();
        return value;
      } catch (error) { throw signal.aborted ? abortError(signal) : error; }
      finally { activeVoiceWork.delete(workId); }
    });
  }, { priority, signal }).catch((error) => { throw signal.aborted ? abortError(signal) : error; });
}

function abortError(signal: AbortSignal): ApiError {
  return signal.reason?.name === 'TimeoutError'
    ? new ApiError(504, 'VOICE_TASK_TIMEOUT', '语音处理超时，请重新发起')
    : new ApiError(409, 'VOICE_TASK_CANCELLED', '本次语音处理已停止');
}

export function runAiWork<T>(stage: 'ASR' | 'LLM' | 'TTS', operation: () => Promise<T>): Promise<T> {
  const scope = context.getStore();
  return stages[stage].run(scope?.deviceId ?? randomUUID(), async () => {
    assertWorkActive();
    await reserveAiAttempt(stage);
    const date = new Date().toISOString().slice(0, 10);
    const stageDeadline = AbortSignal.timeout(limitSetting('AI_STAGE_TIMEOUT_MS', 10000, 100));
    const signal = scope ? AbortSignal.any([scope.signal, stageDeadline]) : stageDeadline;
    let cost = 0;
    let failed = false;
    try {
      signal.throwIfAborted();
      const value = await context.run({ ...scope, deviceId: scope?.deviceId ?? randomUUID(), priority: scope?.priority ?? 0, signal }, operation);
      const result = value as { costCny?: number; usage?: { costCny?: number }; status?: string };
      cost = result?.costCny ?? result?.usage?.costCny ?? 0;
      failed = result?.status === 'FAILED' || result?.status === 'NOT_CONFIGURED';
      signal.throwIfAborted();
      return value;
    } catch (error) { failed = true; throw signal.aborted ? abortError(signal) : error; }
    finally { await recordAiOutcome(date, cost, failed); }
  }, { priority: scope?.priority ?? 0, signal: scope?.signal });
}

export function getWorkloadStatus() {
  return { voice: voice.snapshot(), stages: Object.fromEntries(Object.entries(stages).map(([key, value]) => [key, value.snapshot()])),
    usage: getUsageStatus() };
}
