import { performance } from 'node:perf_hooks';
import type { AiResult, DeviceState, ModelProvider, PromptVersion } from '@dongxin/shared';
import { AiResultSchema } from '@dongxin/shared';

export interface ModelCallInput {
  provider: ModelProvider;
  prompt: PromptVersion;
  inputText: string;
  deviceState: DeviceState;
}

export interface ModelCallOutput {
  aiResult: AiResult;
  latencyMs: number;
  rawResponse: unknown;
}

export async function callModel(input: ModelCallInput): Promise<ModelCallOutput> {
  const started = performance.now();
  const rawResponse =
    input.provider.type === 'MOCK' ? mockModelResponse(input.inputText) : await callOpenAICompatible(input);
  const aiResult = parseAiResult(rawResponse);

  return {
    aiResult,
    latencyMs: Math.round(performance.now() - started),
    rawResponse
  };
}

function mockModelResponse(inputText: string): AiResult {
  const text = inputText.trim();

  if (matches(text, ['笑话', '故事', '天气', '几点', '新闻', '翻译'])) {
    return {
      resultType: 'CHAT',
      intent: null,
      confidence: 0.9,
      slots: {},
      requiresConfirm: false,
      speak: '这是一个联网对话类请求，不产生设备控制动作。'
    };
  }

  if (matches(text, ['太冷', '好冷', '强一点', '强暖'])) {
    return control('HEAT_STRONG_ON', 0.9, '已为您打开强暖');
  }

  if (matches(text, ['有点冷', '暖和', '弱暖', '取暖'])) {
    return control('HEAT_WEAK_ON', 0.88, '已为您打开弱暖');
  }

  if (matches(text, ['空气不好', '有味道', '换气', '通风'])) {
    return control('VENTILATION_ON', 0.91, '已为您打开换气');
  }

  if (matches(text, ['净化', '清新'])) {
    return control('PURIFY_ON', 0.91, '已为您打开净化');
  }

  if (matches(text, ['夜灯', '柔和'])) {
    return control('NIGHT_LIGHT_ON', 0.95, '已为您打开夜灯');
  }

  if (matches(text, ['开灯', '照明', '照亮'])) {
    return control('LIGHT_ON', 0.98, '已为您打开照明');
  }

  if (matches(text, ['关灯', '关闭照明'])) {
    return control('LIGHT_OFF', 0.98, '已为您关闭照明');
  }

  if (matches(text, ['干燥', '除湿'])) {
    return control('DRY_ON', 0.93, '已为您打开干燥模式');
  }

  if (matches(text, ['除雾', '镜子看不清', '镜子清晰'])) {
    return control('DEFOG_ON', 0.93, '已为您打开除雾模式');
  }

  if (matches(text, ['洗澡', '沐浴'])) {
    return control('BATH_MODE_ON', 0.92, '已为您打开沐浴模式');
  }

  if (matches(text, ['摆风', '扫风'])) {
    return control('SWING_ON', 0.92, '已为您打开摆风');
  }

  if (matches(text, ['全部关', '关掉', '关闭浴霸', '待机'])) {
    return control('STANDBY', 0.96, '已为您关闭浴霸主要功能');
  }

  const temperatureMatch = text.match(/([3-4][0-9])\s*度/);
  if (temperatureMatch) {
    return {
      resultType: 'DEVICE_CONTROL',
      intent: 'SET_TEMP',
      confidence: 0.95,
      slots: {
        temperature: Number(temperatureMatch[1])
      },
      requiresConfirm: false,
      speak: `已将温度设置为 ${temperatureMatch[1]} 度`
    };
  }

  return {
    resultType: 'NEED_CLARIFY',
    intent: null,
    confidence: 0.45,
    slots: {},
    requiresConfirm: false,
    speak: '请再说明您想控制浴霸的哪个功能。'
  };
}

async function callOpenAICompatible(input: ModelCallInput): Promise<unknown> {
  const apiKey = input.provider.apiKeyEnv ? process.env[input.provider.apiKeyEnv] : undefined;
  if (!apiKey) {
    throw new Error(`Missing API key env: ${input.provider.apiKeyEnv || 'undefined'}`);
  }

  if (!input.provider.baseUrl) {
    throw new Error(`Missing baseUrl for provider ${input.provider.id}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.provider.timeoutMs);

  try {
    const response = await fetch(`${input.provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: input.provider.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: input.prompt.systemPrompt },
          {
            role: 'user',
            content: JSON.stringify({
              inputText: input.inputText,
              deviceState: input.deviceState
            })
          }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Provider ${input.provider.id} returned ${response.status}: ${body}`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`Provider ${input.provider.id} returned empty content`);
    }

    return typeof content === 'string' ? JSON.parse(content) : content;
  } finally {
    clearTimeout(timeout);
  }
}

function parseAiResult(rawResponse: unknown): AiResult {
  const parsed = AiResultSchema.safeParse(rawResponse);
  if (!parsed.success) {
    throw new Error(`Invalid model JSON: ${parsed.error.message}`);
  }

  return parsed.data;
}

function matches(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function control(intent: AiResult['intent'], confidence: number, speak: string): AiResult {
  return {
    resultType: 'DEVICE_CONTROL',
    intent,
    confidence,
    slots: {},
    requiresConfirm: false,
    speak
  };
}
