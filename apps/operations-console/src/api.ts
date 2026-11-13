import type {
  AiServiceDefaults,
  BatchTestRun,
  DeviceCommandRecord,
  DeviceEvent,
  DeviceProfile,
  KnowledgeCategory,
  KnowledgeDocument,
  CreateKnowledgeDocumentRequest,
  KnowledgeScope,
  KnowledgeSource,
  KnowledgeQueryResponse,
  ModelProvider,
  ProviderDiagnosticResult,
  ProviderSecretStatus,
  ProactiveMode,
  ProactiveSettings,
  ProductProfile,
  SystemLog,
  TestSetSummary,
} from "@dongxin/shared";

export interface OperationsConsoleData {
  runtime?: RuntimeStatus;
  environment: "LOCAL_PREPRODUCTION" | "BOUNDED_HARDWARE_PILOT";
  devices: DeviceProfile[];
  recentCommands: DeviceCommandRecord[];
  recentEvents: DeviceEvent[];
  alerts: DeviceEvent[];
  auditLogs: SystemLog[];
  products: ProductProfile[];
  knowledgeDocuments: KnowledgeDocument[];
  knowledgeStats: { published: number; review: number; drafts: number; archived: number };
  logCount: number;
  providers: ModelProvider[];
  proactiveSettings: ProactiveSettings;
  mqtt: { enabled: boolean; connected: boolean; brokerUrl: string;
    upstream?: SchedulerStatus; replay?: { reused: number } };
  metrics: {
    totalDevices: number;
    onlineDevices: number;
    faultDevices: number;
    openAlerts: number;
    completedCommands: number;
    commandSuccessRate: number;
  };
  productionReadiness: {
    database: string;
    pilotDeviceCount: number;
    pilotDeviceLimit: number;
    mqtt: string;
    authentication: string;
    deployment: string;
  };
}

interface SchedulerStatus {
  active: number;
  waiting: number;
  completed: number;
  failed: number;
  rejected: number;
  expired: number;
  cancelled: number;
  limits: { concurrency: number; maxWaiting: number; maxWaitMs: number };
}

export interface RuntimeStatus {
  at: string;
  mode: string;
  storage?: { voiceHistory: 'json' | 'postgres' };
  voice: SchedulerStatus;
  stages: Record<'ASR' | 'LLM' | 'TTS', SchedulerStatus>;
  usage: { date: string; ASR: number; LLM: number; TTS: number; failed: number; estimatedCostCny: number;
    budgetCny: number; dailyLimits: Record<'ASR' | 'LLM' | 'TTS', number> };
  ttsCache: { entries: number; bytes: number; maxBytes: number; hits: number };
  requestReplay: { entries: number; bytes: number; reused: number; ttlMs: number };
  retention: { lastRunAt: string | null; removedRecords: number; error: string | null;
    policy: { textDays: number; historySessions: number; historyTurns: number; testSessions: number;
      testTurns: number; events: number; commands: number; logs: number } };
}

export interface OperationsUser {
  username: string;
  displayName: string;
  role: "ADMIN" | "EDITOR" | "REVIEWER";
}

export interface OperationsSession {
  mode: "DISABLED" | "ENABLED";
  user: OperationsUser;
}

