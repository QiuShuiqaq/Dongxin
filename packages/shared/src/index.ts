import { z } from "zod";

export const DEVICE_INTENTS = [
  "LIGHT_ON",
  "LIGHT_OFF",
  "NIGHT_LIGHT_ON",
  "NIGHT_LIGHT_OFF",
  "HEAT_WEAK_ON",
  "HEAT_WEAK_OFF",
  "HEAT_STRONG_ON",
  "HEAT_STRONG_OFF",
  "FAN_ON",
  "FAN_OFF",
  "VENTILATION_ON",
  "VENTILATION_OFF",
  "SWING_ON",
  "SWING_OFF",
  "PURIFY_ON",
  "PURIFY_OFF",
  "DRY_ON",
  "DRY_OFF",
  "DEFOG_ON",
  "DEFOG_OFF",
  "BATH_MODE_ON",
  "BATH_MODE_OFF",
  "CONSTANT_TEMP_ON",
  "CONSTANT_TEMP_OFF",
  "SET_TEMP",
  "VOLUME_UP",
  "VOLUME_DOWN",
  "VOICE_BROADCAST_ON",
  "VOICE_BROADCAST_OFF",
  "STANDBY",
  "SET_TIMER",
] as const;

export const DeviceIntentSchema = z.enum(DEVICE_INTENTS);
export type DeviceIntent = z.infer<typeof DeviceIntentSchema>;

export const ResultTypeSchema = z.enum([
  "DEVICE_CONTROL",
  "CHAT",
  "NEED_CLARIFY",
  "REJECT",
  "NO_ACTION",
]);
export type ResultType = z.infer<typeof ResultTypeSchema>;

export const SafetyDecisionSchema = z.enum([
  "APPROVED",
  "REJECTED",
  "NEEDS_CONFIRMATION",
  "NO_ACTION",
]);
export type SafetyDecision = z.infer<typeof SafetyDecisionSchema>;

export const ProviderServiceTypeSchema = z.enum(["LLM", "ASR", "TTS"]);
export type ProviderServiceType = z.infer<typeof ProviderServiceTypeSchema>;

export const ProviderProtocolSchema = z.enum([
  "OPENAI_COMPATIBLE",
  "HTTP_JSON",
]);
export type ProviderProtocol = z.infer<typeof ProviderProtocolSchema>;

export const AsrBillingModeSchema = z.enum([
  "PER_REQUEST",
  "PER_MINUTE",
  "PER_HOUR",
  "NONE",
]);
export type AsrBillingMode = z.infer<typeof AsrBillingModeSchema>;

export const ModelProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["MOCK", "OPENAI_COMPATIBLE"]),
  serviceType: ProviderServiceTypeSchema.default("LLM"),
  protocol: ProviderProtocolSchema.default("OPENAI_COMPATIBLE"),
  enabled: z.boolean(),
  model: z.string().min(1),
  baseUrl: z.string().nullable().optional(),
  apiKeyEnv: z.string().nullable().optional(),
  apiKeyUrl: z.string().url().nullable().optional(),
  timeoutMs: z.number().int().positive().default(8000),
  maxOutputTokens: z.number().int().positive().max(1024).default(128),
  inputPricePerMTokens: z.number().nullable().optional(),
  outputPricePerMTokens: z.number().nullable().optional(),
  billingMode: AsrBillingModeSchema.optional(),
  pricePerRequestCny: z.number().nonnegative().optional(),
  pricePerMinuteCny: z.number().nonnegative().optional(),
  pricePerHourCny: z.number().nonnegative().optional(),
  packageCalls: z.number().int().positive().optional(),
  packagePriceCny: z.number().nonnegative().optional(),
  pricePer10KCharsCny: z.number().nonnegative().optional(),
  averageCharsPerRequest: z.number().positive().optional(),
  averageSecondsPerRequest: z.number().positive().optional(),
  voice: z.string().optional(),
  audioFormat: z.string().optional(),
  responseTextPath: z.string().optional(),
  responseAudioPath: z.string().optional(),
  responseMimeTypePath: z.string().optional(),
  requestBody: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().optional(),
});
export type ModelProvider = z.infer<typeof ModelProviderSchema>;

export const ModelTokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  costCny: z.number().nullable(),
  isEstimated: z.boolean(),
});
export type ModelTokenUsage = z.infer<typeof ModelTokenUsageSchema>;

export const AsrOfflinePlanSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  architecture: z
    .enum(["HYBRID_CLOUD_ASR", "LOCAL_GENERAL_ASR"])
    .default("HYBRID_CLOUD_ASR"),
  chipName: z.string().min(1),
  recognitionType: z.enum(["KEYWORD", "GENERAL"]),
  unitHardwareDeltaCny: z.number().nonnegative(),
  annualServiceCnyPerDevice: z.number().nonnegative(),
  expectedOfflineRatePercent: z.number().min(0).max(100),
  supportsFreeSpeech: z.boolean(),
  maturity: z.enum(["MATURE", "VALIDATING", "HIGH_RISK"]),
  sourceUrl: z.string().url().nullable().optional(),
  notes: z.string().default(""),
});
export type AsrOfflinePlan = z.infer<typeof AsrOfflinePlanSchema>;

