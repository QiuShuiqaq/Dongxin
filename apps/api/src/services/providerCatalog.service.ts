import { createHash } from 'node:crypto';
import type { ModelProvider } from '@dongxin/shared';
import { z } from 'zod';
import { isEnvConfigured, setLocalEnvValue } from '../envStore.js';
import { ApiError } from '../http/apiError.js';
import * as labDataRepository from '../repositories/labData.repository.js';
import { saveDefaultProvider } from '../repositories/aiTesting.repository.js';
import { getReferencePricing, pricingUrls } from './modelPricing.service.js';

export const CatalogVendorSchema = z.enum(['aliyun', 'deepseek']);
type CatalogVendor = z.infer<typeof CatalogVendorSchema>;

const vendors = {
  aliyun: {
    label: '阿里百炼',
    envName: 'DASHSCOPE_API_KEY',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  deepseek: {
    label: 'DeepSeek',
    envName: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
  },
} as const;

const ApiKeySchema = z.object({ apiKey: z.string().trim().min(1).max(1024) });
const AddModelSchema = z.object({ modelId: z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/) });
const ModelListSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1) }).passthrough()),
});

export function listCatalogVendors() {
  return Object.entries(vendors).map(([id, vendor]) => ({
    id,
    label: vendor.label,
    configured: isEnvConfigured(vendor.envName),
  }));
}

export async function saveCatalogApiKey(vendorId: unknown, body: unknown) {
  const vendor = vendors[CatalogVendorSchema.parse(vendorId)];
  const { apiKey } = ApiKeySchema.parse(body);
  await setLocalEnvValue(vendor.envName, apiKey);
  return { configured: true };
}

export async function fetchCatalogModels(vendorId: unknown) {
  const vendor = vendors[CatalogVendorSchema.parse(vendorId)];
  const apiKey = process.env[vendor.envName]?.trim();
  if (!apiKey) {
    throw new ApiError(422, 'CATALOG_KEY_MISSING', `请先配置${vendor.label} API Key`);
  }

  const response = await fetch(`${vendor.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new ApiError(502, 'CATALOG_FETCH_FAILED', `${vendor.label}模型接口返回 HTTP ${response.status}`);
  }
  const payload = ModelListSchema.safeParse(await response.json());
  if (!payload.success) {
    throw new ApiError(502, 'CATALOG_INVALID_RESPONSE', `${vendor.label}模型接口返回格式不符合预期`);
  }
  const id = CatalogVendorSchema.parse(vendorId);
  const models = [...new Set(payload.data.data.map((item) => item.id))].sort((a, b) => a.localeCompare(b));
  const providers = await labDataRepository.listProviders();
  return {
    vendor: id,
    models,
    pricingUrl: pricingUrls[id],
    details: models.map((model) => ({
      id: model,
      provider: providers.find((item) => item.apiKeyEnv === vendor.envName && item.model === model) ?? null,
      referencePricing: getReferencePricing(id, model),
    })),
  };
}

export async function addCatalogModel(vendorId: unknown, body: unknown) {
  const id = CatalogVendorSchema.parse(vendorId);
  const vendor = vendors[id];
  if (!isEnvConfigured(vendor.envName)) {
    throw new ApiError(422, 'CATALOG_KEY_MISSING', `请先配置${vendor.label} API Key`);
  }
  const { modelId } = AddModelSchema.parse(body);
  if (id === 'aliyun' && /(?:^|[-_./])(asr|tts|audio|speech|s2s|realtime|livetranslate|cosyvoice|paraformer|embedding|rerank|omni|image|vl|ocr|mt)(?:$|[-_./])/i.test(modelId)) {
    throw new ApiError(422, 'CATALOG_MODEL_UNSUPPORTED', '该模型暂未适配对话测试，请在 ASR/TTS 默认模型中选择已适配服务');
  }
  const providerId = `catalog-${id}-${createHash('sha256').update(modelId).digest('hex').slice(0, 12)}`;
  const providers = await labDataRepository.listProviders();
  let provider = providers.find((item) =>
    item.serviceType === 'LLM' &&
    item.apiKeyEnv === vendor.envName &&
    item.baseUrl === vendor.baseUrl &&
    item.model === modelId,
  ) ?? providers.find((item) => item.id === providerId);
  if (provider && !provider.enabled) {
    const enabledProvider = { ...provider, enabled: true };
    await labDataRepository.saveProviders(providers.map((item) => item.id === enabledProvider.id ? enabledProvider : item));
    provider = enabledProvider;
  }
  if (!provider) {
    provider = {
      id: providerId,
      name: `${vendor.label} · ${modelId}`,
      type: 'OPENAI_COMPATIBLE',
      serviceType: 'LLM',
      protocol: 'OPENAI_COMPATIBLE',
      enabled: true,
      model: modelId,
      baseUrl: vendor.baseUrl,
      apiKeyEnv: vendor.envName,
      timeoutMs: 15000,
      maxOutputTokens: 256,
    } satisfies ModelProvider;
    await labDataRepository.saveProviders([...providers, provider]);
  }
  return provider;
}

export async function useCatalogModel(vendorId: unknown, body: unknown) {
  const provider = await addCatalogModel(vendorId, body);
  const defaults = await saveDefaultProvider('LLM', provider.id);
  return { provider, defaults };
}
