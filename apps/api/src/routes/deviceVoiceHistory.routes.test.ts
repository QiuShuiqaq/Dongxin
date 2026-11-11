import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import Fastify from 'fastify';

const pipelineCalls: Array<{ body: Record<string, unknown>; options: Record<string, unknown> }> = [];
const replace = (path: string, namedExports: Record<string, unknown>) =>
  mock.module(new URL(path, import.meta.url).href, { namedExports });

replace('../services/deviceAccess.service.js', {
  getDeviceAccessConfig: async () => ({}),
  handleDeviceAccessEvent: async () => ({}),
  handleDeviceAccessVoiceTurn: async () => ({}),
  handleDeviceCommandResult: async () => ({}),
  handleDeviceHeartbeat: async () => ({}),
  handleDeviceStateReport: async () => ({}),
  pollDeviceAccessCommands: async () => [],
  registerDeviceAccess: async () => ({}),
});
replace('../services/voicePipeline.service.js', {
  runVoicePipeline: async (body: Record<string, unknown>, options: Record<string, unknown>) => {
    pipelineCalls.push({ body, options });
    return { transcript: '测试', replyText: '好的' };
  },
});
replace('../services/voiceTest.service.js', {
  archiveVoiceTestPcm: async () => undefined,
  completeVoiceTest: async () => undefined,
  failVoiceTest: async () => undefined,
  markVoiceTestProcessing: async () => ({ settings: {}, result: null }),
});
replace('../services/deviceAudioAsset.service.js', { getDeviceVoiceReplyPcm: () => Buffer.alloc(0) });
replace('../repositories/deviceVolume.repository.js', { getDeviceVolume: async () => 50 });
replace('../services/conversation.service.js', { isConversationEnd: () => false });

const { registerDeviceAccessRoutes } = await import('./deviceAccess.routes.js');

test('PCM development test sessions do not write production device history', async () => {
  const server = Fastify();
  server.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  await server.register(registerDeviceAccessRoutes);
  try {
    pipelineCalls.length = 0;
    const live = await server.inject({
      method: 'POST',
      url: '/api/device/v1/voice-pcm?deviceId=DX-001&requireWakeWord=0',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.alloc(4),
    });
    const development = await server.inject({
      method: 'POST',
      url: '/api/device/v1/voice-pcm?deviceId=DX-001&requireWakeWord=0',
      headers: {
        'content-type': 'application/octet-stream',
        'x-voice-test-session-id': 'test-session-1',
      },
      payload: Buffer.alloc(4),
    });
    assert.equal(live.statusCode, 200, live.body);
    assert.equal(development.statusCode, 200, development.body);
    assert.equal(pipelineCalls[0]?.options.recordProductionHistory, true);
    assert.equal(pipelineCalls[1]?.options.recordProductionHistory, false);
    assert.equal(typeof pipelineCalls[1]?.options.signal, 'object');
    assert.equal(pipelineCalls[0]?.body.inputSource, 'DEVICE_AUDIO');
  } finally {
    await server.close();
  }
});
