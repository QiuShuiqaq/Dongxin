import type {
  DeviceCommandRecord,
  DeviceEvent,
  DeviceProfile,
  DeviceState,
  EvaluationRun,
  KnowledgeDocument,
  KnowledgeQueryResponse,
  ModelProvider,
  ProactiveDecision,
  ProactiveSettings,
  ProviderSecretStatus,
  PromptVersion,
  ProductionCostSettings,
  SystemLog,
  SafetyResult,
  TestCase,
  TestSet,
  TestSetSummary,
  AiResult,
  VoiceTurnResponse,
  VoicePipelineInputSource,
  VoicePipelineResponse,
  DeviceAccessEventRequest,
  DeviceAccessVoiceTurnRequest,
  DeviceAction,
  DeviceCloudState,
  DeviceCommandResultRequest,
  DeviceHeartbeatRequest,
  DeviceRegisterRequest,
  DeviceStateReportRequest,
  CreateTestSetRequest,
  ImportTestSetMarkdownRequest,
  UpdateTestSetRequest
} from '@dongxin/shared';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3077';

export interface BootstrapData {
  providers: ModelProvider[];
  prompts: PromptVersion[];
  testCases: TestCase[];
  testSets: TestSetSummary[];
  evaluations: EvaluationRun[];
  devices: DeviceProfile[];
  knowledgeDocuments: KnowledgeDocument[];
  proactiveSettings: ProactiveSettings;
  productionCostSettings: ProductionCostSettings;
  logs: SystemLog[];
  deviceState: DeviceState;
}

export interface ChatTestResponse {
  aiResult: AiResult;
  latencyMs: number;
  rawResponse: unknown;
  safetyResult: SafetyResult;
  deviceState: DeviceState;
}