export const ProductionCostSettingsSchema = z.object({
  yearDays: z.number().int().positive().default(365),
  routing: z.object({
    offlineRatePercent: z.number().min(0).max(100),
    ruleMatchRatePercent: z.number().min(0).max(100),
    knowledgeHitRatePercent: z.number().min(0).max(100).default(50),
    ttsResponseRatePercent: z.number().min(0).max(100),
    llmTtsResponseRatePercent: z.number().min(0).max(100).default(80),
    ttsCacheHitRatePercent: z.number().min(0).max(100),
  }),
  development: z.object({
    llmCny: z.number().nonnegative(),
    asrCny: z.number().nonnegative(),
    ttsCny: z.number().nonnegative(),
    serverCny: z.number().nonnegative(),
    miniProgramCny: z.number().nonnegative(),
    hardwareCny: z.number().nonnegative(),
    otherCny: z.number().nonnegative(),
  }),
  asr: z.object({
    providerName: z.string().min(1),
    pricePerRequestCny: z.number().nonnegative(),
    averageSecondsPerRequest: z.number().positive(),
    billingMode: AsrBillingModeSchema.default("PER_REQUEST"),
    pricePerMinuteCny: z.number().nonnegative().default(0),
    pricePerHourCny: z.number().nonnegative().default(0),
    modelName: z.string().default(""),
    sourceUrl: z.string().url().nullable().optional(),
    activeOfflinePlanId: z.string().default("esp32-c3-offline-keyword"),
    offlinePlans: z.array(AsrOfflinePlanSchema).default([]),
  }),
  llm: z.object({
    providerId: z.string().min(1),
    modelName: z.string().min(1),
    inputPricePerMTokens: z.number().nonnegative(),
    outputPricePerMTokens: z.number().nonnegative(),
    averageInputTokens: z.number().int().nonnegative(),
    averageOutputTokens: z.number().int().nonnegative(),
  }),
  tts: z.object({
    providerName: z.string().min(1),
    packageCalls: z.number().int().positive(),
    packagePriceCny: z.number().nonnegative(),
  }),
  fixedAnnual: z.object({
    serverCny: z.number().nonnegative(),
    domainSslCny: z.number().nonnegative(),
    databaseCny: z.number().nonnegative(),
    miniProgramCny: z.number().nonnegative(),
    storageCny: z.number().nonnegative(),
  }),
  updatedAt: z.string(),
});
export type ProductionCostSettings = z.infer<
  typeof ProductionCostSettingsSchema
>;

export const ProviderSecretStatusSchema = z.object({
  providerId: z.string().min(1),
  apiKeyEnv: z.string().nullable(),
  isConfigured: z.boolean(),
});
export type ProviderSecretStatus = z.infer<typeof ProviderSecretStatusSchema>;

export const SaveProviderApiKeyRequestSchema = z.object({
  apiKey: z.string().trim().min(1, "API Key 不能为空"),
});
export type SaveProviderApiKeyRequest = z.infer<
  typeof SaveProviderApiKeyRequestSchema
>;

export const PromptVersionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().positive(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
  createdAt: z.string(),
  systemPrompt: z.string().min(1),
});
export type PromptVersion = z.infer<typeof PromptVersionSchema>;

export const TestCaseSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  inputText: z.string().min(1),
  expectedIntent: DeviceIntentSchema.nullable(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
  notes: z.string().optional(),
});
export type TestCase = z.infer<typeof TestCaseSchema>;

export const TestSetKindSchema = z.enum([
  "STANDARD",
  "SIMPLE",
  "COMPLEX",
  "CUSTOM",
]);
export type TestSetKind = z.infer<typeof TestSetKindSchema>;

export const TestSetSourceSchema = z.enum(["SYSTEM", "MANUAL", "MD_IMPORT"]);
export type TestSetSource = z.infer<typeof TestSetSourceSchema>;

export const TestSetSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: TestSetKindSchema,
  description: z.string().default(""),
  source: TestSetSourceSchema,
  isReadOnly: z.boolean().default(false),
  caseCount: z.number().int().nonnegative(),
  categoryBreakdown: z
    .record(z.string(), z.number().int().nonnegative())
    .default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TestSetSummary = z.infer<typeof TestSetSummarySchema>;

export const TestSetSchema = TestSetSummarySchema.extend({
  cases: z.array(TestCaseSchema),
});
export type TestSet = z.infer<typeof TestSetSchema>;

export const CreateTestSetRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  kind: TestSetKindSchema.default("CUSTOM"),
});
export type CreateTestSetRequest = z.infer<typeof CreateTestSetRequestSchema>;

export const UpdateTestSetRequestSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});
export type UpdateTestSetRequest = z.infer<typeof UpdateTestSetRequestSchema>;

export const CreateTestCaseRequestSchema = z.object({
  id: z.string().min(1).optional(),
  category: z.string().min(1),
  inputText: z.string().min(1),
  expectedIntent: DeviceIntentSchema.nullable().default(null),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).default("LOW"),
  notes: z.string().optional(),
});
export type CreateTestCaseRequest = z.infer<typeof CreateTestCaseRequestSchema>;

export const UpdateTestCaseRequestSchema = z.object({
  category: z.string().min(1).optional(),
  inputText: z.string().min(1).optional(),
  expectedIntent: DeviceIntentSchema.nullable().optional(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  notes: z.string().optional(),
});
export type UpdateTestCaseRequest = z.infer<typeof UpdateTestCaseRequestSchema>;

export const ImportTestSetMarkdownRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  markdown: z.string().min(1),
  kind: TestSetKindSchema.default("CUSTOM"),
});
export type ImportTestSetMarkdownRequest = z.infer<
  typeof ImportTestSetMarkdownRequestSchema
>;

export const DeviceStateSchema = z.object({
  isOnline: z.boolean(),
  activeModes: z.array(DeviceIntentSchema),
  targetTemperature: z.number().int().min(30).max(45),
  ambientTemperature: z.number(),
  humidity: z.number().min(0).max(100).nullable().optional(),
  hasOccupancy: z.boolean(),
  voiceBroadcastEnabled: z.boolean(),
  faultCode: z.string().nullable(),
  updatedAt: z.string(),
});
export type DeviceState = z.infer<typeof DeviceStateSchema>;

export const AiResultSchema = z.object({
  resultType: ResultTypeSchema,
  intent: DeviceIntentSchema.nullable(),
  confidence: z.number().min(0).max(1),
  slots: z
    .object({
      temperature: z.number().int().nullable().optional(),
      durationMinutes: z.number().int().positive().nullable().optional(),
    })
    .passthrough()
    .default({}),
  requiresConfirm: z.boolean().default(false),
  speak: z.string().default(""),
});
export type AiResult = z.infer<typeof AiResultSchema>;

