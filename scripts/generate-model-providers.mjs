import fs from "node:fs";
import path from "node:path";

const outPath = path.join(process.cwd(), "data", "model-providers.json");

function provider(input) {
  return {
    type: "OPENAI_COMPATIBLE",
    serviceType: "LLM",
    protocol: "OPENAI_COMPATIBLE",
    enabled: false,
    timeoutMs: 8000,
    maxOutputTokens: 128,
    inputPricePerMTokens: 0,
    outputPricePerMTokens: 0,
    ...input,
  };
}

function aliyun(input) {
  return provider({
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    apiKeyUrl:
      "https://bailian.console.aliyun.com/cn-beijing/?tab=app#/api-key",
    requestBody: { enable_thinking: false },
    ...input,
  });
}

function qianfan(input) {
  return provider({
    baseUrl: "https://qianfan.baidubce.com/v2",
    apiKeyEnv: "QIANFAN_API_KEY",
    apiKeyUrl: "https://console.bce.baidu.com/qianfan/overview",
    ...input,
  });
}

function volcengine(input) {
  return provider({
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiKeyEnv: "ARK_API_KEY",
    apiKeyUrl: "https://console.volcengine.com/ark/region:cn-beijing/apikey",
    ...input,
  });
}

function zai(input) {
  return provider({
    baseUrl: "https://api.z.ai/api/paas/v4",
    apiKeyEnv: "ZAI_API_KEY",
    apiKeyUrl: "https://z.ai/manage-apikey/apikey-list",
    requestBody: { thinking: { type: "disabled" } },
    ...input,
  });
}

function tencent(input) {
  return provider({
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    apiKeyEnv: "HUNYUAN_API_KEY",
    apiKeyUrl: "https://console.cloud.tencent.com/hunyuan/api-key",
    ...input,
  });
}

function asr(input) {
  return provider({
    serviceType: "ASR",
    protocol: "HTTP_JSON",
    enabled: false,
    inputPricePerMTokens: null,
    outputPricePerMTokens: null,
    maxOutputTokens: 128,
    billingMode: "PER_HOUR",
    averageSecondsPerRequest: 3,
    audioFormat: "webm",
    responseTextPath: "output.text",
    ...input,
  });
}

function tts(input) {
  return provider({
    serviceType: "TTS",
    protocol: "OPENAI_COMPATIBLE",
    enabled: false,
    inputPricePerMTokens: null,
    outputPricePerMTokens: null,
    maxOutputTokens: 128,
    audioFormat: "mp3",
    voice: "longxiaochun_v3",
    averageCharsPerRequest: 50,
    responseAudioPath: "audioBase64",
    responseMimeTypePath: "mimeType",
    ...input,
  });
}

