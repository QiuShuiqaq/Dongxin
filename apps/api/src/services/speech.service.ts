import { performance } from "node:perf_hooks";
import type { ModelProvider } from "@dongxin/shared";
import { isEnvConfigured } from "../envStore.js";
import { getProductionCostSettings } from "../repositories/productionCost.repository.js";
import { findProviderForService, listProviders } from "./provider.service.js";

export interface SpeechResult {
  status: "COMPLETED" | "NOT_CONFIGURED" | "FAILED";
  providerId: string | null;
  providerName: string | null;
  text: string | null;
  audioBase64: string | null;
  audioMimeType: string | null;
  latencyMs: number;
  costCny: number;
  isEstimated: boolean;
  error: string | null;
}

type SpeechServiceType = "ASR" | "TTS";

interface SpeechConfig {
  url: string | null | undefined;
  apiKey: string | undefined;
  model: string | undefined;
  protocol: "OPENAI_COMPATIBLE" | "HTTP_JSON";
  requestBody: Record<string, unknown> | undefined;
  billingMode: ModelProvider["billingMode"];
  pricePerRequestCny: number | undefined;
  pricePerMinuteCny: number | undefined;
  pricePerHourCny: number | undefined;
  averageSecondsPerRequest: number | undefined;
  packageCalls: number | undefined;
  packagePriceCny: number | undefined;
  pricePer10KCharsCny: number | undefined;
  averageCharsPerRequest: number | undefined;
  responseTextPath: string | undefined;
  responseAudioPath: string | undefined;
  responseMimeTypePath: string | undefined;
  voice: string | undefined;
  audioFormat: string | undefined;
}

export async function transcribeAudio(input: {
  audioBase64: string;
  mimeType: string;
  providerId?: string;
}): Promise<SpeechResult> {
  const started = performance.now();
  const provider = await resolveSpeechProvider("ASR", input.providerId);
  const config = provider
    ? resolveProviderConfig(provider, "ASR")
    : resolveLegacyConfig("ASR", input.mimeType);

  if (!config.url || (provider?.apiKeyEnv && !config.apiKey)) {
    return notConfiguredResult(
      started,
      provider?.apiKeyEnv
        ? `未配置 ${provider.name} 的 API Key`
        : "未配置 ASR_API_URL",
      provider,
    );
  }

  try {
    const response = isDashScopeQwenAsr(config)
      ? await requestJson({
          url: `${config.url.replace(/\/$/, "")}/chat/completions`,
          apiKey: config.apiKey,
          timeoutMs: provider?.timeoutMs,
          body: {
            model: config.model,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "input_audio",
                    input_audio: {
                      data: `data:${input.mimeType};base64,${input.audioBase64}`,
                    },
                  },
                ],
              },
            ],
            stream: false,
            ...(config.requestBody ?? {}),
          },
        })
      : await requestJson({
          url: buildSpeechUrl(config.url, config.protocol, "ASR"),
          apiKey: config.apiKey,
          timeoutMs: provider?.timeoutMs,
          body: {
            model: config.model,
            audioBase64: input.audioBase64,
            mimeType: input.mimeType,
            format: config.audioFormat,
            ...config.requestBody,
          },
        });
    const text = extractText(response.payload, config.responseTextPath);
    if (!text) {
      throw new Error("ASR provider returned no transcript");
    }

    return {
      status: "COMPLETED",
      providerId: provider?.id ?? null,
      providerName: provider?.name ?? null,
      text,
      audioBase64: null,
      audioMimeType: null,
      latencyMs: Math.round(performance.now() - started),
      costCny: await calculateSpeechCost("ASR", provider, config),
      isEstimated: true,
      error: null,
    };
  } catch (error) {
    return failedResult(started, provider, error);
  }
}