export const SafetyResultSchema = z.object({
  decision: SafetyDecisionSchema,
  commands: z.array(DeviceIntentSchema),
  reason: z.string(),
  speak: z.string(),
});
export type SafetyResult = z.infer<typeof SafetyResultSchema>;

export const EvaluationProviderSummarySchema = z.object({
  providerId: z.string().min(1),
  providerName: z.string().min(1),
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1),
  jsonValid: z.number().int().nonnegative(),
  clarifyCount: z.number().int().nonnegative(),
  rejectCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  costCny: z.number().nonnegative(),
  averageLatencyMs: z.number().nonnegative(),
  p95LatencyMs: z.number().nonnegative(),
});
export type EvaluationProviderSummary = z.infer<
  typeof EvaluationProviderSummarySchema
>;

export const EvaluationSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  jsonValid: z.number().int().nonnegative(),
  clarifyCount: z.number().int().nonnegative(),
  rejectCount: z.number().int().nonnegative(),
  averageLatencyMs: z.number().nonnegative(),
  p95LatencyMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  costCny: z.number().nonnegative(),
  estimatedCostCny: z.number().nonnegative(),
  providerSummaries: z.array(EvaluationProviderSummarySchema),
});
export type EvaluationSummary = z.infer<typeof EvaluationSummarySchema>;

export const EvaluationItemSchema = z.object({
  testCaseId: z.string(),
  providerId: z.string(),
  inputText: z.string(),
  expectedIntent: DeviceIntentSchema.nullable(),
  aiResult: AiResultSchema.nullable(),
  safetyResult: SafetyResultSchema.nullable(),
  isMatch: z.boolean(),
  latencyMs: z.number(),
  usage: ModelTokenUsageSchema.nullable(),
  error: z.string().nullable(),
});
export type EvaluationItem = z.infer<typeof EvaluationItemSchema>;

export const EvaluationRunSchema = z.object({
  id: z.string(),
  source: z.literal("EVALUATION").default("EVALUATION"),
  promptId: z.string(),
  testSetId: z.string(),
  testSetName: z.string(),
  providerIds: z.array(z.string()),
  startedAt: z.string(),
  completedAt: z.string(),
  summary: EvaluationSummarySchema,
  items: z.array(EvaluationItemSchema),
});
export type EvaluationRun = z.infer<typeof EvaluationRunSchema>;

export const DeviceProtocolSchema = z.enum(["SIMULATOR", "HTTP", "MQTT"]);
export type DeviceProtocol = z.infer<typeof DeviceProtocolSchema>;

export const DeviceStatusSchema = z.enum(["ONLINE", "OFFLINE", "FAULT"]);
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;

export const DeviceProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  model: z.string().min(1),
  firmwareVersion: z.string().nullable().optional(),
  protocol: DeviceProtocolSchema,
  status: DeviceStatusSchema,
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DeviceProfile = z.infer<typeof DeviceProfileSchema>;

export const DeviceEventTypeSchema = z.enum([
  "STATE_REPORT",
  "OCCUPANCY",
  "RADAR",
  "FAULT",
  "VOICE",
  "COMMAND_RESULT",
]);
export type DeviceEventType = z.infer<typeof DeviceEventTypeSchema>;

export const DeviceEventSchema = z.object({
  id: z.string(),
  deviceId: z.string().min(1),
  type: DeviceEventTypeSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
});
export type DeviceEvent = z.infer<typeof DeviceEventSchema>;

export const DeviceCommandStatusSchema = z.enum([
  "QUEUED",
  "APPLIED",
  "REJECTED",
  "NEEDS_CONFIRMATION",
  "FAILED",
]);
export type DeviceCommandStatus = z.infer<typeof DeviceCommandStatusSchema>;

export const DeviceCommandRecordSchema = z.object({
  id: z.string(),
  deviceId: z.string().min(1),
  intent: DeviceIntentSchema,
  slots: z.record(z.string(), z.unknown()).default({}),
  status: DeviceCommandStatusSchema,
  safetyDecision: SafetyDecisionSchema.nullable().optional(),
  speak: z.string().optional(),
  createdAt: z.string(),
  completedAt: z.string().nullable().optional(),
});
export type DeviceCommandRecord = z.infer<typeof DeviceCommandRecordSchema>;

export const DeviceActionCodeSchema = z.enum([
  "light",
  "heater",
  "ventilation",
  "fan",
  "swing",
  "dry",
  "bath",
  "constantTemperature",
  "standby",
  "temperature",
  "timer",
  "network",
]);
export type DeviceActionCode = z.infer<typeof DeviceActionCodeSchema>;

export const DeviceActionSchema = z.object({
  commandId: z.string().optional(),
  code: DeviceActionCodeSchema,
  value: z.string().min(1),
  durationMinutes: z.number().int().positive().max(120).nullable().optional(),
  targetTemperature: z.number().int().min(30).max(45).nullable().optional(),
});
export type DeviceAction = z.infer<typeof DeviceActionSchema>;

export const DeviceCloudStateSchema = z.object({
  isOnline: z.boolean().optional(),
  power: z.enum(["on", "off"]).optional(),
  light: z.enum(["on", "off"]).optional(),
  heater: z.enum(["off", "weak", "strong"]).optional(),
  ventilation: z.enum(["on", "off"]).optional(),
  fan: z.enum(["on", "off"]).optional(),
  swing: z.enum(["on", "off"]).optional(),
  dry: z.enum(["on", "off"]).optional(),
  bathMode: z.enum(["on", "off"]).optional(),
  constantTemperature: z.enum(["on", "off"]).optional(),
  targetTemperature: z.number().int().min(0).max(80).nullable().optional(),
  ambientTemperature: z.number().nullable().optional(),
  humidity: z.number().min(0).max(100).nullable().optional(),
  hasOccupancy: z.boolean().nullable().optional(),
  faultCode: z.string().nullable().optional(),
  runningMinutes: z.number().int().min(0).nullable().optional(),
});
export type DeviceCloudState = z.infer<typeof DeviceCloudStateSchema>;

