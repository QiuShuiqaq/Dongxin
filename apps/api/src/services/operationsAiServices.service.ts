import type { ModelProvider } from '@dongxin/shared';
import { z } from 'zod';
import { isEnvConfigured } from '../envStore.js';
import { ApiError } from '../http/apiError.js';
import * as labDataRepository from '../repositories/labData.repository.js';
import { getAiServiceDefaults, saveDefaultProvider } from '../repositories/aiTesting.repository.js';
import { getAiServiceConfiguration } from './aiTesting.service.js';
import { findProvider, listProviders } from './provider.service.js';
import { testTts } from './voiceModuleTest.service.js';

const DASH_SCOPE_TTS_URL = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer';
const voiceCatalog: Record<string, { value: string; label: string }[]> = {
  'cosyvoice-v3-flash': [
    { value: 'longxiaochun_v3', label: '龙小淳' },
    { value: 'longxiaoxia_v3', label: '龙小夏' },
    { value: 'longanwen_v3', label: '龙安温' },
    { value: 'longanlang_v3', label: '龙安朗' },
    { value: 'longshu_v3', label: '龙书' },
    { value: 'longwan_v3', label: '龙婉' },
  ],
  'qwen-audio-3.0-tts-flash': [
    { value: 'longanfengyue', label: '龙安风悦' },
    { value: 'longanlingxi', label: '龙安灵犀' },
    { value: 'longanxiaoxin', label: '龙安小昕' },
    { value: 'longanhuan_v3.6', label: '龙安欢' },
    { value: 'longjielidou_v3.6', label: '龙杰力豆' },
    { value: 'longchuanshu_v3.6', label: '龙川叔' },
  ],
};

const providerIdSchema = z.object({ providerId: z.string().min(1) });
const saveVoiceSchema = providerIdSchema.extend({ voice: z.string().min(1).max(64).nullable() });
const previewSchema = providerIdSchema.extend({ text: z.string().trim().min(1).max(100) });

// These are the two speech models already adapted by speech.service.ts. No
// realtime/WebSocket model or historical development provider is imported.
const speechPresets: ModelProvider[] = [
  {
    id: 'aliyun-qwen3-asr-flash', name: '阿里百炼 Qwen3-ASR-Flash',
    type: 'OPENAI_COMPATIBLE', serviceType: 'ASR', protocol: 'OPENAI_COMPATIBLE',
    enabled: true, model: 'qwen3-asr-flash',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY', timeoutMs: 8000, maxOutputTokens: 128,
    billingMode: 'PER_HOUR', pricePerHourCny: 0.792,
    averageSecondsPerRequest: 3, audioFormat: 'webm',
    responseTextPath: 'choices.0.message.content',
  },
  {
    id: 'aliyun-cosyvoice-v3-flash', name: '阿里百炼 CosyVoice V3 Flash',
    type: 'OPENAI_COMPATIBLE', serviceType: 'TTS', protocol: 'HTTP_JSON',
    enabled: true, model: 'cosyvoice-v3-flash', baseUrl: DASH_SCOPE_TTS_URL,
    apiKeyEnv: 'DASHSCOPE_API_KEY', timeoutMs: 8000, maxOutputTokens: 128,
    pricePer10KCharsCny: 1, averageCharsPerRequest: 50,
    voice: 'longxiaochun_v3', audioFormat: 'mp3',
    responseAudioPath: 'output.audio.data', responseMimeTypePath: 'mimeType',
  },
];

export async function getOperationsAiServices() {
  const configuration = await getAiServiceConfiguration();
  return {
    defaults: configuration.defaults,
    providers: configuration.providers.map((provider) => ({
      id: provider.id, name: provider.name, type: provider.type,
      serviceType: provider.serviceType, protocol: provider.protocol,
      enabled: provider.enabled, model: provider.model,
      apiKeyEnv: provider.apiKeyEnv ?? null, voice: provider.voice ?? null,
      timeoutMs: provider.timeoutMs, inputPricePerMTokens: provider.inputPricePerMTokens,
      outputPricePerMTokens: provider.outputPricePerMTokens,
      billingMode: provider.billingMode, pricePerRequestCny: provider.pricePerRequestCny,
      pricePerMinuteCny: provider.pricePerMinuteCny, pricePerHourCny: provider.pricePerHourCny,
      pricePer10KCharsCny: provider.pricePer10KCharsCny,
      referencePricing: configuration.referencePricing[provider.id] ?? null,
    })),
    secrets: configuration.secrets,
    referencePricing: configuration.referencePricing,
  };
}