interface ApiEnvelope<T> {
  success: boolean;
  requestId: string;
  serverTime: string;
  data: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface VoiceTurnInput {
  deviceId: string;
  providerId: string;
  promptId?: string;
  text: string;
  sessionId?: string;
  asrConfidence?: number;
  applyToDevice?: boolean;
}

export interface DeviceAccessConfig {
  pollIntervalSeconds: number;
  heartbeatIntervalSeconds: number;
  voiceTimeoutMs: number;
  mcuAckTimeoutMs: number;
  activeProtocolVersion: string;
}

export interface DeviceAccessUsage {
  usedLlm: boolean;
  providerId: string | null;
  inputTokens: number;
  outputTokens: number;
  costCny: number | null;
  isEstimated: boolean;
  latencyMs: number;
}

export interface DeviceAccessVoiceTurnResponse {
  sessionId: string;
  replyText: string;
  needConfirm: boolean;
  confirmToken: string | null;
  source: 'rule' | 'knowledge' | 'llm' | 'confirm' | 'none';
  actions: DeviceAction[];
  usage: DeviceAccessUsage;
}

export interface DeviceAccessPollCommand {
  commandId: string;
  source: string;
  expireAt: string;
  replyText: string;
  actions: DeviceAction[];
}

export async function getBootstrap(): Promise<BootstrapData> {
  return request('/api/bootstrap');
}

export async function updateProductionCostSettings(
  settings: ProductionCostSettings
): Promise<ProductionCostSettings> {
  return request('/api/production-cost-settings', {
    method: 'PUT',
    body: JSON.stringify(settings)
  });
}

export async function updateProviders(providers: ModelProvider[]): Promise<ModelProvider[]> {
  return request('/api/providers', {
    method: 'PUT',
    body: JSON.stringify(providers)
  });
}

export async function getProviderSecretStatuses(): Promise<ProviderSecretStatus[]> {
  return request('/api/providers/secret-status');
}

export async function saveProviderApiKey(providerId: string, apiKey: string): Promise<ProviderSecretStatus> {
  return request(`/api/providers/${providerId}/api-key`, {
    method: 'PUT',
    body: JSON.stringify({ apiKey })
  });
}

export async function clearProviderApiKey(providerId: string): Promise<ProviderSecretStatus> {
  return request(`/api/providers/${providerId}/api-key`, {
    method: 'DELETE'
  });
}

export async function runChatTest(input: {
  providerId: string;
  promptId?: string;
  inputText: string;
  applyToDevice: boolean;
}): Promise<ChatTestResponse> {
  return request('/api/chat/test', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function runEvaluation(input: {
  providerIds?: string[];
  testSetId?: string;
  testCaseIds?: string[];
  promptId?: string;
}): Promise<EvaluationRun> {
  return request('/api/evaluations/run', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function getTestSets(): Promise<TestSetSummary[]> {
  return request('/api/test-sets');
}

export async function getTestSet(testSetId: string): Promise<TestSet> {
  return request(`/api/test-sets/${testSetId}`);
}

export async function createTestSet(input: CreateTestSetRequest): Promise<TestSet> {
  return request('/api/test-sets', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function importTestSetMarkdown(input: ImportTestSetMarkdownRequest): Promise<TestSet> {
  return request('/api/test-sets/import-md', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function updateTestSet(testSetId: string, input: UpdateTestSetRequest): Promise<TestSet> {
  return request(`/api/test-sets/${testSetId}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export async function deleteTestSet(testSetId: string): Promise<{ success: boolean }> {
  return request(`/api/test-sets/${testSetId}`, {
    method: 'DELETE'
  });
}

export async function patchDeviceState(patch: Partial<DeviceState>): Promise<DeviceState> {
  return request('/api/device-state', {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
}

export async function getDevices(): Promise<DeviceProfile[]> {
  return request('/api/devices');
}

export async function getDeviceState(deviceId: string): Promise<DeviceState> {
  return request(`/api/devices/${deviceId}/state`);
}

export async function sendDeviceCommand(
  deviceId: string,
  input: { intent: string; slots?: Record<string, unknown> }
): Promise<{ state: DeviceState; command: DeviceCommandRecord }> {
  return request(`/api/devices/${deviceId}/commands`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function recordDeviceEvent(
  deviceId: string,
  input: { type: string; payload?: Record<string, unknown> }
): Promise<DeviceEvent> {
  return request(`/api/devices/${deviceId}/events`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function runVoiceTurn(input: VoiceTurnInput): Promise<VoiceTurnResponse> {
  return request('/api/voice/turn', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function runVoicePipeline(input: {
  deviceId: string;
  inputSource: VoicePipelineInputSource;
  text?: string;
  audioBase64?: string;
  mimeType?: string;
  providerId?: string;
  asrProviderId?: string;
  ttsProviderId?: string;
  promptId?: string;
  applyToDevice?: boolean;
  simulateOffline?: 'AUTO' | 'HIT' | 'MISS';
}): Promise<VoicePipelineResponse> {
  return request('/api/voice/pipeline/test', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function registerDeviceAccess(input: DeviceRegisterRequest): Promise<{
  deviceId: string;
  pollIntervalSeconds: number;
  heartbeatIntervalSeconds: number;
  protocolVersion: string;
}> {
  return requestEnvelope('/api/device/v1/register', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function heartbeatDeviceAccess(input: DeviceHeartbeatRequest): Promise<{
  isRegistered: boolean;
  hasPendingCommands: boolean;
}> {
  return requestEnvelope('/api/device/v1/heartbeat', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function getDeviceAccessConfig(deviceId: string): Promise<DeviceAccessConfig> {
  const search = new URLSearchParams({ deviceId });
  return requestEnvelope(`/api/device/v1/config?${search.toString()}`);
}

export async function reportDeviceAccessState(input: DeviceStateReportRequest): Promise<{
  accepted: boolean;
  hasPendingCommands: boolean;
}> {
  return requestEnvelope('/api/device/v1/state', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function recordDeviceAccessEvent(input: DeviceAccessEventRequest): Promise<{
  accepted: boolean;
  proactive: {
    shouldSpeak: boolean;
    replyText: string;
    needConfirm: boolean;
    suggestedActions: DeviceAction[];
  };
}> {
  return requestEnvelope('/api/device/v1/events', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function runDeviceAccessVoiceTurn(
  input: DeviceAccessVoiceTurnRequest
): Promise<DeviceAccessVoiceTurnResponse> {
  return requestEnvelope('/api/device/v1/voice-turn', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function pollDeviceAccessCommands(deviceId: string, limit = 5): Promise<{
  commands: DeviceAccessPollCommand[];
}> {
  const search = new URLSearchParams({ deviceId, limit: String(limit) });
  return requestEnvelope(`/api/device/v1/commands/poll?${search.toString()}`);
}

export async function reportDeviceAccessCommandResult(input: DeviceCommandResultRequest): Promise<{
  accepted: boolean;
  command: DeviceCommandRecord;
}> {
  return requestEnvelope('/api/device/v1/commands/result', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export type DeviceAccessStatePatch = DeviceCloudState;

export async function getKnowledgeDocuments(): Promise<KnowledgeDocument[]> {
  return request('/api/knowledge/documents');
}

export async function createKnowledgeDocument(input: {
  title: string;
  category: string;
  content: string;
  tags: string[];
  status?: 'DRAFT' | 'PUBLISHED';
}): Promise<KnowledgeDocument> {
  return request('/api/knowledge/documents', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function queryKnowledge(input: {
  question: string;
  category?: string;
  limit?: number;
}): Promise<KnowledgeQueryResponse> {
  return request('/api/knowledge/query', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function getProactiveSettings(): Promise<ProactiveSettings> {
  return request('/api/proactive/settings');
}

export async function updateProactiveSettings(input: Partial<ProactiveSettings>): Promise<ProactiveSettings> {
  return request('/api/proactive/settings', {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export async function runProactiveEvent(input: {
  deviceId?: string;
  eventType: 'OCCUPANCY_ENTER' | 'OCCUPANCY_LEAVE' | 'LOW_TEMPERATURE' | 'HIGH_HUMIDITY' | 'LONG_RUNNING';
  ambientTemperature?: number | null;
  humidity?: number | null;
  hasOccupancy?: boolean | null;
  occurredAt?: string;
}): Promise<ProactiveDecision> {
  return request('/api/proactive/events', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function getLogs(input?: { type?: string; limit?: number }): Promise<SystemLog[]> {
  const search = new URLSearchParams();
  if (input?.type) {
    search.set('type', input.type);
  }
  if (typeof input?.limit === 'number') {
    search.set('limit', String(input.limit));
  }
  const query = search.toString();
  return request(query ? `/api/logs?${query}` : '/api/logs');
}

async function requestEnvelope<T>(path: string, init?: RequestInit): Promise<T> {
  const payload = await request<ApiEnvelope<T>>(path, init);
  if (!payload.success) {
    throw new Error(payload.error?.message || 'API request failed');
  }
  return payload.data;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || `HTTP ${response.status}`);
  }

  return response.json() as Promise<T>;
}