export const DeviceRegisterRequestSchema = z.object({
  deviceId: z.string().min(1),
  model: z.string().min(1),
  firmwareVersion: z.string().nullable().optional(),
  protocolVersion: z.string().min(1).default("0.1"),
  capabilities: z.record(z.string(), z.boolean()).default({}),
});
export type DeviceRegisterRequest = z.infer<typeof DeviceRegisterRequestSchema>;

export const DeviceHeartbeatRequestSchema = z.object({
  deviceId: z.string().min(1),
  firmwareVersion: z.string().nullable().optional(),
  network: z
    .object({
      rssi: z.number().nullable().optional(),
      ip: z.string().nullable().optional(),
    })
    .optional(),
});
export type DeviceHeartbeatRequest = z.infer<
  typeof DeviceHeartbeatRequestSchema
>;

export const DeviceStateReportRequestSchema = z.object({
  deviceId: z.string().min(1),
  reportedAt: z.string().optional(),
  state: DeviceCloudStateSchema,
});
export type DeviceStateReportRequest = z.infer<
  typeof DeviceStateReportRequestSchema
>;

export const DeviceAccessEventTypeSchema = z.enum([
  "OCCUPANCY_ENTER",
  "OCCUPANCY_LEAVE",
  "OCCUPANCY_STAY",
  "LOW_TEMPERATURE",
  "HIGH_HUMIDITY",
  "LONG_RUNNING",
  "FAULT",
  "COMMAND_RESULT",
]);
export type DeviceAccessEventType = z.infer<typeof DeviceAccessEventTypeSchema>;

export const DeviceAccessEventRequestSchema = z.object({
  deviceId: z.string().min(1),
  eventId: z.string().min(1).optional(),
  eventType: DeviceAccessEventTypeSchema,
  occurredAt: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type DeviceAccessEventRequest = z.infer<
  typeof DeviceAccessEventRequestSchema
>;

export const DeviceAccessVoiceTurnRequestSchema = z.object({
  deviceId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  text: z.string().trim().min(1),
  asrConfidence: z.number().min(0).max(1).nullable().optional(),
  confirmToken: z.string().min(1).optional(),
  reportedState: DeviceCloudStateSchema.optional(),
});
export type DeviceAccessVoiceTurnRequest = z.infer<
  typeof DeviceAccessVoiceTurnRequestSchema
>;

export const DeviceCommandResultRequestSchema = z.object({
  deviceId: z.string().min(1),
  commandId: z.string().min(1),
  status: z.enum(["success", "failed", "rejected", "timeout"]),
  executedAt: z.string().optional(),
  mcuFrame: z.string().optional(),
  executionPath: z.string().min(1).optional(),
  message: z.string().optional(),
  state: DeviceCloudStateSchema.optional(),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .optional(),
});
export type DeviceCommandResultRequest = z.infer<
  typeof DeviceCommandResultRequestSchema
>;

export const VoiceTurnRequestSchema = z.object({
  deviceId: z.string().min(1).default("demo-bath-heater-001"),
  sessionId: z.string().min(1).optional(),
  providerId: z.string().min(1),
  promptId: z.string().min(1).optional(),
  text: z.string().min(1),
  asrConfidence: z.number().min(0).max(1).nullable().optional(),
  applyToDevice: z.boolean().default(true),
});
export type VoiceTurnRequest = z.infer<typeof VoiceTurnRequestSchema>;

export const VoiceTurnResponseSchema = z.object({
  sessionId: z.string(),
  replyText: z.string(),
  aiResult: AiResultSchema,
  safetyResult: SafetyResultSchema,
  deviceState: DeviceStateSchema,
  commandRecord: DeviceCommandRecordSchema.nullable(),
});
export type VoiceTurnResponse = z.infer<typeof VoiceTurnResponseSchema>;

export const VoicePipelineInputSourceSchema = z.enum([
  "TEXT_SIMULATION",
  "BROWSER_AUDIO",
  "DEVICE_AUDIO",
  "DEVICE_TEXT",
]);
export type VoicePipelineInputSource = z.infer<
  typeof VoicePipelineInputSourceSchema
>;

export const VoicePipelineRouteSchema = z.enum([
  "OFFLINE",
  "ONLINE_RULE",
  "KNOWLEDGE",
  "LLM",
  "UNRESOLVED",
]);
export type VoicePipelineRoute = z.infer<typeof VoicePipelineRouteSchema>;

export const VoicePipelineStageKeySchema = z.enum([
  "INPUT",
  "WAKE_WORD",
  "OFFLINE_INTENT",
  "ASR",
  "ONLINE_RULE",
  "KNOWLEDGE",
  "LLM",
  "SAFETY",
  "TTS",
  "DEVICE",
]);
export type VoicePipelineStageKey = z.infer<typeof VoicePipelineStageKeySchema>;

export const VoicePipelineStageStatusSchema = z.enum([
  "COMPLETED",
  "MATCHED",
  "SKIPPED",
  "NOT_CONFIGURED",
  "FAILED",
]);
export type VoicePipelineStageStatus = z.infer<
  typeof VoicePipelineStageStatusSchema
>;

export const VoicePipelineStageSchema = z.object({
  key: VoicePipelineStageKeySchema,
  label: z.string(),
  status: VoicePipelineStageStatusSchema,
  source: z.string().nullable(),
  result: z.string().default(""),
  detail: z.record(z.string(), z.unknown()).default({}),
  latencyMs: z.number().nonnegative(),
  costCny: z.number().nonnegative(),
  error: z.string().nullable(),
});
export type VoicePipelineStage = z.infer<typeof VoicePipelineStageSchema>;

export const VoicePipelineCostSchema = z.object({
  asrCny: z.number().nonnegative(),
  llmCny: z.number().nonnegative(),
  ttsCny: z.number().nonnegative(),
  totalCny: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  isEstimated: z.boolean(),
});
export type VoicePipelineCost = z.infer<typeof VoicePipelineCostSchema>;

export const VoicePipelineRequestSchema = z
  .object({
    deviceId: z.string().min(1).default("demo-bath-heater-001"),
    inputSource: VoicePipelineInputSourceSchema.default("TEXT_SIMULATION"),
    text: z.string().trim().optional(),
    audioBase64: z.string().min(1).optional(),
    mimeType: z.string().min(1).default("audio/webm"),
    providerId: z.string().min(1).optional(),
    asrProviderId: z.string().min(1).optional(),
    ttsProviderId: z.string().min(1).optional(),
    promptId: z.string().min(1).optional(),
    applyToDevice: z.boolean().default(false),
    simulateOffline: z.enum(["AUTO", "HIT", "MISS"]).default("AUTO"),
  })
  .superRefine((value, context) => {
    const hasText = Boolean(value.text?.trim());
    const hasAudio = Boolean(value.audioBase64);
    if (!hasText && !hasAudio) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["text"],
        message: "text or audioBase64 is required",
      });
    }
  });
