import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { TaskScheduler } from './scheduler.js';
import { RequestReplay, replayDeviceVoice } from './requestReplay.js';
import type { FastifyRequest } from 'fastify';
import { SingleFlight } from './singleFlight.js';
import { TtsCache } from './ttsCache.js';
import { retainRecent } from './retention.js';
import { runVoiceWork, currentWorkSignal, assertWorkActive } from './workload.js';
import { voiceCommandGuard, isCommandCurrent } from './commandGuard.js';
import { bumpDeviceControlRevision, getDeviceControlRevision, patchDeviceState } from '../deviceSimulator.js';
import type { DeviceCommandRecord } from '@dongxin/shared';

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const flush = () => new Promise<void>((done) => setImmediate(done));
const errorCode = (code: string) => (error: unknown) => (error as { code?: string })?.code === code;

test('pilot admission accepts ten parallel device sessions and bounds overload at 16 plus 4', async () => {
  const scheduler = new TaskScheduler({ concurrency: 16, maxWaiting: 4, maxWaitMs: 500 });
  const gate = deferred();
  const jobs = Array.from({ length: 20 }, (_, index) =>
    scheduler.run(`sample-${index}`, async () => { await gate.promise; }),
  );
  await flush();
  assert.equal(scheduler.snapshot().active, 16);
  assert.equal(scheduler.snapshot().waiting, 4);
  await assert.rejects(
    scheduler.run('sample-overflow', async () => undefined),
    errorCode('SERVICE_BUSY'),
  );
  gate.resolve();
  await Promise.all(jobs);
  assert.equal(scheduler.snapshot().completed, 20);
  assert.equal(scheduler.snapshot().rejected, 1);
  assert.equal(scheduler.snapshot().active, 0);
  assert.equal(scheduler.snapshot().waiting, 0);
});

test('device operations serialize, unrelated devices use free slots, queues stay bounded', async () => {
  const scheduler = new TaskScheduler({ concurrency: 2, maxWaiting: 1, maxWaitMs: 1000 });
  const gate = deferred();
  const order: string[] = [];
  const first = scheduler.run('a', async () => { order.push('a1'); await gate.promise; });
  const second = scheduler.run('a', async () => { order.push('a2'); });
  await assert.rejects(scheduler.run('a', async () => undefined), errorCode('SERVICE_BUSY'));
  await scheduler.run('b', async () => { order.push('b'); });
  assert.deepEqual(order, ['a1', 'b']);
  gate.resolve();
  await Promise.all([first, second]);
  await flush();
  assert.deepEqual(order, ['a1', 'b', 'a2']);
  assert.equal(scheduler.snapshot().active, 0);
  assert.equal(scheduler.snapshot().waiting, 0);
});

test('live device requests take priority over waiting batch work', async () => {
  const scheduler = new TaskScheduler({ concurrency: 1, maxWaiting: 4, maxWaitMs: 1000 });
  const gate = deferred();
  const order: string[] = [];
  const first = scheduler.run('active', () => gate.promise);
  const batch = scheduler.run('batch', async () => { order.push('batch'); }, { priority: 0 });
  const live = scheduler.run('device', async () => { order.push('device'); }, { priority: 1 });
  gate.resolve();
  await Promise.all([first, batch, live]);
  assert.deepEqual(order, ['device', 'batch']);
});

test('message priority cannot reorder earlier reports from the same device', async () => {
  const scheduler = new TaskScheduler({ concurrency: 1, maxWaiting: 4, perKeyWaiting: 3, maxWaitMs: 1000 });
  const gate = deferred();
  const order: string[] = [];
  const active = scheduler.run('active', () => gate.promise);
  const state = scheduler.run('device', async () => { order.push('state'); }, { priority: 0 });
  const result = scheduler.run('device', async () => { order.push('result'); }, { priority: 2 });
  const other = scheduler.run('other', async () => { order.push('other'); }, { priority: 1 });
  gate.resolve();
  await Promise.all([active, state, result, other]);
  assert.deepEqual(order, ['other', 'state', 'result']);
});

