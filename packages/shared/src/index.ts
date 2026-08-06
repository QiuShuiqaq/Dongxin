import { z } from 'zod';

export const DEVICE_INTENTS = [
  'LIGHT_ON',
  'LIGHT_OFF',
  'NIGHT_LIGHT_ON',
  'NIGHT_LIGHT_OFF',
  'HEAT_WEAK_ON',
  'HEAT_WEAK_OFF',
  'HEAT_STRONG_ON',
  'HEAT_STRONG_OFF',
  'FAN_ON',
  'FAN_OFF',
  'VENTILATION_ON',
  'VENTILATION_OFF',
  'SWING_ON',
  'SWING_OFF',
  'PURIFY_ON',
  'PURIFY_OFF',
  'DRY_ON',
  'DRY_OFF',
  'DEFOG_ON',
  'DEFOG_OFF',
  'BATH_MODE_ON',
  'BATH_MODE_OFF',
  'CONSTANT_TEMP_ON',
  'CONSTANT_TEMP_OFF',
  'SET_TEMP',
  'VOLUME_UP',
  'VOLUME_DOWN',
  'VOICE_BROADCAST_ON',
  'VOICE_BROADCAST_OFF',
  'STANDBY',
  'SET_TIMER'
] as const;

export const DeviceIntentSchema = z.enum(DEVICE_INTENTS);
export type DeviceIntent = z.infer<typeof DeviceIntentSchema>;

export const ResultTypeSchema = z.enum([
  'DEVICE_CONTROL',
  'CHAT',
  'NEED_CLARIFY',
  'REJECT',
  'NO_ACTION'
]);
export type ResultType = z.infer<typeof ResultTypeSchema>;

export const SafetyDecisionSchema = z.enum([
  'APPROVED',
  'REJECTED',
  'NEEDS_CONFIRMATION',
  'NO_ACTION'
]);
export type SafetyDecision = z.infer<typeof SafetyDecisionSchema>;

export const ModelProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['MOCK', 'OPENAI_COMPATIBLE']),
  enabled: z.boolean(),
  model: z.string().min(1),
  baseUrl: z.string().nullable().optional(),
  apiKeyEnv: z.string().nullable().optional(),
  timeoutMs: z.number().int().positive().default(8000),
  inputPricePerMTokens: z.number().nullable().optional(),
  outputPricePerMTokens: z.number().nullable().optional(),
  notes: z.string().optional()
});
export type ModelProvider = z.infer<typeof ModelProviderSchema>;

export const ProviderSecretStatusSchema = z.object({
  providerId: z.string().min(1),
  apiKeyEnv: z.string().nullable(),
  isConfigured: z.boolean()
});
export type ProviderSecretStatus = z.infer<typeof ProviderSecretStatusSchema>;

export const SaveProviderApiKeyRequestSchema = z.object({
  apiKey: z.string().trim().min(1, 'API Key 不能为空')
});
export type SaveProviderApiKeyRequest = z.infer<typeof SaveProviderApiKeyRequestSchema>;

export const PromptVersionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().positive(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
  createdAt: z.string(),
  systemPrompt: z.string().min(1)
});
export type PromptVersion = z.infer<typeof PromptVersionSchema>;

export const TestCaseSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  inputText: z.string().min(1),
  expectedIntent: DeviceIntentSchema.nullable(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  notes: z.string().optional()
});
export type TestCase = z.infer<typeof TestCaseSchema>;

export const DeviceStateSchema = z.object({
  isOnline: z.boolean(),
  activeModes: z.array(DeviceIntentSchema),
  targetTemperature: z.number().int().min(30).max(45),
  ambientTemperature: z.number(),
  humidity: z.number().min(0).max(100).nullable().optional(),
  hasOccupancy: z.boolean(),
  voiceBroadcastEnabled: z.boolean(),
  faultCode: z.string().nullable(),
  updatedAt: z.string()
});
export type DeviceState = z.infer<typeof DeviceStateSchema>;