export async function synthesizeSpeech(input: {
  text: string;
  providerId?: string;
}): Promise<SpeechResult> {
  const started = performance.now();
  const provider = await resolveSpeechProvider("TTS", input.providerId);
  const config = provider
    ? resolveProviderConfig(provider, "TTS")
    : resolveLegacyConfig("TTS", "audio/mp3");

  if (!config.url || (provider?.apiKeyEnv && !config.apiKey)) {
    return notConfiguredResult(
      started,
      provider?.apiKeyEnv
        ? `未配置 ${provider.name} 的 API Key`
        : "未配置 TTS_API_URL",
      provider,
    );
  }

  try {
    const response = isDashScopeTts(config)
      ? await requestJson({
          url: config.url,
          apiKey: config.apiKey,
          timeoutMs: provider?.timeoutMs,
          body: {
            model: config.model,
            input: {
              text: input.text,
              voice: config.voice,
              format: config.audioFormat,
            },
            ...(config.requestBody ?? {}),
          },
        })
      : await requestJson({
          url: buildSpeechUrl(config.url, config.protocol, "TTS"),
          apiKey: config.apiKey,
          timeoutMs: provider?.timeoutMs,
          body: {
            text: input.text,
            model: config.model,
            voice: config.voice,
            format: config.audioFormat,
            ...config.requestBody,
          },
        });
    const audioBase64 =
      response.audioBase64 ??
      extractAudioBase64(response.payload, config.responseAudioPath) ??
      (await fetchAudioAsBase64(extractAudioUrl(response.payload)));
    if (!audioBase64) {
      throw new Error("TTS provider returned no audio data");
    }

    return {
      status: "COMPLETED",
      providerId: provider?.id ?? null,
      providerName: provider?.name ?? null,
      text: input.text,
      audioBase64,
      audioMimeType:
        response.audioMimeType ||
        extractAudioMimeType(response.payload, config.responseMimeTypePath) ||
        `audio/${config.audioFormat || "mp3"}`,
      latencyMs: Math.round(performance.now() - started),
      costCny: await calculateTtsCost(
        provider,
        config,
        input.text,
        response.payload,
      ),
      isEstimated: true,
      error: null,
    };
  } catch (error) {
    return failedResult(started, provider, error, input.text);
  }
}

async function resolveSpeechProvider(
  serviceType: SpeechServiceType,
  providerId: string | undefined,
): Promise<ModelProvider | null> {
  const providers = await listProviders();
  if (providerId) {
    return findProviderForService(providers, providerId, serviceType);
  }

  return (
    providers.find(
      (provider) =>
        provider.enabled &&
        provider.serviceType === serviceType &&
        (!provider.apiKeyEnv || isEnvConfigured(provider.apiKeyEnv)),
    ) ?? null
  );
}

function resolveProviderConfig(
  provider: ModelProvider,
  serviceType: SpeechServiceType,
): SpeechConfig {
  return {
    url: provider.baseUrl,
    apiKey: provider.apiKeyEnv
      ? process.env[provider.apiKeyEnv]?.trim()
      : undefined,
    model: provider.model,
    protocol: provider.protocol,
    requestBody: provider.requestBody,
    billingMode: provider.billingMode,
    pricePerRequestCny: provider.pricePerRequestCny,
    pricePerMinuteCny: provider.pricePerMinuteCny,
    pricePerHourCny: provider.pricePerHourCny,
    averageSecondsPerRequest: provider.averageSecondsPerRequest,
    packageCalls: provider.packageCalls,
    packagePriceCny: provider.packagePriceCny,
    pricePer10KCharsCny: provider.pricePer10KCharsCny,
    averageCharsPerRequest: provider.averageCharsPerRequest,
    responseTextPath: provider.responseTextPath,
    responseAudioPath: provider.responseAudioPath,
    responseMimeTypePath: provider.responseMimeTypePath,
    voice: serviceType === "TTS" ? provider.voice : undefined,
    audioFormat:
      provider.audioFormat || (serviceType === "TTS" ? "mp3" : "webm"),
  };
}

function resolveLegacyConfig(
  serviceType: SpeechServiceType,
  mimeType: string,
): SpeechConfig {
  if (serviceType === "ASR") {
    return {
      url: process.env.ASR_API_URL?.trim(),
      apiKey: process.env.ASR_API_KEY?.trim(),
      model: process.env.ASR_MODEL?.trim() || undefined,
      protocol: "HTTP_JSON",
      requestBody: undefined,
      billingMode: undefined,
      pricePerRequestCny: undefined,
      pricePerMinuteCny: undefined,
      pricePerHourCny: undefined,
      averageSecondsPerRequest: undefined,
      packageCalls: undefined,
      packagePriceCny: undefined,
      pricePer10KCharsCny: undefined,
      averageCharsPerRequest: undefined,
      responseTextPath: undefined,
      responseAudioPath: undefined,
      responseMimeTypePath: undefined,
      voice: undefined,
      audioFormat: mimeType.split("/")[1] || "webm",
    };
  }

  return {
    url: process.env.TTS_API_URL?.trim(),
    apiKey: process.env.TTS_API_KEY?.trim(),
    model: process.env.TTS_MODEL?.trim() || undefined,
    protocol: "HTTP_JSON",
    requestBody: undefined,
    billingMode: undefined,
    pricePerRequestCny: undefined,
    pricePerMinuteCny: undefined,
    pricePerHourCny: undefined,
    averageSecondsPerRequest: undefined,
    packageCalls: undefined,
    packagePriceCny: undefined,
    pricePer10KCharsCny: undefined,
    averageCharsPerRequest: undefined,
    responseTextPath: undefined,
    responseAudioPath: undefined,
    responseMimeTypePath: undefined,
    voice: process.env.TTS_VOICE?.trim() || undefined,
    audioFormat: process.env.TTS_AUDIO_FORMAT?.trim() || "mp3",
  };
}