test('queue expiry and cancellation never start their operations', async () => {
  const scheduler = new TaskScheduler({ concurrency: 1, maxWaiting: 3, maxWaitMs: 15 });
  const gate = deferred();
  const first = scheduler.run('a', () => gate.promise);
  let calls = 0;
  const expired = scheduler.run('b', async () => { calls++; });
  const controller = new AbortController();
  const cancelled = scheduler.run('c', async () => { calls++; }, { signal: controller.signal });
  const rejected = assert.rejects(cancelled, /cancelled/);
  controller.abort(new Error('cancelled'));
  await rejected;
  await assert.rejects(expired, errorCode('QUEUE_WAIT_EXPIRED'));
  gate.resolve();
  await first;
  assert.equal(calls, 0);
  assert.equal(scheduler.snapshot().expired, 1);
  assert.equal(scheduler.snapshot().cancelled, 1);
});

test('a failed operation releases its slot and key', async () => {
  const scheduler = new TaskScheduler({ concurrency: 1, maxWaiting: 1, maxWaitMs: 1000 });
  const failed = scheduler.run('a', async () => { throw new Error('provider failed'); });
  const next = scheduler.run('a', async () => 'ok');
  await assert.rejects(failed, /provider failed/);
  assert.equal(await next, 'ok');
});

test('same request ID reuses one operation, different content is rejected, expiry permits a new turn', async () => {
  let clock = 100;
  const replay = new RequestReplay(2, 1024, 50, () => clock);
  const gate = deferred<{ answer: string }>();
  let calls = 0;
  const execute = () => { calls++; return gate.promise; };
  const one = replay.run('device/request', 'audio-hash', execute);
  const two = replay.run('device/request', 'audio-hash', execute);
  await assert.rejects(replay.run('device/request', 'different-audio', execute), errorCode('REQUEST_ID_CONFLICT'));
  gate.resolve({ answer: 'ok' });
  assert.deepEqual(await one, await two);
  assert.equal(calls, 1);
  await replay.run('device/request', 'audio-hash', execute);
  assert.equal(calls, 1);
  clock += 51;
  await replay.run('device/request', 'audio-hash', execute);
  assert.equal(calls, 2);
});

test('retry entries and response bytes are bounded; large audio is shared only in flight', async () => {
  const replay = new RequestReplay(1, 100, 1000);
  const gate = deferred<string>();
  const first = replay.run('one', 'hash', () => gate.promise);
  await assert.rejects(replay.run('two', 'hash', async () => 'other'), errorCode('SERVICE_BUSY'));
  gate.resolve('a'.repeat(128 * 1024));
  await first;
  assert.equal(replay.snapshot().entries, 0);
  assert.equal(replay.snapshot().bytes, 0);
  await replay.run('two', 'hash', async () => 'ok');
  assert.equal(replay.snapshot().entries, 1);
});

test('replayed direct actions are invalidated by local control while ordinary replies remain reusable', async () => {
  const deviceId = 'replay-guard-fixture';
  const request = (requestId: string) => ({ url: '/api/device/v1/voice-turn', headers: { 'x-device-id': deviceId, 'x-request-id': requestId }, body: { deviceId, text: '测试' } }) as unknown as FastifyRequest;
  let calls = 0;
  const operation = async () => { calls++; return { data: { actions: [{ code: 'light', value: 'on' }] } }; };
  await replayDeviceVoice(request('control'), operation);
  await replayDeviceVoice(request('control'), operation);
  assert.equal(calls, 1);
  bumpDeviceControlRevision(deviceId);
  await assert.rejects(replayDeviceVoice(request('control'), operation), errorCode('STALE_VOICE_COMMAND'));
  assert.equal(calls, 1);
  const reply = { data: { actions: [], replyText: '您好' } };
  await replayDeviceVoice(request('chat'), async () => reply);
  bumpDeviceControlRevision(deviceId);
  assert.deepEqual(await replayDeviceVoice(request('chat'), async () => { throw new Error('Must reuse'); }), reply);
});