export const AiResultSchema = z.object({
  resultType: ResultTypeSchema,
  intent: DeviceIntentSchema.nullable(),
  confidence: z.number().min(0).max(1),
  slots: z
    .object({
      temperature: z.number().int().nullable().optional(),
      durationMinutes: z.number().int().positive().nullable().optional()
    })
    .passthrough()
    .default({}),
  requiresConfirm: z.boolean().default(false),
  speak: z.string().default('')
});
export type AiResult = z.infer<typeof AiResultSchema>;

export const SafetyResultSchema = z.object({
  decision: SafetyDecisionSchema,
  commands: z.array(DeviceIntentSchema),
  reason: z.string(),
  speak: z.string()
});
export type SafetyResult = z.infer<typeof SafetyResultSchema>;

export const EvaluationItemSchema = z.object({
  testCaseId: z.string(),
  providerId: z.string(),
  inputText: z.string(),
  expectedIntent: DeviceIntentSchema.nullable(),
  aiResult: AiResultSchema.nullable(),
  safetyResult: SafetyResultSchema.nullable(),
  isMatch: z.boolean(),
  latencyMs: z.number(),
  error: z.string().nullable()
});
export type EvaluationItem = z.infer<typeof EvaluationItemSchema>;

export const EvaluationRunSchema = z.object({
  id: z.string(),
  promptId: z.string(),
  providerIds: z.array(z.string()),
  startedAt: z.string(),
  completedAt: z.string(),
  summary: z.object({
    total: z.number().int(),
    passed: z.number().int(),
    failed: z.number().int(),
    averageLatencyMs: z.number()
  }),
  items: z.array(EvaluationItemSchema)
});
export type EvaluationRun = z.infer<typeof EvaluationRunSchema>;

export const DeviceProtocolSchema = z.enum(['SIMULATOR', 'HTTP', 'MQTT']);
export type DeviceProtocol = z.infer<typeof DeviceProtocolSchema>;

export const DeviceStatusSchema = z.enum(['ONLINE', 'OFFLINE', 'FAULT']);
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
  updatedAt: z.string()
});
export type DeviceProfile = z.infer<typeof DeviceProfileSchema>;

export const DeviceEventTypeSchema = z.enum([
  'STATE_REPORT',
  'OCCUPANCY',
  'RADAR',
  'FAULT',
  'VOICE',
  'COMMAND_RESULT'
]);
export type DeviceEventType = z.infer<typeof DeviceEventTypeSchema>;

export const DeviceEventSchema = z.object({
  id: z.string(),
  deviceId: z.string().min(1),
  type: DeviceEventTypeSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string()
});
export type DeviceEvent = z.infer<typeof DeviceEventSchema>;

export const DeviceCommandStatusSchema = z.enum([
  'QUEUED',
  'APPLIED',
  'REJECTED',
  'NEEDS_CONFIRMATION',
  'FAILED'
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
  completedAt: z.string().nullable().optional()
});
export type DeviceCommandRecord = z.infer<typeof DeviceCommandRecordSchema>;

export const VoiceTurnRequestSchema = z.object({
  deviceId: z.string().min(1).default('demo-bath-heater-001'),
  sessionId: z.string().min(1).optional(),
  providerId: z.string().min(1),
  promptId: z.string().min(1).optional(),
  text: z.string().min(1),
  asrConfidence: z.number().min(0).max(1).nullable().optional(),
  applyToDevice: z.boolean().default(true)
});
export type VoiceTurnRequest = z.infer<typeof VoiceTurnRequestSchema>;

export const VoiceTurnResponseSchema = z.object({
  sessionId: z.string(),
  replyText: z.string(),
  aiResult: AiResultSchema,
  safetyResult: SafetyResultSchema,
  deviceState: DeviceStateSchema,
  commandRecord: DeviceCommandRecordSchema.nullable()
});
export type VoiceTurnResponse = z.infer<typeof VoiceTurnResponseSchema>;

export const KnowledgeCategorySchema = z.enum([
  'PRODUCT',
  'INSTALL',
  'USAGE',
  'TROUBLESHOOTING',
  'AFTER_SALES',
  'MAINTENANCE',
  'OTHER'
]);
export type KnowledgeCategory = z.infer<typeof KnowledgeCategorySchema>;

