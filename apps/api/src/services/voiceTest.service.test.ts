import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { VoiceTestSessionSchema, VoiceTestSettingsSchema } from '@dongxin/shared';
import type { VoicePipelineResponse, VoiceTestSession } from '@dongxin/shared';

const sessions: VoiceTestSession[] = [];
const published: Array<Record<string, unknown>> = [];
const resets: Array<Record<string, unknown>> = [];
const replace = (path: string, namedExports: Record<string, unknown>) =>
  mock.module(new URL(path, import.meta.url).href, { namedExports });

replace('../repositories/voiceTest.repository.js', {
  listVoiceTestSessions: async () => sessions,
  createVoiceTestSessionRecord: async (input: Record<string, unknown>) => {
    const now = new Date().toISOString();
    const session = VoiceTestSessionSchema.parse({
      ...input,
      id: '00000000-0000-4000-8000-000000000001',
      status: 'CREATED', muted: true, message: '', turns: [], result: null,
      requestedAt: now, updatedAt: now, startedAt: null, completedAt: null,
    });
    sessions.push(session);
    return session;
  },
  patchVoiceTestSession: async (id: string, patch: Record<string, unknown>) => {
    const index = sessions.findIndex((item) => item.id === id);
    if (index < 0) return null;
    sessions[index] = { ...sessions[index], ...patch, updatedAt: new Date().toISOString() } as VoiceTestSession;
    return sessions[index];
  },
});
replace('../repositories/system.repository.js', { listDeviceCommands: async () => [] });
replace('./deviceRegistry.service.js', {
  getDevice: async () => ({ protocol: 'MQTT', status: 'ONLINE', model: 'LICHUANG-AUDIO' }),
});
replace('./mqttGateway.service.js', {
  getMqttGatewayStatus: () => ({ connected: true }),
  publishVoiceTestControl: async (input: Record<string, unknown>) => { published.push(input); },
});
replace('./aiTesting.service.js', {
  addAsrDatasetItem: async () => { throw new Error('Unexpected dataset write'); },
  listAsrDatasets: async () => [],
});
replace('./conversation.service.js', {
  voiceConversations: { reset: (scope: Record<string, unknown>) => { resets.push(scope); } },
});

const { startVoiceTest, completeVoiceTest, stopVoiceTest, handleVoiceTestDeviceStatus } =
  await import('./voiceTest.service.js');

beforeEach(() => {
  sessions.length = 0;
  published.length = 0;
  resets.length = 0;
});

test('continuous test preserves each turn and ignores nonterminal device updates after stop', async () => {
  const settings = VoiceTestSettingsSchema.parse({ endpointSilenceMs: 1000, llmTemperature: 0.4 });
  const started = await startVoiceTest({ deviceId: 'fixture', continuous: true, settings });
  assert.equal(started.continuous, true);
  assert.equal(published[0].action, 'start');
  assert.deepEqual(resets, [{ deviceId: 'fixture', channel: 'pipeline' }]);

  await completeVoiceTest(started.id, {
    sessionId: '00000000-0000-4000-8000-000000000011',
    replyText: '我在', ttsAudioPath: null,
  } as VoicePipelineResponse, 700);
  assert.equal(sessions[0].status, 'PLAYING');
  await handleVoiceTestDeviceStatus({ deviceId: 'fixture', testSessionId: started.id, status: 'WAITING' });
  await completeVoiceTest(started.id, {
    sessionId: '00000000-0000-4000-8000-000000000012',
    replyText: '测试回答', ttsAudioPath: null,
  } as VoicePipelineResponse, 900);
  assert.equal(sessions[0].status, 'WAITING');
  assert.deepEqual(sessions[0].turns.map((turn) => turn.durationMs), [700, 900]);

  await stopVoiceTest(started.id);
  assert.equal(sessions[0].status, 'STOPPING');
  assert.equal(published[1].action, 'stop');
  await handleVoiceTestDeviceStatus({ deviceId: 'fixture', testSessionId: started.id, status: 'WAITING' });
  assert.equal(sessions[0].status, 'STOPPING');
  await handleVoiceTestDeviceStatus({ deviceId: 'fixture', testSessionId: started.id, status: 'CANCELLED' });
  assert.equal(sessions[0].status, 'CANCELLED');
  assert.equal(sessions[0].turns.length, 2);
});