export type VoicePipelineRequest = z.infer<typeof VoicePipelineRequestSchema>;

export const VoicePipelineResponseSchema = z.object({
  sessionId: z.string(),
  inputSource: VoicePipelineInputSourceSchema,
  transcript: z.string().nullable(),
  replyText: z.string(),
  route: VoicePipelineRouteSchema,
  stages: z.array(VoicePipelineStageSchema),
  aiResult: AiResultSchema,
  safetyResult: SafetyResultSchema,
  deviceState: DeviceStateSchema,
  commandRecord: DeviceCommandRecordSchema.nullable(),
  totalLatencyMs: z.number().nonnegative(),
  cost: VoicePipelineCostSchema,
  ttsAudioBase64: z.string().nullable(),
  ttsAudioMimeType: z.string().nullable(),
});
export type VoicePipelineResponse = z.infer<typeof VoicePipelineResponseSchema>;

export const VoicePipelineBatchRequestSchema = z.object({
  testSetId: z.string().min(1),
  testCaseIds: z.array(z.string().min(1)).optional(),
  deviceId: z.string().min(1).default("demo-bath-heater-001"),
  providerId: z.string().min(1).optional(),
  asrProviderId: z.string().min(1).optional(),
  ttsProviderId: z.string().min(1).optional(),
  promptId: z.string().min(1).optional(),
  applyToDevice: z.boolean().default(false),
  simulateOffline: z.enum(["AUTO", "HIT", "MISS"]).default("AUTO"),
});
export type VoicePipelineBatchRequest = z.infer<
  typeof VoicePipelineBatchRequestSchema
>;

export const VoicePipelineBatchSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  passRate: z.number().min(0).max(1),
  routeBreakdown: z.record(z.string(), z.number().int().nonnegative()),
  failureBreakdown: z.record(z.string(), z.number().int().nonnegative()),
  averageLatencyMs: z.number().nonnegative(),
  p95LatencyMs: z.number().nonnegative(),
  asrCostCny: z.number().nonnegative(),
  llmCostCny: z.number().nonnegative(),
  ttsCostCny: z.number().nonnegative(),
  totalCostCny: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  llmCallRate: z.number().min(0).max(1),
  ruleHitRate: z.number().min(0).max(1),
  offlineHitRate: z.number().min(0).max(1),
});
export type VoicePipelineBatchSummary = z.infer<
  typeof VoicePipelineBatchSummarySchema
>;

export const VoicePipelineBatchItemSchema = z.object({
  id: z.string(),
  testCaseId: z.string(),
  category: z.string(),
  inputText: z.string(),
  expectedIntent: DeviceIntentSchema.nullable(),
  actualIntent: DeviceIntentSchema.nullable(),
  resultType: ResultTypeSchema,
  route: VoicePipelineRouteSchema,
  isMatch: z.boolean(),
  failureReason: z.string().nullable(),
  response: VoicePipelineResponseSchema,
});
export type VoicePipelineBatchItem = z.infer<
  typeof VoicePipelineBatchItemSchema
>;

export const VoicePipelineBatchRunSchema = z.object({
  id: z.string(),
  source: z.literal("PIPELINE_BATCH").default("PIPELINE_BATCH"),
  testSetId: z.string(),
  testSetName: z.string(),
  providerId: z.string().nullable(),
  asrProviderId: z.string().nullable(),
  ttsProviderId: z.string().nullable(),
  promptId: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string(),
  summary: VoicePipelineBatchSummarySchema,
  items: z.array(VoicePipelineBatchItemSchema),
});
export type VoicePipelineBatchRun = z.infer<typeof VoicePipelineBatchRunSchema>;

export const KnowledgeCategorySchema = z.enum([
  "PRODUCT",
  "INSTALL",
  "USAGE",
  "TROUBLESHOOTING",
  "AFTER_SALES",
  "MAINTENANCE",
  "OTHER",
]);
export type KnowledgeCategory = z.infer<typeof KnowledgeCategorySchema>;

export const KnowledgeDocumentStatusSchema = z.enum(["DRAFT", "PUBLISHED"]);
export type KnowledgeDocumentStatus = z.infer<
  typeof KnowledgeDocumentStatusSchema
>;

export const KnowledgeDocumentSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  category: KnowledgeCategorySchema,
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  status: KnowledgeDocumentStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;

export const CreateKnowledgeDocumentRequestSchema = z.object({
  title: z.string().min(1),
  category: KnowledgeCategorySchema,
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  status: KnowledgeDocumentStatusSchema.default("PUBLISHED"),
});
export type CreateKnowledgeDocumentRequest = z.infer<
  typeof CreateKnowledgeDocumentRequestSchema