export const KnowledgeDocumentStatusSchema = z.enum(['DRAFT', 'PUBLISHED']);
export type KnowledgeDocumentStatus = z.infer<typeof KnowledgeDocumentStatusSchema>;

export const KnowledgeDocumentSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  category: KnowledgeCategorySchema,
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  status: KnowledgeDocumentStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string()
});
export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;

export const CreateKnowledgeDocumentRequestSchema = z.object({
  title: z.string().min(1),
  category: KnowledgeCategorySchema,
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  status: KnowledgeDocumentStatusSchema.default('PUBLISHED')
});
export type CreateKnowledgeDocumentRequest = z.infer<typeof CreateKnowledgeDocumentRequestSchema>;

export const KnowledgeQueryRequestSchema = z.object({
  question: z.string().min(1),
  category: KnowledgeCategorySchema.optional(),
  limit: z.number().int().positive().max(10).default(3)
});
export type KnowledgeQueryRequest = z.infer<typeof KnowledgeQueryRequestSchema>;

export const KnowledgeHitSchema = z.object({
  documentId: z.string(),
  title: z.string(),
  category: KnowledgeCategorySchema,
  score: z.number(),
  snippet: z.string()
});
export type KnowledgeHit = z.infer<typeof KnowledgeHitSchema>;

export const KnowledgeQueryResponseSchema = z.object({
  answer: z.string(),
  hits: z.array(KnowledgeHitSchema),
  usedFallback: z.boolean()
});
export type KnowledgeQueryResponse = z.infer<typeof KnowledgeQueryResponseSchema>;

export const ProactiveModeSchema = z.enum(['PRACTICAL', 'RELAXED', 'QUIET']);
export type ProactiveMode = z.infer<typeof ProactiveModeSchema>;

export const ProactiveSettingsSchema = z.object({
  enabled: z.boolean(),
  mode: ProactiveModeSchema,
  minIntervalMinutes: z.number().int().positive(),
  quietHours: z.object({
    enabled: z.boolean(),
    start: z.string(),
    end: z.string()
  }),
  updatedAt: z.string()
});
export type ProactiveSettings = z.infer<typeof ProactiveSettingsSchema>;

export const ProactiveEventTypeSchema = z.enum([
  'OCCUPANCY_ENTER',
  'OCCUPANCY_LEAVE',
  'LOW_TEMPERATURE',
  'HIGH_HUMIDITY',
  'LONG_RUNNING'
]);
export type ProactiveEventType = z.infer<typeof ProactiveEventTypeSchema>;

export const ProactiveEventRequestSchema = z.object({
  deviceId: z.string().min(1).default('demo-bath-heater-001'),
  eventType: ProactiveEventTypeSchema,
  ambientTemperature: z.number().nullable().optional(),
  humidity: z.number().min(0).max(100).nullable().optional(),
  hasOccupancy: z.boolean().nullable().optional(),
  occurredAt: z.string().optional()
});
export type ProactiveEventRequest = z.infer<typeof ProactiveEventRequestSchema>;

export const ProactiveDecisionSchema = z.object({
  shouldSpeak: z.boolean(),
  speak: z.string(),
  requiresConfirm: z.boolean(),
  suggestedIntent: DeviceIntentSchema.nullable(),
  reason: z.string(),
  deviceState: DeviceStateSchema
});
export type ProactiveDecision = z.infer<typeof ProactiveDecisionSchema>;

export const SystemLogTypeSchema = z.enum([
  'VOICE',
  'AI',
  'DEVICE',
  'COMMAND',
  'KNOWLEDGE',
  'PROACTIVE',
  'ERROR'
]);
export type SystemLogType = z.infer<typeof SystemLogTypeSchema>;

export const SystemLogSchema = z.object({
  id: z.string(),
  type: SystemLogTypeSchema,
  summary: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string()
});
export type SystemLog = z.infer<typeof SystemLogSchema>;
