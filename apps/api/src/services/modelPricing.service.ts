import type { ModelProvider } from '@dongxin/shared';
import { z } from 'zod';
import * as repository from '../repositories/labData.repository.js';
import { ApiError } from '../http/apiError.js';

export interface ReferencePricing {
  sourceUrl: string;
  checkedAt: string;
  note: string;
  rates: Array<{ label: string; unit: string; input?: number; output?: number; price?: number }>;
}

export const pricingUrls = {
  aliyun: 'https://help.aliyun.com/zh/model-studio/model-pricing',
  deepseek: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
};

// Official public list prices checked on this date. Exact model IDs only: do not
// infer prices for dated releases, resellers, regions, or similarly named models.
export function getReferencePricing(vendor: string, model: string): ReferencePricing | null {
  const token = (label: string, input: number, output: number) => ({ label, unit: '元 / 百万 Token', input, output });
  const aliyun: Record<string, ReferencePricing['rates']> = {
    'qwen3.8-flash': [token('输入 ≤ 1M', 0.8, 2.7)],
    'qwen3.7-flash': [token('输入 ≤ 32K', 0.2, 0.8), token('32K < 输入 ≤ 256K', 0.6, 2.4), token('256K < 输入 ≤ 1M', 1.2, 4.8)],
    'qwen3.7-flash-2026-07-15': [token('输入 ≤ 32K', 0.2, 0.8), token('32K < 输入 ≤ 256K', 0.6, 2.4), token('256K < 输入 ≤ 1M', 1.2, 4.8)],
    'qwen-flash': [token('输入 ≤ 128K', 0.15, 1.5), token('128K < 输入 ≤ 256K', 0.6, 6), token('256K < 输入 ≤ 1M', 1.2, 12)],
    'qwen-flash-2025-07-28': [token('输入 ≤ 128K', 0.15, 1.5), token('128K < 输入 ≤ 256K', 0.6, 6), token('256K < 输入 ≤ 1M', 1.2, 12)],
    'qwen3-asr-flash': [{ label: '按输入音频时长', unit: '元 / 秒', price: 0.00022 }],
    'qwen3-asr-flash-filetrans': [{ label: '按输入音频时长', unit: '元 / 秒', price: 0.00022 }],
    'cosyvoice-v3-flash': [{ label: '按输入文本', unit: '元 / 万字符', price: 1 }],
    'qwen3-tts-flash': [{ label: '按输入文本', unit: '元 / 万字符', price: 0.8 }],
  };
  const verifiedGroups: Array<[string[], ReferencePricing['rates']]> = [
    [['qwen3.8-max', 'qwen3.8-max-0902', 'qwen3.7-max', 'qwen3.7-max-2026-06-08', 'qwen3.7-max-2026-05-20', 'qwen3.7-max-preview', 'qwen3.7-max-2026-05-17'], [token('输入 ≤ 1M', 12, 36)]],
    [['qwen-max'], [token('非思考模式 · 无阶梯计价', 2.4, 9.6)]],
    [['qwen3.7-plus', 'qwen3.7-plus-2026-05-26'], [token('输入 ≤ 256K', 2, 8), token('256K < 输入 ≤ 1M', 6, 24)]],
    [['qwen3.6-plus', 'qwen3.6-plus-2026-04-02'], [token('输入 ≤ 256K', 2, 12), token('256K < 输入 ≤ 1M', 8, 48)]],
    [['qwen3.5-plus', 'qwen3.5-plus-2026-04-20', 'qwen3.5-plus-2026-02-15'], [token('输入 ≤ 128K', 0.8, 4.8), token('128K < 输入 ≤ 256K', 2, 12), token('256K < 输入 ≤ 1M', 4, 24)]],
    [['qwen3.6-flash', 'qwen3.6-flash-2026-04-16'], [token('输入 ≤ 256K', 1.2, 7.2), token('256K < 输入 ≤ 1M', 4.8, 28.8)]],
    [['qwen3.5-flash', 'qwen3.5-flash-2026-02-23'], [token('输入 ≤ 128K', 0.2, 2), token('128K < 输入 ≤ 256K', 0.8, 8), token('256K < 输入 ≤ 1M', 1.2, 12)]],
    [['qwen-plus', 'qwen-plus-latest', 'qwen-plus-2025-12-01'], [token('非思考 · 输入 ≤ 128K', 0.8, 2), token('非思考 · 128K < 输入 ≤ 256K', 2.4, 20), token('非思考 · 256K < 输入 ≤ 1M', 4.8, 48), token('思考 · 输入 ≤ 128K', 0.8, 8), token('思考 · 128K < 输入 ≤ 256K', 2.4, 24), token('思考 · 256K < 输入 ≤ 1M', 4.8, 64)]],
    [['qwen-plus-2025-07-14', 'qwen-plus-2025-04-28'], [token('非思考 · 无阶梯计价', 0.8, 2), token('思考 · 无阶梯计价', 0.8, 8)]],
    [['qwen-plus-2025-01-25'], [token('无阶梯计价', 0.8, 2)]],
  ];
  for (const [ids, groupRates] of verifiedGroups) for (const id of ids) aliyun[id] = groupRates;
  const flash = [token('空闲时段 · 缓存未命中', 1, 4), token('高峰时段 · 缓存未命中', 2, 8), token('空闲时段 · 缓存命中', 0.02, 4), token('高峰时段 · 缓存命中', 0.04, 8)];
  const deepseek: Record<string, ReferencePricing['rates']> = {
    'deepseek-flash': flash,
    'deepseek-v4-flash': flash,
    'deepseek-v4-flash-vision-exp': flash,
    'deepseek-v4-pro': [token('空闲时段 · 缓存未命中', 4.5, 13.5), token('高峰时段 · 缓存未命中', 9, 27), token('空闲时段 · 缓存命中', 0.15, 13.5), token('高峰时段 · 缓存命中', 0.3, 27)],
  };
  const rates = vendor === 'aliyun' ? aliyun[model] : vendor === 'deepseek' ? deepseek[model] : undefined;
  if (!rates) return null;
  return {
    sourceUrl: pricingUrls[vendor as keyof typeof pricingUrls],
    checkedAt: '2026-10-26',
    note: vendor === 'aliyun'
      ? '阿里百炼北京地域公开原价；不含缓存、Batch、免费额度或活动折扣。阶梯按整次请求的输入长度判定。'
      : '高峰为北京时间工作日 9:00–12:00、14:00–18:00（法定节假日除外）；其余为空闲时段。以官方账单为准。',
    rates,
  };
}

