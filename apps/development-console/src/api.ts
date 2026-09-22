import type {
  AiServiceDefaults,
  AsrDataset,
  BatchTestRun,
  BoardProfile,
  DeviceCommandRecord,
  DeviceExecutionTrace,
  DeviceProfile,
  DeviceState,
  ModelProvider,
  ProductProfile,
  ProviderDiagnosticResult,
  ProviderSecretStatus,
  TestSetSummary,
  VoiceTestSession,
  VoiceProfile,
} from "@dongxin/shared";

export type {
  AiServiceDefaults,
  AsrDataset,
  BatchTestRun,
  ModelProvider,
  ProviderDiagnosticResult,
  ProviderSecretStatus,
  TestSetSummary,
};

export interface DevelopmentGate {
  id: string;
  label: string;
  status: "PASSED" | "BLOCKED" | "ACTIVE";
  detail: string;
}

export interface DevelopmentConsoleData {
  environment: "LOCAL_DEVELOPMENT";
  boards: BoardProfile[];
  products: ProductProfile[];
  voiceProfiles: VoiceProfile[];
  devices: DeviceProfile[];
  traces: DeviceExecutionTrace[];
  mqtt: { enabled: boolean; connected: boolean; brokerUrl: string };
  gates: DevelopmentGate[];
}

export interface LocalSerialPort {
  path: string;
  manufacturer: string | null;
  serialNumber: string | null;
  vendorId: string | null;
  productId: string | null;
}

export type LocalAgentJobAction = "BUILD" | "FLASH" | "BUILD_FLASH" | "MONITOR";

export interface LocalAgentJob {
  id: string;
  action: LocalAgentJobAction;
  boardId: "lichuang-c3-audio" | "esp32-c3-supermini";
  port: string | null;
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  logs: Array<{
    at: string;
    stream: "SYSTEM" | "STDOUT" | "STDERR" | "SERIAL";
    text: string;
  }>;
}

export interface LocalAgentHealth {
  status: "READY";
  version: string;
  host: string;
  projectRoot: string;
  activeJobId: string | null;
}

export interface LlmModuleTestResult {
  inputText: string;
  providerId: string | null;
  aiResult: {
    resultType: string;
    intent: string | null;
    confidence: number;
    speak: string;
  };
  safetyResult: { decision: string; reason: string };
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; costCny?: number };
  error: string | null;
}

export interface BrowserTtsTestResult {
  status: string;
  target: "BROWSER";
  text: string;
  providerId: string | null;
  providerName: string | null;
  audioBase64: string;
  audioMimeType: string;
  latencyMs: number;
  costCny: number;
}

