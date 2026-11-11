import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VoiceTestSessionSchema, VoiceTestSettingsSchema } from '@dongxin/shared';

test('continuous test parameters have bounded defaults', () => {
  const settings = VoiceTestSettingsSchema.parse({});
  assert.equal(settings.endpointSilenceMs, 800);
  assert.equal(settings.idleTimeoutMs, 30000);
  assert.equal(settings.maxUtteranceSeconds, 12);
  assert.equal(settings.llmTemperature, 0);
  assert.equal(VoiceTestSettingsSchema.safeParse({ endpointSilenceMs: 100 }).success, false);
  assert.equal(VoiceTestSettingsSchema.safeParse({ idleTimeoutMs: 0 }).success, false);
  assert.equal(VoiceTestSettingsSchema.safeParse({ maxUtteranceSeconds: 30 }).success, false);
  assert.equal(VoiceTestSettingsSchema.safeParse({ llmTemperature: 2 }).success, false);
});

test('older single-turn session records remain readable', () => {
  const session = VoiceTestSessionSchema.parse({
    id: '00000000-0000-4000-8000-000000000001', deviceId: 'fixture',
    mode: 'ASR_ONLY', status: 'COMPLETED', recordSeconds: 6, muted: true,
    message: 'done', requestedAt: '', startedAt: null, completedAt: '',
    updatedAt: '', result: null,
  });
  assert.equal(session.continuous, false);
  assert.deepEqual(session.turns, []);
  assert.equal(session.settings.endpointSilenceMs, 800);
});
