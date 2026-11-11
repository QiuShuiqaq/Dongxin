import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModelProviderSchema } from '@dongxin/shared';
import { applyProviderPricing, getReferencePricing } from './modelPricing.service.js';
import { selectDefaultProvider } from './provider.service.js';

const llm = ModelProviderSchema.parse({ id: 'test', name: 'Test', type: 'OPENAI_COMPATIBLE', serviceType: 'LLM', enabled: true, model: 'qwen-flash', apiKeyEnv: 'DASHSCOPE_API_KEY' });

test('reference pricing matches exact model and vendor, including all context tiers', () => {
  const pricing = getReferencePricing('aliyun', 'qwen-flash')!;
  assert.equal(pricing.rates.length, 3);
  assert.equal(pricing.rates[0].input, 0.15);
  assert.equal(pricing.rates[2].output, 12);
  assert.equal(getReferencePricing('deepseek', 'qwen-flash'), null);
  assert.equal(getReferencePricing('aliyun', 'qwen-flash-unknown-release'), null);
  assert.equal(getReferencePricing('aliyun', 'deepseek-v4-pro'), null);
  assert.equal(getReferencePricing('deepseek', 'deepseek-flash')?.rates.length, 4);
  assert.equal(getReferencePricing('aliyun', 'qwen3.6-plus')?.rates[1].output, 48);
  assert.equal(getReferencePricing('aliyun', 'qwen-plus')?.rates.length, 6);
  assert.equal(getReferencePricing('aliyun', 'qwen-plus-2025-07-14')?.rates.length, 2);
  assert.equal(getReferencePricing('aliyun', 'qwen-plus-2025-11-05'), null);
});

test('pricing updates only monetary fields and keeps explicit zero', () => {
  const next = applyProviderPricing(llm, { serviceType: 'LLM', inputPricePerMTokens: 0, outputPricePerMTokens: 1.5, apiKeyEnv: 'INJECTED_KEY', model: 'changed' });
  assert.equal(next.inputPricePerMTokens, 0);
  assert.equal(next.outputPricePerMTokens, 1.5);
  assert.equal(next.apiKeyEnv, llm.apiKeyEnv);
  assert.equal(next.model, llm.model);
  assert.ok(next.pricingUpdatedAt);
  assert.throws(() => applyProviderPricing(llm, { serviceType: 'LLM', inputPricePerMTokens: -1, outputPricePerMTokens: 2 }));
  assert.throws(() => applyProviderPricing(llm, { serviceType: 'TTS', pricePer10KCharsCny: 1 }), /计费方式/);
  assert.throws(() => applyProviderPricing(llm, { serviceType: 'LLM', inputPricePerMTokens: null, outputPricePerMTokens: 1 }));
});

test('ASR unit changes and TTS prices preserve the provider adapter', () => {
  const asr = { ...llm, serviceType: 'ASR' as const, protocol: 'HTTP_JSON' as const, billingMode: 'PER_HOUR' as const, pricePerHourCny: 1 };
  const next = applyProviderPricing(asr, { serviceType: 'ASR', billingMode: 'PER_MINUTE', pricePerMinuteCny: 0.02 });
  assert.equal(next.billingMode, 'PER_MINUTE');
  assert.equal(next.pricePerMinuteCny, 0.02);
  assert.equal(next.protocol, 'HTTP_JSON');
  assert.equal(applyProviderPricing({ ...llm, serviceType: 'TTS' }, { serviceType: 'TTS', pricePer10KCharsCny: 0.8 }).pricePer10KCharsCny, 0.8);
});

test('effective defaults skip providers without keys, disabled models and other services', () => {
  const original = process.env.DONGXIN_TEST_PROVIDER_KEY;
  delete process.env.DONGXIN_TEST_PROVIDER_KEY;
  try {
    const missing = { ...llm, id: 'missing', apiKeyEnv: 'DONGXIN_TEST_PROVIDER_KEY' };
    const ready = { ...llm, id: 'ready', apiKeyEnv: null };
    const disabled = { ...ready, id: 'disabled', enabled: false };
    const asr = { ...ready, id: 'asr', serviceType: 'ASR' as const };
    const providers = [missing, disabled, asr, ready];
    assert.equal(selectDefaultProvider(providers, 'missing', 'LLM')?.id, 'ready');
    assert.equal(selectDefaultProvider(providers, 'disabled', 'LLM')?.id, 'ready');
    assert.equal(selectDefaultProvider([missing], 'missing', 'LLM'), null);
    process.env.DONGXIN_TEST_PROVIDER_KEY = 'configured-test-key';
    assert.equal(selectDefaultProvider(providers, 'missing', 'LLM')?.id, 'missing');
  } finally {
    if (original === undefined) delete process.env.DONGXIN_TEST_PROVIDER_KEY;
    else process.env.DONGXIN_TEST_PROVIDER_KEY = original;
  }
});