export function providerVendor(provider: ModelProvider): string | null {
  if (provider.apiKeyEnv === 'DASHSCOPE_API_KEY') return 'aliyun';
  if (provider.apiKeyEnv === 'DEEPSEEK_API_KEY') return 'deepseek';
  return null;
}

const Price = z.number().finite().nonnegative();
const PricingSchema = z.union([
  z.object({ serviceType: z.literal('LLM'), inputPricePerMTokens: Price, outputPricePerMTokens: Price }),
  z.object({ serviceType: z.literal('ASR'), billingMode: z.literal('PER_HOUR'), pricePerHourCny: Price }),
  z.object({ serviceType: z.literal('ASR'), billingMode: z.literal('PER_MINUTE'), pricePerMinuteCny: Price }),
  z.object({ serviceType: z.literal('ASR'), billingMode: z.literal('PER_REQUEST'), pricePerRequestCny: Price }),
  z.object({ serviceType: z.literal('TTS'), pricePer10KCharsCny: Price }),
]);

export async function saveProviderPricing(providerId: string, body: unknown) {
  PricingSchema.parse(body);
  const providers = await repository.listProviders();
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) throw new ApiError(404, 'PROVIDER_NOT_FOUND', '模型配置不存在');
  const next = applyProviderPricing(provider, body);
  await repository.saveProviders(providers.map((item) => item.id === providerId ? next : item));
  return next;
}

export function applyProviderPricing(provider: ModelProvider, body: unknown): ModelProvider {
  const pricing = PricingSchema.parse(body);
  if (provider.serviceType !== pricing.serviceType) throw new ApiError(422, 'PROVIDER_SERVICE_MISMATCH', '计费方式与模型类型不符');
  const vendor = providerVendor(provider);
  return { ...provider, ...pricing, pricingUpdatedAt: new Date().toISOString(), ...(vendor ? { pricingSourceUrl: pricingUrls[vendor as keyof typeof pricingUrls] } : {}) };
}