>;

export const KnowledgeQueryRequestSchema = z.object({
  question: z.string().min(1),
  category: KnowledgeCategorySchema.optional(),
  limit: z.number().int().positive().max(10).default(3),
});
export type KnowledgeQueryRequest = z.infer<typeof KnowledgeQueryRequestSchema>;

export const KnowledgeHitSchema = z.object({
  documentId: z.string(),
  title: z.string(),
  category: KnowledgeCategorySchema,
  score: z.number(),
  snippet: z.string(),
});
export type KnowledgeHit = z.infer<typeof KnowledgeHitSchema>;

export const KnowledgeQueryResponseSchema = z.object({
  answer: z.string(),
  hits: z.array(KnowledgeHitSchema),
  usedFallback: z.boolean(),
});
export type KnowledgeQueryResponse = z.infer<
  typeof KnowledgeQueryResponseSchema
>;

export const ProactiveModeSchema = z.enum(["PRACTICAL", "RELAXED", "QUIET"]);
export type ProactiveMode = z.infer<typeof ProactiveModeSchema>;

export const ProactiveSettingsSchema = z.object({
  enabled: z.boolean(),
  mode: ProactiveModeSchema,
  minIntervalMinutes: z.number().int().positive(),
  quietHours: z.object({
    enabled: z.boolean(),
    start: z.string(),
    end: z.string(),
  }),
  updatedAt: z.string(),
});
export type ProactiveSettings = z.infer<typeof ProactiveSettingsSchema>;

export const ProactiveEventTypeSchema = z.enum([
  "OCCUPANCY_ENTER",
  "OCCUPANCY_LEAVE",
  "LOW_TEMPERATURE",
  "HIGH_HUMIDITY",
  "LONG_RUNNING",
]);
export type ProactiveEventType = z.infer<typeof ProactiveEventTypeSchema>;

export const ProactiveEventRequestSchema = z.object({
  deviceId: z.string().min(1).default("demo-bath-heater-001"),
  eventType: ProactiveEventTypeSchema,
  ambientTemperature: z.number().nullable().optional(),
  humidity: z.number().min(0).max(100).nullable().optional(),
  hasOccupancy: z.boolean().nullable().optional(),
  occurredAt: z.string().optional(),
});
export type ProactiveEventRequest = z.infer<typeof ProactiveEventRequestSchema>;

export const ProactiveDecisionSchema = z.object({
  shouldSpeak: z.boolean(),
  speak: z.string(),
  requiresConfirm: z.boolean(),
  suggestedIntent: DeviceIntentSchema.nullable(),
  reason: z.string(),
  deviceState: DeviceStateSchema,
});
export type ProactiveDecision = z.infer<typeof ProactiveDecisionSchema>;

export const SystemLogTypeSchema = z.enum([
  "VOICE",
  "AI",
  "DEVICE",
  "COMMAND",
  "KNOWLEDGE",
  "PROACTIVE",
  "ERROR",
]);
export type SystemLogType = z.infer<typeof SystemLogTypeSchema>;

export const SystemLogSchema = z.object({
  id: z.string(),
  type: SystemLogTypeSchema,
  summary: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
});
export type SystemLog = z.infer<typeof SystemLogSchema>;

export const ProductCapabilityKeySchema = z.enum([
  "LIGHT",
  "NIGHT_LIGHT",
  "FAN",
  "VENTILATION",
  "HEAT_WEAK",
  "HEAT_STRONG",
  "SWING",
  "DRY",
  "DEFOG",
  "BATH_MODE",
  "CONSTANT_TEMPERATURE",
  "TARGET_TEMPERATURE",
  "NTC_TEMPERATURE",
  "RADAR_OCCUPANCY",
  "REMOTE_2_4G",
  "BLE_LOCAL_CONTROLLERS",
  "DISPLAY",
  "TOUCH_KEYS",
  "PURIFICATION",
]);
export type ProductCapabilityKey = z.infer<
  typeof ProductCapabilityKeySchema
>;

export const ProductCapabilitySupportSchema = z.enum([
  "ENABLED",
  "OPTIONAL",
  "NOT_SUPPORTED",
]);
export type ProductCapabilitySupport = z.infer<
  typeof ProductCapabilitySupportSchema
>;

export const ProductCapabilitySchema = z.object({
  key: ProductCapabilityKeySchema,
  label: z.string().min(1),
  support: ProductCapabilitySupportSchema,
  interface: z.string().min(1),
  notes: z.string().default(""),
});
export type ProductCapability = z.infer<typeof ProductCapabilitySchema>;

export const IoExpansionConfigSchema = z.object({
  bus: z.literal("I2C"),
  frequencyHz: z.number().int().positive().max(100_000),
  type: z.literal("PCF8574"),
  deviceCount: z.number().int().min(1).max(8),
  addresses: z.array(z.number().int().min(0x08).max(0x77)),
  portCount: z.number().int().positive(),
  outputActiveLevel: z.literal("LOW"),
  loadEnableRequired: z.literal(true),
});
export type IoExpansionConfig = z.infer<typeof IoExpansionConfigSchema>;

export const VoiceHardwareLinkSchema = z.object({
  controlTransport: z.literal("UART0"),
  controlBaudRate: z.number().int().positive().max(3_000_000),
  audioTransport: z.literal("I2S_PCM"),
  audioSampleRateHz: z.literal(16_000),
  audioBitsPerSample: z.literal(16),
  audioChannels: z.literal(1),
  externalCrystalRequired: z.literal(true),
});
export type VoiceHardwareLink = z.infer<typeof VoiceHardwareLinkSchema>;

