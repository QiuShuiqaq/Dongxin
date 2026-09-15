import type { ProductionCostSettings } from '@dongxin/shared';
import { ProductionCostSettingsSchema } from '@dongxin/shared';
import { readJsonFile, writeJsonFile } from '../storage.js';

const defaultAsrOfflinePlans: ProductionCostSettings['asr']['offlinePlans'] = [
  {
    id: 'esp32-c3-ci1302',
    name: 'ESP32-C3 + CI1302 + 3 x PCF8574',
    architecture: 'HYBRID_CLOUD_ASR',
    chipName: 'ESP32-C3 + CI1302 + 3 x PCF8574',
    recognitionType: 'KEYWORD',
    unitHardwareDeltaCny: 0,
    annualServiceCnyPerDevice: 0,
    expectedOfflineRatePercent: 80,
    supportsFreeSpeech: false,
    maturity: 'MATURE',
    sourceUrl: null,
    notes:
      '当前量产基线。CI1302负责唤醒、离线固定命令和音频前端；C3负责在线音频、MQTT、BLE本地控制与全部设备控制；三颗PCF8574提供24路低速IO。实际BOM由东信报价回填。'
  },
  {
    id: 'esp32-s3-ci1302',
    name: 'ESP32-S3 + CI1302 + IO扩展',
    architecture: 'HYBRID_CLOUD_ASR',
    chipName: 'ESP32-S3-N16R8 + CI1302 + 3 x PCF8574',
    recognitionType: 'KEYWORD',
    unitHardwareDeltaCny: 15,
    annualServiceCnyPerDevice: 0,
    expectedOfflineRatePercent: 80,
    supportsFreeSpeech: false,
    maturity: 'VALIDATING',
    sourceUrl: null,
    notes:
      '保持同一CI语音和控制架构，仅在C3资源或稳定性不达标时对照。15元为旧估算占位，必须按真实BOM更新后再决策。'
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
    activeOfflinePlanId: 'esp32-c3-ci1302',
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
      offlinePlans: parsed.asr.offlinePlans.length
        ? parsed.asr.offlinePlans
        : defaultAsrOfflinePlans
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