test('replayed direct actions also expire before the response cache expires', async () => {
  const previous = process.env.VOICE_TASK_TIMEOUT_MS;
  process.env.VOICE_TASK_TIMEOUT_MS = '100';
  const deviceId = 'replay-expiry-fixture';
  const request = { url: '/api/device/v1/voice-turn', headers: { 'x-device-id': deviceId, 'x-request-id': 'expiry' }, body: { deviceId } } as unknown as FastifyRequest;
  const operation = async () => ({ data: { actions: [{ code: 'light', value: 'on' }] } });
  try {
    await replayDeviceVoice(request, operation);
    await delay(120);
    await assert.rejects(replayDeviceVoice(request, operation), errorCode('STALE_VOICE_COMMAND'));
  } finally {
    if (previous === undefined) delete process.env.VOICE_TASK_TIMEOUT_MS;
    else process.env.VOICE_TASK_TIMEOUT_MS = previous;
  }
});

test('failed requests can be retried and single-flight results are discarded', async () => {
  const replay = new RequestReplay();
  await assert.rejects(replay.run('one', 'hash', async () => { throw new Error('failed'); }), /failed/);
  assert.equal(await replay.run('one', 'hash', async () => 'retried'), 'retried');
  const flight = new SingleFlight(1);
  const gate = deferred<string>();
  const first = flight.run('one', 'hash', () => gate.promise);
  const second = flight.run('one', 'hash', () => gate.promise);
  await assert.rejects(flight.run('two', 'hash', async () => ''), errorCode('SERVICE_BUSY'));
  gate.resolve('shared');
  assert.equal(await first, await second);
  assert.equal(flight.snapshot().active, 0);
});

test('short reply cache uses LRU byte limits, TTL and independent copies', () => {
  let clock = 100;
  const cache = new TtsCache<{ audioBase64: string; text: string }>(12, 50, () => clock);
  cache.set('a', { audioBase64: 'aaaa', text: 'hello' });
  cache.set('b', { audioBase64: 'bbbb', text: 'world' });
  cache.get('a')!.text = 'changed copy';
  cache.set('c', { audioBase64: 'cccccccc', text: 'third' });
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a')!.text, 'hello');
  assert.equal(cache.snapshot().bytes, 12);
  clock += 51;
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.snapshot().bytes, 0);
});

test('text retention respects both age and record count', () => {
  const now = Date.parse('2026-10-28T00:00:00Z');
  const recent = { at: '2026-10-27T00:00:00Z' };
  const newest = { at: '2026-10-28T00:00:00Z' };
  const rows = [{ at: '2025-01-01' }, newest, { at: 'invalid' }, recent];
  assert.deepEqual(retainRecent(rows, (row) => row.at, 1, now), [newest]);
  assert.deepEqual(retainRecent(rows, (row) => row.at, 5, now), [recent, newest]);
});

test('aborting an active turn keeps its slot until it settles and invalidates delivery immediately', async () => {
  const controller = new AbortController();
  const gate = deferred();
  const started = deferred();
  let command!: DeviceCommandRecord;
  const first = runVoiceWork('guard-device', async () => {
    command = { deviceId: 'guard-device', createdAt: new Date().toISOString(), slots: voiceCommandGuard('guard-device', getDeviceControlRevision('guard-device')) } as DeviceCommandRecord;
    assert.equal(isCommandCurrent(command), true);
    assert.ok(currentWorkSignal());
    started.resolve();
    await gate.promise;
    assertWorkActive();
  }, { signal: controller.signal });
  const failed = assert.rejects(first, errorCode('VOICE_TASK_CANCELLED'));
  await started.promise;
  controller.abort();
  assert.equal(isCommandCurrent(command), false);
  let secondStarted = false;
  const second = runVoiceWork('guard-device', async () => { secondStarted = true; });
  await flush();
  assert.equal(secondStarted, false);
  gate.resolve();
  await failed;
  await second;
  assert.equal(secondStarted, true);
});