function buildSpeechUrl(
  url: string,
  protocol: SpeechConfig["protocol"],
  serviceType: SpeechServiceType,
): string {
  if (protocol === "OPENAI_COMPATIBLE") {
    const suffix =
      serviceType === "TTS" ? "/audio/speech" : "/audio/transcriptions";
    return `${url.replace(/\/$/, "")}${suffix}`;
  }
  return url;
}

function isDashScopeQwenAsr(
  config: SpeechConfig,
): config is SpeechConfig & { url: string } {
  return (
    config.protocol === "OPENAI_COMPATIBLE" &&
    Boolean(config.url?.includes("dashscope.aliyuncs.com")) &&
    Boolean(config.model?.includes("qwen") && config.model.includes("asr"))
  );
}

function isDashScopeTts(
  config: SpeechConfig,
): config is SpeechConfig & { url: string } {
  return Boolean(config.url?.includes("/services/audio/tts/SpeechSynthesizer"));
}

async function requestJson(input: {
  url: string;
  apiKey?: string;
  timeoutMs?: number;
  body: Record<string, unknown>;
}): Promise<{
  payload: unknown;
  audioBase64: string | null;
  audioMimeType: string | null;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 8000);

  try {
    const response = await fetch(input.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.body),
    });
    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      const body = contentType.includes("application/json")
        ? await response.json()
        : await response.text();
      throw new Error(
        `Speech provider returned ${response.status}: ${stringifyPayload(body)}`,
      );
    }

    if (contentType.startsWith("audio/")) {
      return {
        payload: null,
        audioBase64: Buffer.from(await response.arrayBuffer()).toString(
          "base64",
        ),
        audioMimeType: contentType.split(";")[0],
      };
    }

    return {
      payload: contentType.includes("application/json")
        ? await response.json()
        : await response.text(),
      audioBase64: null,
      audioMimeType: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractText(payload: unknown, configuredPath?: string): string | null {
  const configured = configuredPath
    ? readPath(payload, configuredPath)
    : undefined;
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim();
  }
  if (typeof payload === "string") {
    return payload.trim() || null;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const value = payload as Record<string, unknown>;
  const data = value.data as Record<string, unknown> | undefined;
  const output = value.output as Record<string, unknown> | undefined;
  const choice = Array.isArray(value.choices)
    ? (value.choices[0] as Record<string, unknown> | undefined)
    : undefined;
  const message = choice?.message as Record<string, unknown> | undefined;
  const candidates = [
    value.text,
    value.transcript,
    value.result,
    data?.text,
    data?.transcript,
    output?.text,
    output?.transcript,
    message?.content,
  ];
  return (
    candidates
      .find(
        (candidate): candidate is string =>
          typeof candidate === "string" && Boolean(candidate.trim()),
      )
      ?.trim() || null
  );
}

function extractAudioBase64(
  payload: unknown,
  configuredPath?: string,
): string | null {
  const configured = configuredPath
    ? readPath(payload, configuredPath)
    : undefined;
  if (typeof configured === "string" && configured.length > 0) {
    return configured;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const value = payload as Record<string, unknown>;
  const data = value.data as Record<string, unknown> | undefined;
  const output = value.output as Record<string, unknown> | undefined;
  const outputAudio = output?.audio as Record<string, unknown> | undefined;
  const candidates = [
    value.audioBase64,
    value.audio,
    data?.audioBase64,
    data?.audio,
    output?.audioBase64,
    outputAudio?.data,
  ];
  return (
    candidates.find(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.length > 0,
    ) || null
  );
}

function extractAudioUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const value = payload as Record<string, unknown>;
  const data = value.data as Record<string, unknown> | undefined;
  const output = value.output as Record<string, unknown> | undefined;
  const outputAudio = output?.audio as Record<string, unknown> | undefined;
  const candidates = [
    value.audioUrl,
    data?.audioUrl,
    output?.audioUrl,
    outputAudio?.url,
  ];
  return (
    candidates.find(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.length > 0,
    ) || null
  );
}

async function fetchAudioAsBase64(
  audioUrl: string | null,
): Promise<string | null> {
  if (!audioUrl) {
    return null;
  }

  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`TTS audio download returned ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer()).toString("base64");
}

function extractAudioMimeType(
  payload: unknown,
  configuredPath?: string,
): string | null {
  const configured = configuredPath
    ? readPath(payload, configuredPath)
    : undefined;
  if (typeof configured === "string" && configured.length > 0) {
    return configured;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const value = payload as Record<string, unknown>;
  const data = value.data as Record<string, unknown> | undefined;
  const output = value.output as Record<string, unknown> | undefined;
  const candidates = [
    value.mimeType,
    value.audioMimeType,
    data?.mimeType,
    output?.mimeType,
  ];
  return (
    candidates.find(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.length > 0,
    ) || null
  );
}

function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, value);
}

async function calculateSpeechCost(
  serviceType: SpeechServiceType,
  provider: ModelProvider | null,
  config: SpeechConfig,
): Promise<number> {
  if (provider) {
    if (serviceType === "ASR") {
      switch (config.billingMode) {
        case "PER_HOUR":
          return (
            ((config.averageSecondsPerRequest ?? 0) / 3600) *
            (config.pricePerHourCny ?? 0)
          );
        case "PER_MINUTE":
          return (
            ((config.averageSecondsPerRequest ?? 0) / 60) *
            (config.pricePerMinuteCny ?? 0)
          );
        case "PER_REQUEST":
          return config.pricePerRequestCny ?? 0;
        default:
          return 0;
      }
    }
    if (typeof config.pricePer10KCharsCny === "number") {
      const averageChars = config.averageCharsPerRequest ?? 50;
      return (averageChars / 10_000) * config.pricePer10KCharsCny;
    }
    if (config.packageCalls && config.packagePriceCny !== undefined) {
      return config.packagePriceCny / config.packageCalls;
    }
    return config.pricePerRequestCny ?? 0;
  }

  const settings = await getProductionCostSettings();
  if (serviceType === "ASR") {
    switch (settings.asr.billingMode) {
      case "PER_HOUR":
        return (
          (settings.asr.averageSecondsPerRequest / 3600) *
          settings.asr.pricePerHourCny
        );
      case "PER_MINUTE":
        return (
          (settings.asr.averageSecondsPerRequest / 60) *
          settings.asr.pricePerMinuteCny
        );
      case "PER_REQUEST":
        return settings.asr.pricePerRequestCny;
      default:
        return 0;
    }
  }
  return settings.tts.packageCalls > 0
    ? settings.tts.packagePriceCny / settings.tts.packageCalls
    : 0;
}

async function calculateTtsCost(
  provider: ModelProvider | null,
  config: SpeechConfig,
  text: string,
  payload: unknown,
): Promise<number> {
  if (provider) {
    if (typeof config.pricePer10KCharsCny === "number") {
      const usageChars =
        readNumberPath(payload, "usage.characters") ??
        readNumberPath(payload, "output.usage.characters");
      const billedChars = usageChars ?? Math.max(text.trim().length, 1);
      return (billedChars / 10_000) * config.pricePer10KCharsCny;
    }
    if (config.packageCalls && config.packagePriceCny !== undefined) {
      return config.packagePriceCny / config.packageCalls;
    }
    return config.pricePerRequestCny ?? 0;
  }

  const settings = await getProductionCostSettings();
  return settings.tts.packageCalls > 0
    ? settings.tts.packagePriceCny / settings.tts.packageCalls
    : 0;
}

function readNumberPath(payload: unknown, path: string): number | null {
  const value = readPath(payload, path);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function notConfiguredResult(
  started: number,
  error: string,
  provider: ModelProvider | null,
): SpeechResult {
  return {
    status: "NOT_CONFIGURED",
    providerId: provider?.id ?? null,
    providerName: provider?.name ?? null,
    text: null,
    audioBase64: null,
    audioMimeType: null,
    latencyMs: Math.round(performance.now() - started),
    costCny: 0,
    isEstimated: false,
    error,
  };
}

function failedResult(
  started: number,
  provider: ModelProvider | null,
  error: unknown,
  text: string | null = null,
): SpeechResult {
  return {
    status: "FAILED",
    providerId: provider?.id ?? null,
    providerName: provider?.name ?? null,
    text,
    audioBase64: null,
    audioMimeType: null,
    latencyMs: Math.round(performance.now() - started),
    costCny: 0,
    isEstimated: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

function stringifyPayload(payload: unknown): string {
  if (typeof payload === "string") {
    return payload.slice(0, 500);
  }
  try {
    return JSON.stringify(payload).slice(0, 500);
  } catch {
    return String(payload);
  }
}