export class AuthenticationRequiredError extends Error {
  constructor(message = "请先登录") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || (import.meta.env.DEV ? "http://127.0.0.1:3077" : "");
const authTokenKey = "dongxin-operations-token";

export async function getOperationsSession(): Promise<OperationsSession> {
  return request("/api/auth/session");
}

export async function loginOperations(
  username: string,
  password: string,
): Promise<OperationsSession> {
  const response = await request<{
    token: string;
    expiresAt: string;
    user: OperationsUser;
  }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  window.sessionStorage.setItem(authTokenKey, response.token);
  return { mode: "ENABLED", user: response.user };
}

export function logoutOperations(): void {
  window.sessionStorage.removeItem(authTokenKey);
}

export async function getOperationsConsole(section = 'overview'): Promise<OperationsConsoleData> {
  return request(`/api/operations/console?section=${encodeURIComponent(section)}`);
}
export const getOperationsDevicePage = (query: Record<string, string>) =>
  request<{ items: DeviceProfile[]; total: number; page: number }>(`/api/operations/devices?${new URLSearchParams(query)}`);
export interface OperationsDeviceDetail {
  device: DeviceProfile;
  lastReport: Pick<DeviceEvent, 'createdAt' | 'payload'> | null;
  recentEvents: DeviceEvent[];
  recentCommands: DeviceCommandRecord[];
}
export const getOperationsDeviceDetail = (deviceId: string) =>
  request<OperationsDeviceDetail>(`/api/operations/devices/${encodeURIComponent(deviceId)}`);
export const updateOperationsDeviceProfile = (deviceId: string, input: { name?: string; notes?: string }) =>
  request<OperationsDeviceDetail>(`/api/operations/devices/${encodeURIComponent(deviceId)}`,
    { method: 'PATCH', body: JSON.stringify(input) });

export async function createKnowledgeDocument(input: Omit<CreateKnowledgeDocumentRequest, 'status'>): Promise<KnowledgeDocument> {
  return request("/api/knowledge/documents", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type KnowledgePage = { items: KnowledgeDocument[]; total: number; page: number; counts: OperationsConsoleData['knowledgeStats']; coverage: { publishedTopics: number; questionForms: number; characters: number } };
export type KnowledgeHistory = { versions: KnowledgeDocument[]; events: Array<{ id: string; action: string; actor: string; at: string; reason: string; snapshot: KnowledgeDocument }> };
export type SourceSection = { id: string; title: string; location: string; text: string };
export type SourcePreview = { source: KnowledgeSource; text: string; note: string; sections: SourceSection[]; extractionHash: string };
export const getKnowledgePage = (query: Record<string, string>) => request<KnowledgePage>(`/api/knowledge/entries?${new URLSearchParams(query)}`);
export const getKnowledgeSources = () => request<KnowledgeSource[]>('/api/knowledge/sources');
export const getKnowledgeHistory = (id: string) => request<KnowledgeHistory>(`/api/knowledge/documents/${encodeURIComponent(id)}/history`);
export const updateKnowledgeDocument = (id: string, input: Record<string, unknown>) => request<KnowledgeDocument>(`/api/knowledge/documents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
export const queryKnowledge = (question: string, model?: string) => request<KnowledgeQueryResponse>('/api/knowledge/query', { method: 'POST', body: JSON.stringify({ question, model }) });
export const previewKnowledgeSource = (id: string) => request<SourcePreview>(`/api/knowledge/sources/${encodeURIComponent(id)}/preview`);
export const importKnowledgeSections = (id: string, input: { extractionHash: string; sectionIds: string[]; modelIds: string[] }) =>
  request<{ created: number; skipped: number; documentIds: string[] }>(`/api/knowledge/sources/${encodeURIComponent(id)}/import`, { method: 'POST', body: JSON.stringify(input) });
export const uploadKnowledgeSource = (input: { title: string; fileName: string; base64: string; scope: KnowledgeScope; note: string }) => request<SourcePreview>('/api/knowledge/sources', { method: 'POST', body: JSON.stringify(input) });
export async function downloadKnowledgeSource(source: KnowledgeSource) {
  const token = window.sessionStorage.getItem(authTokenKey);
  const response = await fetch(`${apiBaseUrl}/api/knowledge/sources/${encodeURIComponent(source.id)}/file`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error('下载失败，请确认原始资料文件存在并已登录');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = url; link.download = source.fileName; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function updateProactiveSettings(input: {
  enabled?: boolean;
  mode?: ProactiveMode;
  minIntervalMinutes?: number;
  quietHours?: { enabled?: boolean; start?: string; end?: string };
}): Promise<ProactiveSettings> {
  return request("/api/proactive/settings", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export interface OperationsAiServiceConfiguration {
  defaults: AiServiceDefaults;
  providers: ModelProvider[];
  secrets: ProviderSecretStatus[];
  referencePricing: Record<string, OperationsReferencePricing | null>;
}

export interface OperationsReferencePricing {
  sourceUrl: string;
  checkedAt: string;
  note: string;
  rates: Array<{ label: string; unit: string; input?: number; output?: number; price?: number }>;
}

export type OperationsCatalogVendorId = 'aliyun' | 'deepseek';
export interface OperationsCatalogVendor {
  id: OperationsCatalogVendorId;
  label: string;
  configured: boolean;
}
export interface OperationsCatalogModels {
  vendor: OperationsCatalogVendorId;
  models: string[];
  details: Array<{ id: string; provider: ModelProvider | null }>;
}
export interface OperationsTtsPreview {
  audioBase64: string;
  audioMimeType: string;
  costCny: number;
  latencyMs: number;
}
export interface OperationsAsrPreview {
  providerId: string | null;
  transcript: string;
  costCny: number;
  latencyMs: number;
  isEstimated: boolean;
}

export const getOperationsAiServices = () => request<OperationsAiServiceConfiguration>('/api/operations/ai-services');
export const getOperationsCatalogVendors = () => request<OperationsCatalogVendor[]>('/api/providers/catalog/vendors');
export const saveOperationsCatalogApiKey = (vendor: OperationsCatalogVendorId, apiKey: string) =>
  request<{ configured: boolean }>(`/api/providers/catalog/${vendor}/api-key`, { method: 'PUT', body: JSON.stringify({ apiKey }) });
export const getOperationsCatalogModels = (vendor: OperationsCatalogVendorId) =>
  request<OperationsCatalogModels>(`/api/providers/catalog/${vendor}/models`);
export const useOperationsCatalogModel = (vendor: OperationsCatalogVendorId, modelId: string) =>
  request<unknown>(`/api/providers/catalog/${vendor}/default`, { method: 'PUT', body: JSON.stringify({ modelId }) });
export const bootstrapOperationsSpeechModels = () =>
  request<unknown>('/api/operations/ai-services/bootstrap-speech', { method: 'POST', body: '{}' });
export const setOperationsDefaultAiProvider = (serviceType: 'ASR' | 'LLM' | 'TTS', providerId: string) =>
  request<AiServiceDefaults>(`/api/operations/ai-services/defaults/${serviceType}`, { method: 'PUT', body: JSON.stringify({ providerId }) });
export const diagnoseOperationsAiProvider = (providerId: string) =>
  request<ProviderDiagnosticResult>('/api/operations/ai-services/diagnose', { method: 'POST', body: JSON.stringify({ providerId }) });
export const getOperationsTtsVoices = (providerId: string) =>
  request<{ providerId: string; model: string; voices: Array<{ value: string; label: string }> }>(`/api/operations/ai-services/tts-voices?providerId=${encodeURIComponent(providerId)}`);
export const saveOperationsTtsVoice = (providerId: string, voice: string | null) =>
  request<{ providerId: string; voice: string }>('/api/operations/ai-services/tts-voice', { method: 'PATCH', body: JSON.stringify({ providerId, voice }) });
export const previewOperationsTts = (input: { providerId: string; text: string }) =>
  request<OperationsTtsPreview>('/api/operations/ai-services/tts-preview', { method: 'POST', body: JSON.stringify(input) });
export const previewOperationsAsr = (input: { providerId: string; audioBase64: string; audioMimeType: string }) =>
  request<OperationsAsrPreview>('/api/operations/ai-services/asr-preview', { method: 'POST', body: JSON.stringify(input) });

export interface OperationsVoiceHistoryItem {
  id: string;
  sessionId: string;
  deviceId: string;
  inputSource: 'DEVICE_TEXT' | 'DEVICE_AUDIO';
  inputText: string;
  replyText: string;
  route: string;
  result: 'COMPLETED' | 'FAILED';
  intent: string | null;
  safetyDecision: string | null;
  commandStatus: string | null;
  error: string | null;
  latencyMs: number | null;
  costCny: number | null;
  createdAt: string;
}
export interface OperationsVoiceHistoryPage {
  items: OperationsVoiceHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}
export const getOperationsVoiceHistory = (query: Record<string, string>) =>
  request<OperationsVoiceHistoryPage>(`/api/operations/voice-history?${new URLSearchParams(query)}`);

interface OperationsLlmPreview {
  mode: 'LLM';
  inputText: string;
  aiResult: { resultType: string; intent: string | null; speak: string; slots: Record<string, unknown> };
  safetyResult: { decision: string; reason?: string | null; commands: unknown[] };
  latencyMs: number;
  usage: { costCny?: number; inputTokens?: number; outputTokens?: number };
  error: string | null;
  deviceCommandDispatched: false;
  auditRecorded: boolean;
}

interface OperationsPipelinePreview {
  mode: 'PIPELINE';
  aiResult: OperationsLlmPreview['aiResult'];
  safetyResult: OperationsLlmPreview['safetyResult'];
  route: string;
  replyText: string;
  stages: Array<{ key: string; status: string; source: string; result: string; latencyMs: number; costCny: number; error: string | null }>;
  totalLatencyMs: number;
  cost: { totalCny: number; inputTokens: number; outputTokens: number };
  commandRecord: null;
  deviceCommandDispatched: false;
  auditRecorded: boolean;
}

export type OperationsAiPreview = OperationsLlmPreview | OperationsPipelinePreview;

export const getOperationsAiTestSets = () =>
  request<TestSetSummary[]>('/api/operations/ai-validation/test-sets');
export const getOperationsAiRuns = () =>
  request<BatchTestRun[]>('/api/operations/ai-validation/runs');
export const getOperationsAiRun = (id: string) =>
  request<BatchTestRun>(`/api/operations/ai-validation/runs/${encodeURIComponent(id)}`);
export const previewOperationsAi = (input: { text: string; providerId: string; deviceId?: string; mode: 'PIPELINE' | 'LLM' }) =>
  request<OperationsAiPreview>('/api/operations/ai-validation/preview', { method: 'POST', body: JSON.stringify(input) });
export const startOperationsAiRun = (input: { name: string; providerId: string; testSetId: string; deviceId?: string; maxCases: number; mode: 'PIPELINE' | 'LLM' }) =>
  request<BatchTestRun & { auditRecorded: boolean }>('/api/operations/ai-validation/runs', { method: 'POST', body: JSON.stringify(input) });
export const cancelOperationsAiRun = (id: string) =>
  request<BatchTestRun>(`/api/operations/ai-validation/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });

export async function exportOperationsAiRun(id: string): Promise<void> {
  const token = window.sessionStorage.getItem(authTokenKey);
  const response = await fetch(`${apiBaseUrl}/api/operations/ai-validation/runs/${encodeURIComponent(id)}/export`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`导出失败（HTTP ${response.status}）`);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `ai-validation-${id.slice(0, 8)}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = window.sessionStorage.getItem(authTokenKey);
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json()) as T & {
    error?: { message?: string };
    message?: string;
  };
  if (!response.ok) {
    if (response.status === 401) {
      logoutOperations();
      throw new AuthenticationRequiredError(
        payload.error?.message || payload.message || "请先登录",
      );
    }
    throw new Error(
      payload.error?.message || payload.message || `HTTP ${response.status}`,
    );
  }
  return payload;
}
