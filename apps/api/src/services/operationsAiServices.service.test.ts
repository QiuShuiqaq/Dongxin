import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { ModelProvider } from '@dongxin/shared';

let providers: ModelProvider[] = [];
let defaults = { ASR: 'aliyun-qwen3-asr-flash', LLM: null as string | null, TTS: 'aliyun-cosyvoice-v3-flash' };
let playbackRequest: unknown = null;

const replace = (path: string, namedExports: Record<string, unknown>) =>
  mock.module(new URL(path, import.meta.url).href, { namedExports });

replace('../envStore.js', { isEnvConfigured: () => true });
replace('../repositories/labData.repository.js', {
  saveProviders: async (next: ModelProvider[]) => { providers = next; return next; },
});
replace('../repositories/aiTesting.repository.js', {
  getAiServiceDefaults: async () => defaults,
  saveDefaultProvider: async (type: 'ASR' | 'LLM' | 'TTS', id: string) => { defaults = { ...defaults, [type]: id }; return defaults; },
});
replace('./aiTesting.service.js', {
  getAiServiceConfiguration: async () => ({
    defaults, providers, secrets: [{ providerId: 'tts', isConfigured: true }], referencePricing: {},
  }),
});
replace('./provider.service.js', {
  listProviders: async () => providers,
  findProvider: (items: ModelProvider[], id: string) => {
    const item = items.find((provider) => provider.id === id);
    if (!item) throw new Error('Unknown provider');
    return item;
  },
});
replace('./voiceModuleTest.service.js', {
  testTts: async (input: unknown) => {
    playbackRequest = input;
    return { audioBase64: 'UklGRg==', audioMimeType: 'audio/wav', costCny: 0.01, latencyMs: 5 };
  },
});

const service = await import('./operationsAiServices.service.js');

test('operations AI DTO excludes provider request credentials and adapter internals', async () => {
  providers = [{
    id: 'tts', name: 'TTS', type: 'OPENAI_COMPATIBLE', serviceType: 'TTS', protocol: 'HTTP_JSON',
    enabled: true, model: 'cosyvoice-v3-flash', baseUrl: 'https://secret.example/key', apiKeyEnv: 'DASHSCOPE_API_KEY',
    timeoutMs: 8000, maxOutputTokens: 128, requestHeaders: { Authorization: 'Bearer secret-value' },
  } as ModelProvider];
  const result = await service.getOperationsAiServices();
  assert.equal(result.providers[0].id, 'tts');
  assert.equal(JSON.stringify(result).includes('secret-value'), false);
  assert.equal(JSON.stringify(result).includes('https://secret.example/key'), false);
});

test('speech presets are added once without replacing existing providers', async () => {
  providers = [{
    id: 'existing-llm', name: 'LLM', type: 'OPENAI_COMPATIBLE', serviceType: 'LLM', protocol: 'OPENAI_COMPATIBLE',
    enabled: true, model: 'existing-llm', baseUrl: 'https://example.test', timeoutMs: 5000, maxOutputTokens: 256,
  }];
  const first = await service.bootstrapSpeechProviders();
  assert.deepEqual(first.created, ['aliyun-qwen3-asr-flash', 'aliyun-cosyvoice-v3-flash']);
  assert.equal(providers.length, 3);
  const second = await service.bootstrapSpeechProviders();
  assert.deepEqual(second.created, []);
  assert.equal(providers.length, 3);
  assert.equal(providers[0].id, 'existing-llm');
});

test('TTS preview ignores device playback instructions and voice changes are validated', async () => {
  playbackRequest = null;
  const preview = await service.previewOperationsTts({
    providerId: 'aliyun-cosyvoice-v3-flash', text: 'test speech', target: 'DEVICE', deviceId: 'bathroom-1',
  });
  assert.deepEqual(playbackRequest, { providerId: 'aliyun-cosyvoice-v3-flash', text: 'test speech', target: 'BROWSER' });
  assert.equal(preview.audioBase64, 'UklGRg==');
  await assert.rejects(service.saveOperationsTtsVoice({ providerId: 'aliyun-cosyvoice-v3-flash', voice: 'unsupported' }));
  const selected = await service.saveOperationsTtsVoice({ providerId: 'aliyun-cosyvoice-v3-flash', voice: 'longxiaoxia_v3' });
  assert.deepEqual(selected, { providerId: 'aliyun-cosyvoice-v3-flash', voice: 'longxiaoxia_v3' });
  assert.equal(providers.find((provider) => provider.id === selected.providerId)?.voice, selected.voice);
});
