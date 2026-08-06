import type { ModelProvider, ProviderSecretStatus } from '@dongxin/shared';
import { SaveProviderApiKeyRequestSchema } from '@dongxin/shared';
import { z } from 'zod';
import { clearLocalEnvValue, isEnvConfigured, setLocalEnvValue } from '../envStore.js';
import { ApiError } from '../http/apiError.js';
import * as labDataRepository from '../repositories/labData.repository.js';

export const ProviderParamsSchema = z.object({
  providerId: z.string().min(1)
});

export async function listProviders(): Promise<ModelProvider[]> {
  return labDataRepository.listProviders();
}

export async function saveProviders(providers: ModelProvider[]): Promise<ModelProvider[]> {
  return labDataRepository.saveProviders(providers);
}

export async function listProviderSecretStatuses(): Promise<ProviderSecretStatus[]> {
  const providers = await listProviders();
  return providers.map(toProviderSecretStatus);
}

export async function saveProviderApiKey(providerId: string, requestBody: unknown): Promise<ProviderSecretStatus> {
  const body = SaveProviderApiKeyRequestSchema.parse(requestBody);
  const provider = await getProviderOrThrow(providerId);
  assertProviderNeedsApiKey(provider);
  await setLocalEnvValue(provider.apiKeyEnv, body.apiKey);
  return toProviderSecretStatus(provider);
}

export async function clearProviderApiKey(providerId: string): Promise<ProviderSecretStatus> {
  const provider = await getProviderOrThrow(providerId);
  assertProviderNeedsApiKey(provider);
  await clearLocalEnvValue(provider.apiKeyEnv);
  return toProviderSecretStatus(provider);
}

export function findProvider(providers: ModelProvider[], providerId: string): ModelProvider {
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) {
    throw new ApiError(404, 'PROVIDER_NOT_FOUND', `Unknown provider: ${providerId}`);
  }
  return provider;
}

function toProviderSecretStatus(provider: ModelProvider): ProviderSecretStatus {
  return {
    providerId: provider.id,
    apiKeyEnv: provider.apiKeyEnv ?? null,
    isConfigured: provider.apiKeyEnv ? isEnvConfigured(provider.apiKeyEnv) : false
  };
}

async function getProviderOrThrow(providerId: string): Promise<ModelProvider> {
  const providers = await listProviders();
  const provider = providers.find((item) => item.id === providerId);

  if (!provider) {
    throw new ApiError(404, 'PROVIDER_NOT_FOUND', `Unknown provider: ${providerId}`);
  }

  return provider;
}

function assertProviderNeedsApiKey(provider: ModelProvider): asserts provider is ModelProvider & { apiKeyEnv: string } {
  if (!provider.apiKeyEnv) {
    throw new ApiError(422, 'API_KEY_NOT_REQUIRED', `${provider.name} does not require an API Key`);
  }
}
