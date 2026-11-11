import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import Fastify from 'fastify';
import { ApiError } from '../http/apiError.js';

let previews = 0;
let bootstrapCalls = 0;
let transcriptions: unknown[] = [];
const audits: Record<string, unknown>[] = [];
const replace = (path: string, namedExports: Record<string, unknown>) =>
  mock.module(new URL(path, import.meta.url).href, { namedExports });

replace('../services/operationsAuth.service.js', {
  requireOperationsRole: (authorization: string | undefined, roles: string[]) => {
    const role = authorization === 'admin' ? 'ADMIN' : authorization === 'viewer' ? 'REVIEWER' : null;
    if (!role || !roles.includes(role)) throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
    return { username: role.toLowerCase(), role };
  },
});
replace('../services/aiTesting.service.js', {
  diagnoseProvider: async () => ({ providerId: 'tts', status: 'PASSED', error: null }),
  setDefaultProvider: async (_serviceType: string, body: { providerId: string }) => ({ TTS: body.providerId }),
});
replace('../services/operationsAiServices.service.js', {
  bootstrapSpeechProviders: async () => { bootstrapCalls++; return { created: ['asr', 'tts'], defaults: {} }; },
  getOperationsAiServices: async () => ({ defaults: {}, providers: [], secrets: [] }),
  listOperationsTtsVoices: async () => ({ providerId: 'tts', model: 'cosyvoice-v3-flash', voices: [] }),
  previewOperationsTts: async () => { previews++; return { audioBase64: 'UklGRg==', audioMimeType: 'audio/wav' }; },
  saveOperationsTtsVoice: async () => ({ providerId: 'tts', voice: 'longxiaochun_v3' }),
});
replace('../services/operationsAiAudit.service.js', {
  auditAiChange: async (_request: unknown, actor: string, summary: string, fields: Record<string, unknown>) => {
    audits.push({ actor, summary, ...fields });
  },
});
replace('../services/speech.service.js', {
  transcribeAudio: async (input: unknown) => {
    transcriptions.push(input);
    return { status: 'COMPLETED', providerId: 'asr', text: 'turn on the light', latencyMs: 14, costCny: 0.001, isEstimated: true };
  },
});

const { registerOperationsAiServicesRoutes } = await import('./operationsAiServices.routes.js');

test('AI configuration reads require login and mutations require an administrator', async () => {
  const server = Fastify();
  await server.register(registerOperationsAiServicesRoutes);
  try {
    previews = 0; bootstrapCalls = 0; audits.length = 0;
    assert.equal((await server.inject({ method: 'GET', url: '/api/operations/ai-services' })).statusCode, 403);
    assert.equal((await server.inject({ method: 'GET', url: '/api/operations/ai-services', headers: { authorization: 'viewer' } })).statusCode, 200);
    assert.equal((await server.inject({ method: 'POST', url: '/api/operations/ai-services/bootstrap-speech', headers: { authorization: 'viewer' } })).statusCode, 403);
    assert.equal((await server.inject({ method: 'PATCH', url: '/api/operations/ai-services/tts-voice', headers: { authorization: 'viewer' }, payload: { providerId: 'tts', voice: 'longxiaochun_v3' } })).statusCode, 403);
    assert.equal((await server.inject({ method: 'POST', url: '/api/operations/ai-services/tts-preview', headers: { authorization: 'viewer' }, payload: { providerId: 'tts', text: 'test' } })).statusCode, 403);
    assert.equal(previews, 0);
    assert.equal(bootstrapCalls, 0);
    const allowed = await server.inject({ method: 'POST', url: '/api/operations/ai-services/bootstrap-speech', headers: { authorization: 'admin' } });
    assert.equal(allowed.statusCode, 200);
    assert.equal(bootstrapCalls, 1);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actor, 'admin');
  } finally { await server.close(); }
});

test('ASR preview accepts only bounded admin audio and never initiates device work', async () => {
  const server = Fastify();
  await server.register(registerOperationsAiServicesRoutes);
  try {
    transcriptions = [];
    const url = '/api/operations/ai-services/asr-preview';
    const payload = { audioBase64: Buffer.from('RIFF0000WAVE').toString('base64'), audioMimeType: 'audio/wav', providerId: 'asr' };
    assert.equal((await server.inject({ method: 'POST', url, headers: { authorization: 'viewer' }, payload })).statusCode, 403);
    assert.equal(transcriptions.length, 0);
    const allowed = await server.inject({ method: 'POST', url, headers: { authorization: 'admin' }, payload });
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.json().transcript, 'turn on the light');
    assert.deepEqual(transcriptions, [{ audioBase64: payload.audioBase64, mimeType: 'audio/wav', providerId: 'asr' }]);
    const tooLarge = await server.inject({
      method: 'POST', url, headers: { authorization: 'admin' },
      payload: { audioBase64: Buffer.alloc(2 * 1024 * 1024 + 1, 1).toString('base64'), audioMimeType: 'audio/wav' },
    });
    assert.equal(tooLarge.statusCode, 413);
    assert.equal(transcriptions.length, 1);
    const unsupported = await server.inject({
      method: 'POST', url, headers: { authorization: 'admin' },
      payload: { ...payload, audioMimeType: 'application/octet-stream' },
    });
    assert.ok(unsupported.statusCode >= 400);
    assert.equal(transcriptions.length, 1);
  } finally { await server.close(); }
});
