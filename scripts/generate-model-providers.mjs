import fs from 'node:fs';
import path from 'node:path';

const outPath = path.join(process.cwd(), 'data', 'model-providers.json');

function provider(input) {
  return {
    type: 'OPENAI_COMPATIBLE',
    enabled: false,
    timeoutMs: 8000,
    inputPricePerMTokens: 0,
    outputPricePerMTokens: 0,
    ...input
  };
}

function aliyun(input) {
  return provider({
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    apiKeyUrl: 'https://bailian.console.aliyun.com/cn-beijing/?tab=app#/api-key',
    requestBody: { enable_thinking: false },
    ...input
  });
}

function qianfan(input) {
  return provider({
    baseUrl: 'https://qianfan.baidubce.com/v2',
    apiKeyEnv: 'QIANFAN_API_KEY',
    apiKeyUrl: 'https://console.bce.baidu.com/qianfan/overview',
    ...input
  });
}

function deepseek(input) {
  return provider({
    baseUrl: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    requestBody: { thinking: { type: 'disabled' } },
    ...input
  });
}

function volcengine(input) {
  return provider({
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyEnv: 'ARK_API_KEY',
    apiKeyUrl: 'https://console.volcengine.com/ark/region:cn-beijing/apikey',
    ...input
  });
}

function zai(input) {
  return provider({
    baseUrl: 'https://api.z.ai/api/paas/v4',
    apiKeyEnv: 'ZAI_API_KEY',
    apiKeyUrl: 'https://z.ai/manage-apikey/apikey-list',
    requestBody: { thinking: { type: 'disabled' } },
    ...input
  });
}

function tencent(input) {
  return provider({
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    apiKeyEnv: 'HUNYUAN_API_KEY',
    apiKeyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
    ...input
  });
}

function moonshot(input) {
  return provider({
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
    ...input
  });
}

