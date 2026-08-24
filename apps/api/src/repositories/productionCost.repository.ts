import type { ProductionCostSettings } from '@dongxin/shared';
import { ProductionCostSettingsSchema } from '@dongxin/shared';
import { readJsonFile, writeJsonFile } from '../storage.js';

const defaultAsrOfflinePlans: ProductionCostSettings['asr']['offlinePlans'] = [
  {
    id: 'esp32-c3-offline-keyword',
    name: 'ESP32-C3 固定指令 + 云端 ASR',
    architecture: 'HYBRID_CLOUD_ASR',
    chipName: 'ESP32-C3 + ESP-SR MultiNet',
    recognitionType: 'KEYWORD',
    unitHardwareDeltaCny: 0,
    annualServiceCnyPerDevice: 0,
    expectedOfflineRatePercent: 80,
    supportsFreeSpeech: false,
    maturity: 'MATURE',
    sourceUrl: null,
    notes: '只识别唤醒词和预置浴霸指令；复杂语句、闲聊和知识问答进入在线链路。'
  },
  {
    id: 'esp32-s3-psram-offline-general',
    name: 'ESP32-S3 + PSRAM 本地通用 ASR',
    architecture: 'LOCAL_GENERAL_ASR',
    chipName: 'ESP32-S3 + 8MB PSRAM',
    recognitionType: 'GENERAL',
    unitHardwareDeltaCny: 15,
    annualServiceCnyPerDevice: 0,
    expectedOfflineRatePercent: 100,
    supportsFreeSpeech: true,
    maturity: 'VALIDATING',
    sourceUrl: null,
    notes: '需要单独验证模型内存、浴室噪声、持续运行和量产固件稳定性；单台增量为当前可编辑估算。'
  }
];

const defaultProductionCostSettings: ProductionCostSettings = {
  yearDays: 365,
  routing: {
    offlineRatePercent: 80,
    ruleMatchRatePercent: 75,
    knowledgeHitRatePercent: 60,
    ttsResponseRatePercent: 75,
    llmTtsResponseRatePercent: 70,
    ttsCacheHitRatePercent: 95
  },
  development: {
    llmCny: 1500,
    asrCny: 300,
    ttsCny: 300,
    serverCny: 1500,
    miniProgramCny: 500,
    hardwareCny: 2000,
    otherCny: 300
  },
  asr: {
    providerName: '阿里云百炼 fun-asr-realtime',
    pricePerRequestCny: 0.00099,
    averageSecondsPerRequest: 3,
    billingMode: 'PER_HOUR',
    pricePerMinuteCny: 0.0198,
    pricePerHourCny: 1.188,
    modelName: 'fun-asr-realtime',
    sourceUrl: null,
    activeOfflinePlanId: 'esp32-c3-offline-keyword',
    offlinePlans: defaultAsrOfflinePlans
  },
  llm: {
    providerId: 'aliyun-qwen3-7-flash',
    modelName: 'qwen3.7-flash',
    inputPricePerMTokens: 0.2,
    outputPricePerMTokens: 0.8,
    averageInputTokens: 350,
    averageOutputTokens: 60
  },
  tts: {
    providerName: '科大讯飞在线 TTS',
    packageCalls: 500000,
    packagePriceCny: 2000
  },
  fixedAnnual: {
    serverCny: 3000,
    domainSslCny: 300,
    databaseCny: 1500,
    miniProgramCny: 300,
    storageCny: 500
  },
  updatedAt: new Date().toISOString()
};

export async function getProductionCostSettings(): Promise<ProductionCostSettings> {
  const settings = await readJsonFile<ProductionCostSettings>(
    'production-cost-settings.json',
    defaultProductionCostSettings
  );
  const parsed = ProductionCostSettingsSchema.parse(settings);
  return {
    ...parsed,
    asr: {
      ...parsed.asr,
      offlinePlans: parsed.asr.offlinePlans.length ? parsed.asr.offlinePlans : defaultAsrOfflinePlans
    }
  };
}

export async function saveProductionCostSettings(
  settings: ProductionCostSettings
): Promise<ProductionCostSettings> {
  const parsed = ProductionCostSettingsSchema.parse(settings);
  await writeJsonFile('production-cost-settings.json', parsed);
  return parsed;
}