test('a local state change invalidates an older online command; heartbeat does not', async () => {
  await runVoiceWork('local-change-device', async () => {
    const revision = getDeviceControlRevision('local-change-device');
    const command = { deviceId: 'local-change-device', createdAt: new Date().toISOString(), slots: voiceCommandGuard('local-change-device', revision) } as DeviceCommandRecord;
    patchDeviceState({ isOnline: true }, 'local-change-device');
    assert.equal(isCommandCurrent(command), true);
    patchDeviceState({ activeModes: ['LIGHT_ON'] }, 'local-change-device');
    assert.equal(isCommandCurrent(command), false);
    assert.throws(() => voiceCommandGuard('local-change-device', revision), errorCode('STALE_VOICE_COMMAND'));
  });
});

test('no-op local control invalidates earlier work; reordered mode reports do not', async () => {
  const id = 'local-noop-device';
  patchDeviceState({ activeModes: ['LIGHT_ON', 'FAN_ON'] }, id);
  const revision = getDeviceControlRevision(id);
  patchDeviceState({ activeModes: ['FAN_ON', 'LIGHT_ON'] }, id);
  assert.equal(getDeviceControlRevision(id), revision);
  await runVoiceWork(id, async () => {
    const command = { deviceId: id, createdAt: new Date().toISOString(), slots: voiceCommandGuard(id, revision) } as DeviceCommandRecord;
    bumpDeviceControlRevision(id);
    assert.equal(isCommandCurrent(command), false);
  });
});

test('unguarded commands cannot be replayed after the default delivery deadline', () => {
  const createdAt = '2026-10-30T00:00:00.000Z';
  const command = { deviceId: 'legacy-command', createdAt, slots: {} } as DeviceCommandRecord;
  const deadline = Date.parse(createdAt) + 60_000;
  assert.equal(isCommandCurrent(command, deadline - 1), true);
  assert.equal(isCommandCurrent(command, deadline), false);
});

test('voice deadlines abort downstream work and reject late success', async () => {
  const previous = process.env.VOICE_TASK_TIMEOUT_MS;
  process.env.VOICE_TASK_TIMEOUT_MS = '100';
  try {
    await assert.rejects(runVoiceWork('timeout-device', async () => {
      await delay(120);
      return 'late success';
    }), errorCode('VOICE_TASK_TIMEOUT'));
  } finally {
    if (previous === undefined) delete process.env.VOICE_TASK_TIMEOUT_MS;
    else process.env.VOICE_TASK_TIMEOUT_MS = previous;
  }
});

test('voice deadline includes queueing and an expired turn never executes', async () => {
  const previous = process.env.VOICE_TASK_TIMEOUT_MS;
  const gate = deferred();
  const started = deferred();
  let first: Promise<void> | undefined;
  let queued: Promise<unknown> | undefined;
  let calls = 0;
  try {
    process.env.VOICE_TASK_TIMEOUT_MS = '1000';
    first = runVoiceWork('queued-deadline-device', async () => {
      started.resolve();
      await gate.promise;
    });
    await started.promise;
    process.env.VOICE_TASK_TIMEOUT_MS = '100';
    queued = runVoiceWork('queued-deadline-device', async () => { calls++; });
    await Promise.all([
      assert.rejects(queued, errorCode('VOICE_TASK_TIMEOUT')),
      delay(130),
    ]);
    assert.equal(calls, 0);
  } finally {
    gate.resolve();
    await Promise.allSettled([first, queued]);
    if (previous === undefined) delete process.env.VOICE_TASK_TIMEOUT_MS;
    else process.env.VOICE_TASK_TIMEOUT_MS = previous;
  }
  await runVoiceWork('queued-deadline-device', async () => { calls++; });
  assert.equal(calls, 1);
});