export const LocalControllerConfigSchema = z.object({
  transport: z.literal("ESP32_C3_BLE"),
  wallPanelCount: z.number().int().min(0).max(4),
  handheldRemoteCount: z.number().int().min(0).max(4),
  maximumBondedControllers: z.number().int().min(1).max(8),
  encryptedBondingRequired: z.literal(true),
  commandAcknowledgementRequired: z.literal(true),
});
export type LocalControllerConfig = z.infer<
  typeof LocalControllerConfigSchema
>;

export const HardwareDefinitionStatusSchema = z.enum([
  "PLANNED",
  "ASSIGNED",
  "VERIFIED",
  "FROZEN",
  "RESERVED",
]);
export type HardwareDefinitionStatus = z.infer<
  typeof HardwareDefinitionStatusSchema
>;

export const BoardPinSchema = z.object({
  id: z.string().min(1),
  position: z.number().int().positive(),
  side: z.enum(["LEFT", "RIGHT", "INTERNAL"]),
  label: z.string().min(1),
  gpio: z.number().int().min(0).max(48).nullable(),
  signal: z.string().min(1),
  direction: z.enum(["INPUT", "OUTPUT", "BIDIRECTIONAL", "POWER", "GROUND"]),
  electrical: z.string().min(1),
  target: z.string().min(1),
  bootConstraint: z.string().default("无"),
  defaultLevel: z.enum(["LOW", "HIGH", "HIGH_Z", "N/A"]),
  status: HardwareDefinitionStatusSchema,
  evidence: z.string().default(""),
});
export type BoardPin = z.infer<typeof BoardPinSchema>;

export const IoExpanderPortSchema = z.object({
  id: z.string().min(1),
  device: z.enum(["U1", "U2", "U3"]),
  address: z.number().int().min(0x08).max(0x77),
  port: z.number().int().min(0).max(7),
  signal: z.string().min(1),
  direction: z.enum(["INPUT", "OUTPUT"]),
  activeLevel: z.enum(["LOW", "HIGH", "N/A"]),
  target: z.string().min(1),
  status: HardwareDefinitionStatusSchema,
  safetyClass: z.enum(["NORMAL", "INTERLOCK", "DANGEROUS_LOAD", "RESERVED"]),
  notes: z.string().default(""),
});
export type IoExpanderPort = z.infer<typeof IoExpanderPortSchema>;

export const BoardBusNodeSchema = z.object({
  id: z.string().min(1),
  bus: z.enum(["I2C", "UART", "I2S", "ADC", "BLE", "USB"]),
  name: z.string().min(1),
  endpoint: z.string().min(1),
  parameters: z.string().min(1),
  status: HardwareDefinitionStatusSchema,
});
export type BoardBusNode = z.infer<typeof BoardBusNodeSchema>;

export const BoardProfileSchema = z.object({
  id: z.string().min(1),
  productProfileId: z.string().min(1),
  name: z.string().min(1),
  revision: z.string().min(1),
  role: z.enum(["DEVELOPMENT", "PRODUCTION_CANDIDATE"]),
  controller: z.enum(["ESP32_C3", "ESP32_S3"]),
  lifecycle: z.enum(["ACTIVE", "DRAFT", "FROZEN", "RETIRED"]),
  executionMode: z.enum(["LOCAL_VIRTUAL", "LOCAL_PHYSICAL"]),
  loadVoltageScope: z.enum(["LOGIC_ONLY", "LOW_VOLTAGE", "MAINS"]),
  flashSizeMB: z.number().int().positive(),
  summary: z.string().min(1),
  pins: z.array(BoardPinSchema),
  buses: z.array(BoardBusNodeSchema),
  ioPorts: z.array(IoExpanderPortSchema),
  knownConstraints: z.array(z.string()),
  updatedAt: z.string(),
});
export type BoardProfile = z.infer<typeof BoardProfileSchema>;

export const ExecutionTraceStageSchema = z.object({
  key: z.enum([
    "REQUEST",
    "MQTT",
    "PARSER",
    "QUEUE",
    "SAFETY",
    "CONTROLLER",
    "HAL",
    "STATE",
    "RECEIPT",
  ]),
  label: z.string().min(1),
  status: z.enum(["COMPLETED", "REJECTED", "FAILED", "PENDING", "SKIPPED"]),
  detail: z.string(),
  module: z.string().min(1),
});
export type ExecutionTraceStage = z.infer<typeof ExecutionTraceStageSchema>;

export const DeviceExecutionTraceSchema = z.object({
  traceId: z.string().min(1),
  commandId: z.string().min(1),
  deviceId: z.string().min(1),
  intent: DeviceIntentSchema,
  status: DeviceCommandStatusSchema,
  executionPath: z.string().nullable(),
  errorCode: z.string().nullable(),
  message: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  stages: z.array(ExecutionTraceStageSchema),
  state: DeviceCloudStateSchema.nullable(),
});
export type DeviceExecutionTrace = z.infer<typeof DeviceExecutionTraceSchema>;

