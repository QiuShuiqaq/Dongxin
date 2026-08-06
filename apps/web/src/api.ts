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
  SystemLog,
  SafetyResult,
  TestCase,
  AiResult,
  VoiceTurnResponse
} from '@dongxin/shared';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3001';

export interface BootstrapData {
  providers: ModelProvider[];
  prompts: PromptVersion[];
  testCases: TestCase[];
  evaluations: EvaluationRun[];
  devices: DeviceProfile[];
  knowledgeDocuments: KnowledgeDocument[];
  proactiveSettings: ProactiveSettings;
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

export interface VoiceTurnInput {
  deviceId: string;
  providerId: string;
  promptId?: string;
  text: string;
  sessionId?: string;
  asrConfidence?: number;
  applyToDevice?: boolean;
}

export async function getBootstrap(): Promise<BootstrapData> {
  return request('/api/bootstrap');
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
  testCaseIds?: string[];
  promptId?: string;
}): Promise<EvaluationRun> {
  return request('/api/evaluations/run', {
    method: 'POST',
    body: JSON.stringify(input)
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