export interface DeviceAudioTestResult {
  id: string;
  deviceId: string;
  text: string;
  target: "DEVICE";
  status: "GENERATING" | "COMMAND_SENT" | "PLAYING" | "COMPLETED" | "CANCELLED" | "FAILED";
  message: string;
  providerId: string | null;
  providerName: string | null;
  latencyMs: number;
  costCny: number;
  durationMs: number;
  byteLength: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiServiceConfiguration {
  storage: {
    driver: "LOCAL_FILE";
    label: string;
    detail: string;
  };
  defaults: AiServiceDefaults;
  providers: ModelProvider[];
  secrets: ProviderSecretStatus[];
}

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:3077";
const deviceAgentBaseUrl =
  import.meta.env.VITE_DEVICE_AGENT_URL || "http://127.0.0.1:3066";

export async function getDevelopmentConsole(): Promise<DevelopmentConsoleData> {
  return request("/api/development/console");
}

export async function getDeviceState(deviceId: string): Promise<DeviceState> {
  return request(`/api/devices/${encodeURIComponent(deviceId)}/state`);
}

export async function getDeviceCommands(
  deviceId: string,
): Promise<DeviceCommandRecord[]> {
  return request(`/api/devices/${encodeURIComponent(deviceId)}/commands`);
}

export async function sendDeviceCommand(
  deviceId: string,
  intent: string,
  slots: Record<string, unknown> = {},
): Promise<{ command: DeviceCommandRecord; delivery: string }> {
  return request(`/api/devices/${encodeURIComponent(deviceId)}/commands`, {
    method: "POST",
    body: JSON.stringify({ intent, slots }),
  });
}

export async function startVoiceTest(
  deviceId: string,
  mode: "FULL_PIPELINE" | "ASR_ONLY" = "FULL_PIPELINE",
): Promise<VoiceTestSession> {
  return request("/api/development/voice-tests", {
    method: "POST",
    body: JSON.stringify({ deviceId, mode }),
  });
}

export async function stopVoiceTest(sessionId: string): Promise<VoiceTestSession> {
  return request(`/api/development/voice-tests/${encodeURIComponent(sessionId)}/stop`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function getVoiceTest(sessionId: string): Promise<VoiceTestSession> {
  return request(`/api/development/voice-tests/${encodeURIComponent(sessionId)}`);
}

export async function getVoiceTests(deviceId: string): Promise<VoiceTestSession[]> {
  return request(`/api/development/voice-tests?deviceId=${encodeURIComponent(deviceId)}`);
}

export async function getLocalAgentHealth(): Promise<LocalAgentHealth> {
  return agentRequest("/health");
}

export async function getLocalSerialPorts(): Promise<LocalSerialPort[]> {
  return agentRequest("/api/ports");
}

export async function getCurrentLocalAgentJob(): Promise<LocalAgentJob | null> {
  return agentRequest("/api/jobs/current");
}

export async function startLocalAgentJob(input: {
  action: LocalAgentJobAction;
  boardId: LocalAgentJob["boardId"];
  port?: string;
}): Promise<LocalAgentJob> {
  return agentRequest("/api/jobs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function stopLocalAgentJob(jobId: string): Promise<LocalAgentJob> {
  return agentRequest(`/api/jobs/${encodeURIComponent(jobId)}/stop`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function runLlmModuleTest(input: {
  deviceId: string;
  text: string;
}): Promise<LlmModuleTestResult> {
  return request("/api/development/module-tests/llm", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function runTtsModuleTest(input: {
  deviceId?: string;
  text: string;
  target: "BROWSER";
}): Promise<BrowserTtsTestResult>;
export async function runTtsModuleTest(input: {
  deviceId: string;
  text: string;
  target: "DEVICE";
}): Promise<DeviceAudioTestResult>;
export async function runTtsModuleTest(input: {
  deviceId?: string;
  text: string;
  target: "BROWSER" | "DEVICE";
}): Promise<BrowserTtsTestResult | DeviceAudioTestResult> {
  return request("/api/development/module-tests/tts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getDeviceAudioTest(testId: string): Promise<DeviceAudioTestResult> {
  return request(`/api/development/audio-tests/${encodeURIComponent(testId)}`);
}

export async function stopDeviceAudioTest(testId: string): Promise<DeviceAudioTestResult> {
  return request(`/api/development/audio-tests/${encodeURIComponent(testId)}/stop`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function getAiServiceConfiguration(): Promise<AiServiceConfiguration> {
  return request("/api/development/ai-services");
}

export async function setDefaultAiProvider(
  serviceType: "ASR" | "LLM" | "TTS",
  providerId: string,
): Promise<AiServiceDefaults> {
  return request(`/api/development/ai-services/defaults/${serviceType}`, {
    method: "PUT",
    body: JSON.stringify({ providerId }),
  });
}

export async function saveAiProviders(providers: ModelProvider[]): Promise<ModelProvider[]> {
  return request("/api/providers", {
    method: "PUT",
    body: JSON.stringify(providers),
  });
}

export async function saveProviderApiKey(
  providerId: string,
  apiKey: string,
): Promise<ProviderSecretStatus> {
  return request(`/api/providers/${encodeURIComponent(providerId)}/api-key`, {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  });
}

export async function diagnoseAiProvider(providerId: string): Promise<ProviderDiagnosticResult> {
  return request("/api/development/ai-services/diagnose", {
    method: "POST",
    body: JSON.stringify({ providerId }),
  });
}

export async function getTestSetSummaries(): Promise<TestSetSummary[]> {
  return request("/api/test-sets");
}

export async function getAsrDatasets(): Promise<AsrDataset[]> {
  return request("/api/development/asr-datasets");
}

export async function createAsrDataset(input: {
  name: string;
  description?: string;
}): Promise<AsrDataset> {
  return request("/api/development/asr-datasets", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function addAsrDatasetAudio(
  datasetId: string,
  input: {
    fileName: string;
    expectedText: string;
    mimeType: string;
    audioBase64: string;
  },
): Promise<AsrDataset> {
  return request(`/api/development/asr-datasets/${encodeURIComponent(datasetId)}/items`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteAsrDataset(datasetId: string): Promise<void> {
  await request(`/api/development/asr-datasets/${encodeURIComponent(datasetId)}`, {
    method: "DELETE",
  });
}

export async function getBatchTestRuns(): Promise<BatchTestRun[]> {
  return request("/api/development/batch-tests");
}

export async function getBatchTestRun(runId: string): Promise<BatchTestRun> {
  return request(`/api/development/batch-tests/${encodeURIComponent(runId)}`);
}

export async function deleteBatchTestRun(runId: string): Promise<void> {
  await request(`/api/development/batch-tests/${encodeURIComponent(runId)}`, {
    method: "DELETE",
  });
}

export async function startBatchTest(input: {
  name: string;
  kind: "ASR" | "LLM" | "TTS";
  providerId: string;
  deviceId?: string;
  testSetId?: string;
  asrDatasetId?: string;
  repeatCount: number;
  maxCases: number;
}): Promise<BatchTestRun> {
  return request("/api/development/batch-tests", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function cancelBatchTest(runId: string): Promise<BatchTestRun> {
  return request(`/api/development/batch-tests/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function retryFailedBatchTest(runId: string): Promise<BatchTestRun> {
  return request(`/api/development/batch-tests/${encodeURIComponent(runId)}/retry`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function batchExportUrl(runId: string, format: "csv" | "json" | "html"): string {
  return `${apiBaseUrl}/api/development/batch-tests/${encodeURIComponent(runId)}/export/${format}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as T & {
    error?: { message?: string };
    message?: string;
  };
  if (!response.ok) {
    throw new Error(
      payload.error?.message || payload.message || `HTTP ${response.status}`,
    );
  }
  return payload;
}

async function agentRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${deviceAgentBaseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message || `本机烧录助手 HTTP ${response.status}`);
  return payload;
}