const providers = [
  aliyun({
    id: "aliyun-qwen3-7-flash",
    name: "阿里百炼 Qwen3.7 Flash",
    enabled: true,
    model: "qwen3.7-flash",
    timeoutMs: 6000,
    inputPricePerMTokens: 0.2,
    outputPricePerMTokens: 0.8,
    notes:
      "LLM 主测。低价、响应快，适合浴霸意图识别、50 字内回复和 JSON 结构化输出。",
  }),
  aliyun({
    id: "aliyun-qwen-flash",
    name: "阿里百炼 Qwen Flash",
    enabled: true,
    model: "qwen-flash",
    timeoutMs: 6000,
    inputPricePerMTokens: 0.15,
    outputPricePerMTokens: 1.5,
    notes: "LLM 主测。低成本通用模型，用来验证短句控制、售后问答和简单对话。",
  }),
  aliyun({
    id: "aliyun-qwen-turbo",
    name: "阿里百炼 Qwen Turbo",
    enabled: true,
    model: "qwen-turbo",
    timeoutMs: 6000,
    inputPricePerMTokens: 0.3,
    outputPricePerMTokens: 0.6,
    notes: "LLM 主测。作为低价稳定基线，对比输出稳定性、延迟和单次成本。",
  }),
  volcengine({
    id: "volcengine-doubao-1-5-lite-32k",
    name: "火山方舟 Doubao 1.5 Lite 32K",
    enabled: true,
    model: "doubao-1-5-lite-32k",
    inputPricePerMTokens: 0.3,
    outputPricePerMTokens: 0.6,
    notes:
      "LLM 主测。适合低成本批量语料测试；如控制台要求 Endpoint ID，可把 model 改成对应 ID。",
  }),
  qianfan({
    id: "qianfan-deepseek-v4-flash",
    name: "百度千帆 DeepSeek V4 Flash",
    enabled: true,
    model: "deepseek-v4-flash",
    inputPricePerMTokens: 1,
    outputPricePerMTokens: 2,
    notes:
      "LLM 主测。用于验证千帆托管 DeepSeek 与其他供应商在成功率、延迟、成本上的差异。",
  }),
  zai({
    id: "zai-glm-4-5-flash",
    name: "智谱 Z.AI GLM-4.5 Flash",
    enabled: true,
    model: "glm-4.5-flash",
    inputPricePerMTokens: 0,
    outputPricePerMTokens: 0,
    notes: "LLM 备用。成本下限对照，正式采购前以智谱控制台当前计费为准。",
  }),
  volcengine({
    id: "volcengine-doubao-seed-1-6-flash",
    name: "火山方舟 Doubao Seed 1.6 Flash",
    model: "doubao-seed-1-6-flash-250828",
    inputPricePerMTokens: 0.8,
    outputPricePerMTokens: 8,
    notes: "LLM 备用。质量校准用，输出价高于主测模型，默认不启用。",
  }),
  zai({
    id: "zai-glm-4-5-air",
    name: "智谱 Z.AI GLM-4.5 Air",
    model: "glm-4.5-air",
    inputPricePerMTokens: 1.44,
    outputPricePerMTokens: 7.92,
    notes: "LLM 备用。只用于复杂语料质量对照，不作为低成本主测。",
  }),
  tencent({
    id: "tencent-hunyuan-lite",
    name: "腾讯混元 Lite",
    model: "hunyuan-lite",
    inputPricePerMTokens: 0,
    outputPricePerMTokens: 0,
    notes: "LLM 备用。用于确认腾讯云采购通道和接口稳定性。",
  }),
  asr({
    id: "aliyun-qwen3-asr-flash",
    name: "阿里百炼 Qwen3-ASR-Flash",
    enabled: true,
    protocol: "OPENAI_COMPATIBLE",
    model: "qwen3-asr-flash",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    apiKeyUrl:
      "https://bailian.console.aliyun.com/cn-beijing/?tab=app#/api-key",
    billingMode: "PER_HOUR",
    pricePerHourCny: 0.864,
    averageSecondsPerRequest: 3,
    responseTextPath: "choices.0.message.content",
    notes:
      "ASR 主测。支持浏览器录音 base64 快速验证完整链路；量产成本继续用 Paraformer V2 做低价对照。",
  }),
  asr({
    id: "aliyun-paraformer-v2",
    name: "阿里百炼 Paraformer V2（一句话识别）",
    model: "paraformer-v2",
    baseUrl:
      "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    apiKeyUrl:
      "https://bailian.console.aliyun.com/cn-beijing/?tab=app#/api-key",
    pricePerHourCny: 0.288,
    averageSecondsPerRequest: 3,
    responseTextPath: "output.text",
    notes:
      "ASR 主测。按 3 秒短语音折算约 0.00024 元/次；优先用于量产成本测算。",
  }),
  asr({
    id: "aliyun-paraformer-realtime-v2",
    name: "阿里百炼 Paraformer Realtime V2",
    model: "paraformer-realtime-v2",
    baseUrl: "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    apiKeyUrl:
      "https://bailian.console.aliyun.com/cn-beijing/?tab=app#/api-key",
    pricePerHourCny: 0.864,
    averageSecondsPerRequest: 3,
    responseTextPath: "output.text",
    notes:
      "ASR 备用。流式体验更好，费用高于一句话识别；需要 WebSocket 适配后用于真实语音链路。",
  }),
  asr({
    id: "aliyun-fun-asr-realtime",
    name: "阿里百炼 Fun-ASR Realtime",
    model: "fun-asr-realtime",
    baseUrl: "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    apiKeyUrl:
      "https://bailian.console.aliyun.com/cn-beijing/?tab=app#/api-key",
    pricePerHourCny: 1.188,
    averageSecondsPerRequest: 3,
    responseTextPath: "output.text",
    notes: "ASR 对照。识别体验对照用，成本高于 Paraformer V2，默认不启用。",
  }),
  asr({
    id: "custom-asr-http",
    name: "自定义 ASR（HTTP JSON）",
    model: "your-asr-model",
    baseUrl: null,
    apiKeyEnv: "CUSTOM_ASR_API_KEY",
    apiKeyUrl: null,
    billingMode: "PER_REQUEST",
    pricePerRequestCny: 0,
    pricePerHourCny: 0,
    responseTextPath: "text",
    notes: "ASR 自定义。填写可接收 audioBase64 的 HTTP JSON 接口后启用。",
  }),
  tts({
    id: "aliyun-cosyvoice-v3-flash",
    name: "阿里百炼 CosyVoice V3 Flash",
    enabled: true,
    protocol: "HTTP_JSON",
    model: "cosyvoice-v3-flash",
    baseUrl:
      "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    apiKeyUrl:
      "https://bailian.console.aliyun.com/cn-beijing/?tab=app#/api-key",
    pricePer10KCharsCny: 0.8,
    averageCharsPerRequest: 50,
    responseAudioPath: "output.audio.data",
    notes:
      "TTS 主测。按 50 字回复折算约 0.004 元/次；后续可配合短话术缓存继续降本。",
  }),
  tts({
    id: "aliyun-qwen-audio-3-tts-flash",
    name: "阿里百炼 Qwen Audio 3.0 TTS Flash",
    protocol: "HTTP_JSON",
    model: "qwen-audio-3.0-tts-flash",
    baseUrl:
      "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer",
    apiKeyEnv: "DASHSCOPE_API_KEY",
    apiKeyUrl:
      "https://bailian.console.aliyun.com/cn-beijing/?tab=app#/api-key",
    pricePer10KCharsCny: 1,
    averageCharsPerRequest: 50,
    voice: "longanhuan_v3.6",
    responseAudioPath: "output.audio.data",
    notes: "TTS 备用。用于和 CosyVoice 对比音色、延迟和费用，默认不启用。",
  }),
  tts({
    id: "xfyun-online-tts-package",
    name: "科大讯飞在线 TTS（套餐）",
    protocol: "HTTP_JSON",
    model: "online_tts",
    baseUrl: null,
    apiKeyEnv: "XFYUN_TTS_API_KEY",
    apiKeyUrl: "https://www.xfyun.cn/services/online_tts",
    packageCalls: 500000,
    packagePriceCny: 2000,
    averageCharsPerRequest: 50,
    notes:
      "TTS 采购备选。按已查询套餐口径折算约 0.004 元/次，正式报价以讯飞控制台为准。",
  }),
  tts({
    id: "custom-tts-http",
    name: "自定义 TTS（HTTP JSON）",
    protocol: "HTTP_JSON",
    model: "your-tts-model",
    baseUrl: null,
    apiKeyEnv: "CUSTOM_TTS_API_KEY",
    apiKeyUrl: null,
    packageCalls: 1,
    packagePriceCny: 0,
    averageCharsPerRequest: 50,
    notes: "TTS 自定义。填写返回 audioBase64 的 HTTP JSON 接口后启用。",
  }),
];

fs.writeFileSync(outPath, `${JSON.stringify(providers, null, 2)}\n`, "utf8");
