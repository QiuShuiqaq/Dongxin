import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { addCatalogModel, fetchCatalogModels, listCatalogVendors } from './providerCatalog.service.js';

const originalFetch = globalThis.fetch;
const originalAliKey = process.env.DASHSCOPE_API_KEY;
const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;

before(() => {
  process.env.DASHSCOPE_API_KEY = 'test-aliyun-key';
  process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
});

after(() => {
  globalThis.fetch = originalFetch;
  if (originalAliKey === undefined) delete process.env.DASHSCOPE_API_KEY;
  else process.env.DASHSCOPE_API_KEY = originalAliKey;
  if (originalDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalDeepSeekKey;
});

test('service catalog uses vendor-specific official endpoints and keys', async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      authorization: new Headers(init?.headers).get('authorization'),
    });
    return Response.json({ data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-a' }] });
  };

  assert.deepEqual((await fetchCatalogModels('aliyun')).models, ['model-a', 'model-b']);
  assert.deepEqual((await fetchCatalogModels('deepseek')).models, ['model-a', 'model-b']);
  assert.deepEqual(requests, [
    { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models', authorization: 'Bearer test-aliyun-key' },
    { url: 'https://api.deepseek.com/models', authorization: 'Bearer test-deepseek-key' },
  ]);
  assert.equal(listCatalogVendors().length, 2);
});

test('catalog rejects provider errors without returning key or response body', async () => {
  globalThis.fetch = async () => new Response('sensitive upstream body', { status: 401 });
  await assert.rejects(fetchCatalogModels('aliyun'), (error: Error) => {
    assert.match(error.message, /HTTP 401/);
    assert.doesNotMatch(error.message, /sensitive|test-aliyun-key/);
    return true;
  });
});

test('catalog rejects unknown vendors before fetching', async () => {
  await assert.rejects(fetchCatalogModels('unknown'));
});

test('specialized speech, image and realtime models are not added to the conversation provider list', async () => {
  for (const modelId of ['qwen3-tts-flash', 'qwen-audio-3.0-realtime-flash', 'MiniMax/speech-2.8-hd', 'qwen3-s2s-flash-realtime-2025-09-22', 'qwen-vl-ocr', 'qwen-mt-plus']) {
    await assert.rejects(addCatalogModel('aliyun', { modelId }), /暂未适配对话测试/);
  }
});