export const ProductProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  model: z.string().min(1),
  deviceModelAliases: z.array(z.string().min(1)).default([]),
  status: z.enum(["DRAFT", "ACTIVE", "RETIRED"]),
  controller: z.enum(["ESP32_C3", "ESP32_S3"]),
  voiceProcessor: z.enum(["CI1302", "CI1303", "NONE"]),
  ioExpander: z.string().min(1),
  ioExpansion: IoExpansionConfigSchema,
  voiceHardwareLink: VoiceHardwareLinkSchema,
  localControllers: LocalControllerConfigSchema,
  flashSizeMB: z.number().int().min(4),
  otaReserved: z.boolean(),
  remoteTechnology: z.enum([
    "ESP32_C3_BLE",
    "2_4G_DEDICATED_RX",
    "NONE",
  ]),
  capabilities: z.array(ProductCapabilitySchema),
  safetyDefaults: z.object({
    targetTemperatureMinCelsius: z.number().int().min(0).max(80),
    targetTemperatureMaxCelsius: z.number().int().min(0).max(80),
    targetTemperatureDefaultCelsius: z.number().int().min(0).max(80),
    fanCooldownSeconds: z.number().int().nonnegative().max(900),
    heaterMaxContinuousMinutes: z.number().int().positive().max(240),
    dryModeMaxMinutes: z.number().int().positive().max(240),
    softwareOverTemperatureCelsius: z.number().min(0).max(150).nullable(),
    hardwareThermalCutoffRequired: z.boolean(),
    powerOnAllLoadsOff: z.boolean(),
    heatRequiresFan: z.boolean(),
    halfDuplexVoice: z.boolean(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProductProfile = z.infer<typeof ProductProfileSchema>;

export const VoiceProfileStatusSchema = z.enum([
  "DRAFT",
  "RESOURCE_GENERATING",
  "SAMPLE_VALIDATION",
  "APPROVED",
  "RELEASED",
  "ROLLED_BACK",
]);
export type VoiceProfileStatus = z.infer<typeof VoiceProfileStatusSchema>;

export const OfflineVoiceCommandSchema = z.object({
  id: z.string().min(1),
  semanticId: z.number().int().min(1).max(65535),
  phrase: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  intent: DeviceIntentSchema,
  slots: z.record(z.string(), z.unknown()).default({}),
  feedbackTone: z.enum(["CONFIRM", "REJECT", "NONE"]).default("CONFIRM"),
  enabled: z.boolean().default(true),
});
export type OfflineVoiceCommand = z.infer<
  typeof OfflineVoiceCommandSchema
>;

export const VoiceResourceSchema = z.object({
  fileName: z.string().min(1),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
  generatedAt: z.string(),
});
export type VoiceResource = z.infer<typeof VoiceResourceSchema>;

export const VoiceProfileSchema = z.object({
  id: z.string().min(1),
  productProfileId: z.string().min(1),
  version: z.string().min(1),
  status: VoiceProfileStatusSchema,
  wakeWord: z.string().min(1),
  supportsSeparateAndContinuousSpeech: z.boolean(),
  personalWakeWordPolicy: z.literal("ON_DEVICE_SELF_LEARNING"),
  offlineFirst: z.boolean(),
  commands: z.array(OfflineVoiceCommandSchema),
  resource: VoiceResourceSchema.nullable(),
  notes: z.string().default(""),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;

export const CloneVoiceProfileRequestSchema = z.object({
  version: z.string().min(1),
});
export type CloneVoiceProfileRequest = z.infer<
  typeof CloneVoiceProfileRequestSchema
>;

export const VoiceProfileTransitionRequestSchema = z.object({
  nextStatus: VoiceProfileStatusSchema,
});
export type VoiceProfileTransitionRequest = z.infer<
  typeof VoiceProfileTransitionRequestSchema
>;

export const Ci1302EventTypeSchema = z.enum([
  "BOOT",
  "WAKE",
  "VAD_START",
  "VAD_END",
  "OFFLINE_COMMAND",
  "OFFLINE_MISS",
  "PCM_READY",
  "PLAYBACK_FINISHED",
  "FAULT",
]);
export type Ci1302EventType = z.infer<typeof Ci1302EventTypeSchema>;

export const Ci1302EventSimulationRequestSchema = z.object({
  deviceId: z.string().min(1).default("demo-bath-heater-001"),
  productProfileId: z.string().min(1),
  voiceProfileId: z.string().min(1),
  eventType: Ci1302EventTypeSchema,
  semanticId: z.number().int().min(1).max(65535).nullable().optional(),
  networkOnline: z.boolean().default(true),
  applyToDevice: z.boolean().default(false),
});
export type Ci1302EventSimulationRequest = z.infer<
  typeof Ci1302EventSimulationRequestSchema
>;

export const Ci1302EventSimulationResponseSchema = z.object({
  accepted: z.boolean(),
  route: z.enum([
    "LOCAL_CONTROL",
    "ONLINE_ASR",
    "NO_ACTION",
    "NETWORK_UNAVAILABLE",
    "REJECTED",
  ]),
  eventType: Ci1302EventTypeSchema,
  semanticId: z.number().int().nullable(),
  matchedCommand: OfflineVoiceCommandSchema.nullable(),
  reason: z.string(),
  feedback: z.string(),
  deviceState: DeviceStateSchema,
});
export type Ci1302EventSimulationResponse = z.infer<
  typeof Ci1302EventSimulationResponseSchema
>;

export const BleControllerTypeSchema = z.enum([
  "WALL_PANEL",
  "HANDHELD_REMOTE",
]);
export type BleControllerType = z.infer<typeof BleControllerTypeSchema>;

export const BleLocalControlSimulationRequestSchema = z.object({
  deviceId: z.string().min(1).default("demo-bath-heater-001"),
  productProfileId: z.string().min(1),
  controllerType: BleControllerTypeSchema,
  controllerId: z.string().min(1).max(64),
  sequence: z.number().int().min(1).max(65535),
  bonded: z.boolean().default(true),
  encrypted: z.boolean().default(true),
  intent: DeviceIntentSchema,
  slots: z.record(z.string(), z.unknown()).default({}),
  applyToDevice: z.boolean().default(false),
});
export type BleLocalControlSimulationRequest = z.infer<
  typeof BleLocalControlSimulationRequestSchema
>;

export const BleLocalControlSimulationResponseSchema = z.object({
  accepted: z.boolean(),
  route: z.enum(["LOCAL_CONTROL", "UNAUTHORIZED", "REJECTED"]),
  outcome: z.enum(["APPLIED", "VALIDATED", "REJECTED", "DUPLICATE"]),
  controllerType: BleControllerTypeSchema,
  controllerId: z.string(),
  sequence: z.number().int(),
  intent: DeviceIntentSchema,
  duplicate: z.boolean(),
  stateTransmitted: z.boolean(),
  reason: z.string(),
  deviceState: DeviceStateSchema,
});
export type BleLocalControlSimulationResponse = z.infer<
  typeof BleLocalControlSimulationResponseSchema
>;