export async function bootstrapSpeechProviders() {
  const providers = await listProviders();
  for (const preset of speechPresets) {
    const existing = providers.find((provider) => provider.id === preset.id);
    if (existing && (existing.serviceType !== preset.serviceType || existing.model !== preset.model || existing.protocol !== preset.protocol)) {
      throw new ApiError(409, 'SPEECH_PRESET_CONFLICT', `Speech preset ${preset.id} conflicts with an existing model`);
    }
  }
  const created = speechPresets.filter((preset) => !providers.some((provider) => provider.id === preset.id));
  if (created.length) await labDataRepository.saveProviders([...providers, ...created]);
  const all = [...providers, ...created];
  const defaults = await getAiServiceDefaults();
  for (const preset of speechPresets) {
    const selected = all.find((provider) => provider.id === defaults[preset.serviceType]);
    if (!selected || selected.serviceType !== preset.serviceType) {
      await saveDefaultProvider(preset.serviceType, preset.id);
    }
  }
  return { created: created.map((provider) => provider.id), defaults: await getAiServiceDefaults() };
}

export async function listOperationsTtsVoices(query: unknown) {
  const { providerId } = providerIdSchema.parse(query);
  const provider = findProvider(await listProviders(), providerId);
  if (provider.serviceType !== 'TTS') throw new ApiError(422, 'PROVIDER_SERVICE_MISMATCH', '请选择 TTS 模型');
  return { providerId, model: provider.model, voices: supportedVoices(provider) };
}

export async function saveOperationsTtsVoice(body: unknown) {
  const { providerId, voice } = saveVoiceSchema.parse(body);
  const providers = await listProviders();
  const provider = findProvider(providers, providerId);
  if (provider.serviceType !== 'TTS') throw new ApiError(422, 'PROVIDER_SERVICE_MISMATCH', '请选择 TTS 模型');
  const voices = supportedVoices(provider);
  if (!voices.length) throw new ApiError(422, 'TTS_VOICE_UNSUPPORTED', '该模型暂不支持在平台切换音色');
  const selected = voice ?? voices[0].value;
  if (!voices.some((option) => option.value === selected)) {
    throw new ApiError(422, 'TTS_VOICE_UNSUPPORTED', '该音色不属于当前模型的支持列表');
  }
  if (provider.voice !== selected) {
    await labDataRepository.saveProviders(providers.map((item) =>
      item.id === providerId ? { ...item, voice: selected } : item));
  }
  return { providerId, voice: selected };
}

export async function previewOperationsTts(body: unknown) {
  const { providerId, text } = previewSchema.parse(body);
  const provider = findProvider(await listProviders(), providerId);
  if (provider.serviceType !== 'TTS' || !provider.enabled) {
    throw new ApiError(422, 'TTS_PROVIDER_UNAVAILABLE', '请选择已启用的 TTS 模型');
  }
  if (provider.apiKeyEnv && !isEnvConfigured(provider.apiKeyEnv)) {
    throw new ApiError(422, 'PROVIDER_KEY_MISSING', '请先配置该服务商的 API Key');
  }
  // The target is constructed here; callers cannot request DEVICE playback.
  const result = await testTts({ providerId, text, target: 'BROWSER' });
  if (!result || !('audioBase64' in result) || !result.audioBase64 || result.audioBase64.length > 4 * 1024 * 1024) {
    throw new ApiError(502, 'TTS_PREVIEW_INVALID', '语音试听未返回可播放音频');
  }
  return {
    audioBase64: result.audioBase64, audioMimeType: result.audioMimeType,
    providerId, voice: provider.voice ?? null,
    costCny: result.costCny, latencyMs: result.latencyMs,
  };
}

function supportedVoices(provider: ModelProvider) {
  if (provider.apiKeyEnv !== 'DASHSCOPE_API_KEY' || provider.baseUrl !== DASH_SCOPE_TTS_URL) return [];
  return voiceCatalog[provider.model] ?? [];
}