const providers = [
  aliyun({
    id: 'aliyun-qwen3-7-flash',
    name: '阿里百炼 Qwen3.7 Flash',
    enabled: true,
    model: 'qwen3.7-flash',
    timeoutMs: 6000,
    inputPricePerMTokens: 0.2,
    outputPricePerMTokens: 0.8,
    notes: '首批主测低价模型。适合测试浴霸意图理解、JSON 稳定性和单次成本。'
  }),
  aliyun({
    id: 'aliyun-qwen3-5-flash',
    name: '阿里百炼 Qwen3.5 Flash',
    enabled: true,
    model: 'qwen3.5-flash',
    timeoutMs: 6000,
    inputPricePerMTokens: 0.2,
    outputPricePerMTokens: 2,
    notes: '轻量低价版本，适合大量简单语料。'
  }),
  aliyun({
    id: 'aliyun-qwen-flash',
    name: '阿里百炼 Qwen Flash',
    enabled: true,
    model: 'qwen-flash',
    timeoutMs: 6000,
    inputPricePerMTokens: 0.15,
    outputPricePerMTokens: 1.5,
    notes: '低成本通用对照，适合单轮短回复测试。'
  }),
  aliyun({
    id: 'aliyun-qwen-turbo',
    name: '阿里百炼 Qwen Turbo',
    enabled: true,
    model: 'qwen-turbo',
    timeoutMs: 6000,
    inputPricePerMTokens: 0.3,
    outputPricePerMTokens: 0.6,
    notes: '低价稳定基线，用来对比输出稳定性、延迟和成本。'
  }),
  aliyun({
    id: 'aliyun-qwen-long',
    name: '阿里百炼 Qwen Long',
    model: 'qwen-long',
    timeoutMs: 7000,
    inputPricePerMTokens: 0.5,
    outputPricePerMTokens: 2,
    notes: '长上下文备选，便于后续企业知识库联调。'
  }),
  aliyun({
    id: 'aliyun-qwen-plus',
    name: '阿里百炼 Qwen Plus',
    model: 'qwen-plus',
    timeoutMs: 7000,
    inputPricePerMTokens: 0.8,
    outputPricePerMTokens: 2,
    notes: '中低成本通用模型，用来校准复杂语料准确率。'
  }),
  qianfan({
    id: 'qianfan-deepseek-v4-flash',
    name: '百度千帆 DeepSeek V4 Flash',
    enabled: true,
    model: 'deepseek-v4-flash',
    inputPricePerMTokens: 1,
    outputPricePerMTokens: 2,
    notes: '千帆托管版本，和 DeepSeek 官方直连对比成功率、延迟和成本。'
  }),
  qianfan({
    id: 'qianfan-ernie-lite-8k',
    name: '百度千帆 ERNIE Lite 8K',
    model: 'ernie-lite-8k',
    inputPricePerMTokens: 3,
    outputPricePerMTokens: 6,
    notes: '百度自研低价基础模型，用于供应商多样性对照。'
  }),
  qianfan({
    id: 'qianfan-ernie-speed-8k',
    name: '百度千帆 ERNIE Speed 8K',
    model: 'ernie-speed-8k',
    inputPricePerMTokens: 4,
    outputPricePerMTokens: 8,
    notes: '百度自研速度型模型，用于延迟和稳定性对照。'
  }),
  deepseek({
    id: 'deepseek-official-v4-flash',
    name: 'DeepSeek 官方 V4 Flash',
    enabled: true,
    model: 'deepseek-v4-flash',
    inputPricePerMTokens: 3.17,
    outputPricePerMTokens: 9.5,
    notes: '官方直连对照项。价格按官方峰值美元价折算为人民币，实际以控制台为准。'
  }),
  deepseek({
    id: 'deepseek-official-chat',
    name: 'DeepSeek 官方 Chat',
    enabled: true,
    model: 'deepseek-chat',
    inputPricePerMTokens: 3.17,
    outputPricePerMTokens: 9.5,
    notes: '官方 Chat 接口别名对照，便于确认不同模型 ID 的兼容性。'
  }),
  volcengine({
    id: 'volcengine-doubao-seed-1-6-flash',
    name: '火山方舟 Doubao Seed 1.6 Flash',
    enabled: true,
    model: 'doubao-seed-1-6-flash-250828',
    inputPricePerMTokens: 0.8,
    outputPricePerMTokens: 8,
    notes: '豆包低价主测项。如控制台使用 Endpoint ID，可把 model 改成对应 Endpoint ID。'
  }),
  volcengine({
    id: 'volcengine-doubao-1-5-lite-32k',
    name: '火山方舟 Doubao 1.5 Lite 32K',
    enabled: true,
    model: 'doubao-1-5-lite-32k',
    inputPricePerMTokens: 0.3,
    outputPricePerMTokens: 0.6,
    notes: '豆包低成本对照项，适合短句意图识别和低成本批测。'
  }),
  volcengine({
    id: 'volcengine-doubao-1-5-pro-32k',
    name: '火山方舟 Doubao 1.5 Pro 32K',
    model: 'doubao-1-5-pro-32k',
    inputPricePerMTokens: 0.8,
    outputPricePerMTokens: 2,
    notes: '豆包中档对照项，适合复杂语料稳定性评估。'
  }),
  zai({
    id: 'zai-glm-4-7-flash',
    name: '智谱 Z.AI GLM-4.7 Flash',
    enabled: true,
    model: 'glm-4.7-flash',
    inputPricePerMTokens: 0,
    outputPricePerMTokens: 0,
    notes: '成本下限对照模型。正式采购前以智谱控制台当前计费为准。'
  }),
  zai({
    id: 'zai-glm-4-5-flash',
    name: '智谱 Z.AI GLM-4.5 Flash',
    enabled: true,
    model: 'glm-4.5-flash',
    inputPricePerMTokens: 0,
    outputPricePerMTokens: 0,
    notes: '免费档低成本对照，适合基础输出格式测试。'
  }),
  zai({
    id: 'zai-glm-4-5-air',
    name: '智谱 Z.AI GLM-4.5 Air',
    enabled: true,
    model: 'glm-4.5-air',
    inputPricePerMTokens: 1.44,
    outputPricePerMTokens: 7.92,
    notes: '成本控制版本，适合日常交互对照。'
  }),
  tencent({
    id: 'tencent-hunyuan-lite',
    name: '腾讯混元 Lite',
    enabled: true,
    model: 'hunyuan-lite',
    inputPricePerMTokens: 0,
    outputPricePerMTokens: 0,
    notes: '腾讯云低成本对照项，适合确认企业采购通道和接口稳定性。'
  }),
  tencent({
    id: 'tencent-hunyuan-standard',
    name: '腾讯混元 Standard',
    model: 'hunyuan-standard',
    inputPricePerMTokens: 4.5,
    outputPricePerMTokens: 18,
    notes: '腾讯云标准档对照，用于复杂语料准确率校准。'
  }),
  moonshot({
    id: 'moonshot-v1-8k',
    name: '月之暗面 Moonshot v1 8K',
    model: 'moonshot-v1-8k',
    inputPricePerMTokens: 12,
    outputPricePerMTokens: 12,
    notes: 'Kimi 短上下文对照项，价格较高，默认不作为低成本主测。'
  })
];

if (providers.length !== 20) {
  throw new Error(`Expected 20 providers, got ${providers.length}`);
}

fs.writeFileSync(outPath, `${JSON.stringify(providers, null, 2)}\n`, 'utf8');
