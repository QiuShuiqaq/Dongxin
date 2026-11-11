import type {
  AiServiceDefaults,
  AsrDataset,
  BatchTestRun,
  BoardProfile,
  Ci1302EventSimulationResponse,
  DeviceCommandRecord,
  DeviceExecutionTrace,
  DeviceProfile,
  DeviceState,
  ModelProvider,
  ProductProfile,
  ProviderDiagnosticResult,
  ProviderSecretStatus,
  TestSetSummary,
  TestSet,
  VoiceTestSession,
  VoicePipelineResponse,
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
  Ci1302EventSimulationResponse,
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

export interface VoiceHistorySession {
  id: string;
  deviceId: string;
  channel: 'llm-test' | 'pipeline' | 'device-test' | 'asr-test';
  status?: string;
  createdAt: string;
  updatedAt: string;
  turns: Array<{
    id: string;
    at: string;
    text: string;
    reply: string;
    route: string;
    error: string | null;
    latencyMs: number | null;
    costCny: number | null;
  }>;
}

export interface DevelopmentLiveData {
  sampledAt: string;
  device: { id: string; name: string; status: DeviceProfile['status']; updatedAt: string };
  mqtt: DevelopmentConsoleData['mqtt'];
  voiceTests: Array<{
    id: string; mode: string; status: string; message: string; updatedAt: string;
    transcript: string | null; reply: string | null; route: string | null;
    stages: Array<{ key: string; status: string; error: string | null }>;
  }>;
  audioTests: DeviceAudioTestResult[];
  batchTests: Array<{
    id: string; name: string; kind: string; status: string; updatedAt: string;
    error: string | null; completed: number; total: number;
  }>;
  linkEvents: Array<{
    id: string; createdAt: string;
    payload: { eventType?: string; direction?: string; valid?: boolean; result?: string; frame?: string };
  }>;
  conversations: Array<{
    id: string; channel: VoiceHistorySession['channel']; updatedAt: string;
    lastTurn: VoiceHistorySession['turns'][number] | null;
  }>;
}

export interface Stm32LinkEvent {
  id: string;
  deviceId: string;
  type: "PROTOCOL_TRACE";
  createdAt: string;
  payload: {
    direction: "RX" | "TX";
    eventType:
      | "STATUS"
      | "NETWORK_STATUS_REQUEST"
      | "COMMAND"
      | "COMMAND_ACK"
      | "COMMAND_ACK_MISMATCH"
      | "COMMAND_TIMEOUT"
      | "FRAME_REJECTED";
    valid: boolean;
    result: string;
    frame: string;
    command?: number;
    value?: number;
    rejectedFrames: number;
    discardedBytes: number;
    state?: {
      temperatureCelsius: number;
      remainingMinutes: number;
      light: boolean;
      ventilation: boolean;
      fan: boolean;
      heater: "off" | "weak" | "strong";
      swing: boolean;
      dry: boolean;
      networkControlEnabled: boolean;
    };
  };
}

export interface LocalSerialPort {
  path: string;
  manufacturer: string | null;
  serialNumber: string | null;
  vendorId: string | null;
  productId: string | null;
}

export type LocalAgentJobAction = "BUILD" | "FLASH" | "BUILD_FLASH" | "MONITOR" | "CI_MONITOR";
export type CiMonitorMode = "UART1_PROTOCOL" | "UART0_LOG";

export interface LocalAgentJob {
  id: string;
  action: LocalAgentJobAction;
  boardId: "lichuang-c3-audio" | "esp32-c3-supermini" | "ci1302";
  port: string | null;
  monitorMode: CiMonitorMode | null;
  receivedBytes: number;
  validFrames: number;
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

export type CiMonitorRecordSummary = Pick<LocalAgentJob,
  "id" | "port" | "monitorMode" | "startedAt" | "completedAt" | "status" | "receivedBytes" | "validFrames">;

export interface LlmModuleTestResult {
  conversationId?: string;
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
  status: "GENERATING" | "COMMAND_SENT" | "PLAYING" | "LISTENING" | "COMPLETED" | "CANCELLED" | "FAILED";
  message: string;
  providerId: string | null;
  providerName: string | null;
  latencyMs: number;
  costCny: number;
  durationMs: number;
  byteLength: number;
  volumePercent: number;
  createdAt: string;
  updatedAt: string;
}

export type BoardLabAction = "snapshot" | "display_pattern" | "display_power";
export type BoardLabRequestStatus = "PENDING" | "COMPLETED" | "FAILED";

export interface BoardLabSnapshot {
  system: {
    uptimeMs: number;
    freeHeapBytes: number;
    minimumFreeHeapBytes: number;
    firmwareVersion: string;
  };
  network: { ip?: string; rssi?: number; timeSynced?: boolean };
  components: Array<{
    id: string;
    name: string;
    address: string;
    present: boolean;
  }>;
  environment: {
    available: boolean;
    temperatureC?: number;
    humidityPercent?: number;
  };
  motion: {
    available: boolean;
    accelX?: number;
    accelY?: number;
    accelZ?: number;
    gyroX?: number;
    gyroY?: number;
    gyroZ?: number;
    roll?: number;
    pitch?: number;
  };
  compass: {
    available: boolean;
    x?: number;
    y?: number;
    z?: number;
    heading?: number;
  };
  touch: { available: boolean; pressed?: boolean; points?: number; x?: number; y?: number };
  button: { pressed: boolean };
  display: { available: boolean; on: boolean; brightnessPercent: number; pattern: string };
}

export interface BoardLabRequestRecord {
  requestId: string;
  deviceId: string;
  action: BoardLabAction;
  params: Record<string, unknown>;
  status: BoardLabRequestStatus;
  message: string;
  result: BoardLabSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

export interface BoardLabDeviceState {
  deviceId: string;
  online: boolean;
  supported: boolean;
  capabilities: {
    displayControl: boolean;
    sensorTelemetry: boolean;
    touchTelemetry: boolean;
    audioPlayback: boolean;
    bleExperiment: false;
    destructiveFlashOperations: false;
  };
  latest: BoardLabRequestRecord | null;
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
  referencePricing: Record<string, ReferencePricing | null>;
}

export interface ReferencePricing {
  sourceUrl: string;
  checkedAt: string;
  note: string;
  rates: Array<{ label: string; unit: string; input?: number; output?: number; price?: number }>;
}

export type CatalogVendorId = "aliyun" | "deepseek";

export interface CatalogVendor {
  id: CatalogVendorId;
  label: string;
  configured: boolean;
}

export interface CatalogModels {
  vendor: CatalogVendorId;
  models: string[];
  pricingUrl: string;
  details: Array<{ id: string; provider: ModelProvider | null; referencePricing: ReferencePricing | null }>;
}

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:3077";
const deviceAgentBaseUrl =
  import.meta.env.VITE_DEVICE_AGENT_URL || "http://127.0.0.1:3066";

export async function getDevelopmentConsole(): Promise<DevelopmentConsoleData> {
  return request("/api/development/console");
}

export async function getDevelopmentLiveData(deviceId: string): Promise<DevelopmentLiveData> {
  return request(`/api/development/live?deviceId=${encodeURIComponent(deviceId)}`);
}

export async function getVoiceHistory(deviceId: string, offset = 0, limit = 30): Promise<VoiceHistorySession[]> {
  return request(`/api/development/voice-history?deviceId=${encodeURIComponent(deviceId)}&offset=${offset}&limit=${limit}`);
}

export interface DeviceVoiceVolume {
  deviceId: string;
  volumePercent: number;
}

export async function getDeviceVoiceVolume(deviceId: string): Promise<DeviceVoiceVolume> {
  return request(`/api/development/voice-volume/${encodeURIComponent(deviceId)}`);
}

export async function saveDeviceVoiceVolume(deviceId: string, volumePercent: number): Promise<DeviceVoiceVolume> {
  return request(`/api/development/voice-volume/${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    body: JSON.stringify({ volumePercent }),
  });
}

export async function getDeviceState(deviceId: string): Promise<DeviceState> {
  return request(`/api/devices/${encodeURIComponent(deviceId)}/state`);
}

export async function getStm32LinkEvents(
  deviceId: string,
  limit = 100,
): Promise<Stm32LinkEvent[]> {
  return request(
    `/api/development/stm32-link/${encodeURIComponent(deviceId)}?limit=${limit}`,
  );
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
  mode: "FULL_PIPELINE" | "ASR_ONLY" | "CI_WAKE_ONLINE_FALLBACK" =
    "FULL_PIPELINE",
  capture?: { asrDatasetId: string; expectedText: string },
  options?: { continuous?: boolean; settings?: import('@dongxin/shared').VoiceTestSettings },
): Promise<VoiceTestSession> {
  return request("/api/development/voice-tests", {
    method: "POST",
    body: JSON.stringify({ deviceId, mode, ...capture, ...options }),
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

export async function simulateCi1302Event(input: {
  deviceId: string;
  productProfileId: string;
  voiceProfileId: string;
  eventType: "OFFLINE_COMMAND" | "OFFLINE_MISS";
  semanticId?: number | null;
  networkOnline: boolean;
}): Promise<Ci1302EventSimulationResponse> {
  return request("/api/hardware-config/ci1302/events/simulate", {
    method: "POST",
    body: JSON.stringify({ ...input, applyToDevice: false }),
  });
}

export type SimulatedSensorEvent = 'OCCUPANCY_ENTER' | 'LOW_TEMPERATURE' | 'HIGH_HUMIDITY' | 'LONG_RUNNING';

export interface ProactiveSensorSimulation {
  simulation: true;
  actionExecuted: false;
  event: { deviceId: string; eventType: SimulatedSensorEvent; ambientTemperature?: number | null; humidity?: number | null };
  decision: { shouldSpeak: boolean; speak: string; requiresConfirm: boolean; reason: string; suggestedIntent: string | null };
  playback: { id?: string; status?: string } | null;
  note: string;
}

export async function simulateProactiveSensor(input: {
  deviceId: string;
  eventType: SimulatedSensorEvent;
  playToDevice: boolean;
  volumePercent: number;
  ambientTemperature?: number | null;
  humidity?: number | null;
}): Promise<ProactiveSensorSimulation> {
  return request('/api/development/proactive/simulate', {
    method: 'POST', body: JSON.stringify(input),
  });
}

export type DevelopmentScenario = 'WIFI_DOWN_FIXED_COMMAND' | 'WIFI_DOWN_OPEN_QUESTION' |
  'CLOUD_TIMEOUT' | 'RECONNECT_STALE_COMMAND' | 'DUPLICATE_LOCAL_EVENT';
export interface DevelopmentScenarioResult {
  simulation: true;
  deviceId: string;
  scenario: DevelopmentScenario;
  title: string;
  steps: string[];
  expected: string;
  actionExecuted: false;
  deviceStateChanged: false;
  note: string;
}
export async function evaluateDevelopmentScenario(deviceId: string, scenario: DevelopmentScenario): Promise<DevelopmentScenarioResult> {
  return request('/api/development/scenarios/evaluate', {
    method: 'POST', body: JSON.stringify({ deviceId, scenario }),
  });
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

export async function getCiMonitorRecords(): Promise<CiMonitorRecordSummary[]> {
  return agentRequest("/api/ci1302/records");
}

export async function getCiMonitorRecord(id: string): Promise<LocalAgentJob> {
  return agentRequest(`/api/ci1302/records/${encodeURIComponent(id)}`);
}

export async function startLocalAgentJob(input: {
  action: LocalAgentJobAction;
  boardId: LocalAgentJob["boardId"];
  port?: string;
  monitorMode?: CiMonitorMode;
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
  conversationId?: string;
  providerId?: string;
  llmTemperature?: number;
  llmMaxOutputTokens?: number;
  llmHistoryTurns?: number;
}): Promise<LlmModuleTestResult> {
  return request("/api/development/module-tests/llm", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function runVoicePipelineText(input: {
  deviceId: string;
  text: string;
  conversationId?: string;
  providerId?: string;
  ttsProviderId?: string;
  ttsVoice?: string;
  llmTemperature?: number;
  llmMaxOutputTokens?: number;
  llmHistoryTurns?: number;
}): Promise<VoicePipelineResponse> {
  return request("/api/voice/pipeline/test", {
    method: "POST",
    body: JSON.stringify({ ...input, inputSource: "TEXT_SIMULATION", simulateOffline: "MISS", applyToDevice: false, synthesizeSpeech: true }),
  });
}

export async function resetVoiceConversation(deviceId: string, channel: "pipeline" | "llm-test"): Promise<{ reset: true }> {
  return request("/api/voice/conversations/reset", {
    method: "POST",
    body: JSON.stringify({ deviceId, channel }),
  });
}

export async function runTtsModuleTest(input: {
  deviceId?: string;
  text: string;
  target: "BROWSER";
  providerId?: string;
  voice?: string;
}): Promise<BrowserTtsTestResult>;
export async function runTtsModuleTest(input: {
  deviceId: string;
  text: string;
  target: "DEVICE";
  volumePercent: number;
  providerId?: string;
  voice?: string;
}): Promise<DeviceAudioTestResult>;
export async function runTtsModuleTest(input: {
  deviceId?: string;
  text: string;
  target: "BROWSER" | "DEVICE";
  providerId?: string;
  voice?: string;
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

export async function getBoardLabDeviceState(deviceId: string): Promise<BoardLabDeviceState> {
  return request(`/api/development/board-lab/devices/${encodeURIComponent(deviceId)}`);
}

export async function startBoardLabAction(
  deviceId: string,
  action: BoardLabAction,
  params: Record<string, unknown> = {},
): Promise<BoardLabRequestRecord> {
  return request(`/api/development/board-lab/devices/${encodeURIComponent(deviceId)}/actions`, {
    method: "POST",
    body: JSON.stringify({ action, params }),
  });
}

export async function getBoardLabRequest(requestId: string): Promise<BoardLabRequestRecord> {
  return request(`/api/development/board-lab/requests/${encodeURIComponent(requestId)}`);
}

export async function getAiServiceConfiguration(): Promise<AiServiceConfiguration> {
  return request("/api/development/ai-services");
}

export async function getCatalogVendors(): Promise<CatalogVendor[]> {
  return request("/api/providers/catalog/vendors");
}

export async function saveCatalogApiKey(vendor: CatalogVendorId, apiKey: string): Promise<{ configured: boolean }> {
  return request(`/api/providers/catalog/${vendor}/api-key`, {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  });
}

export async function getCatalogModels(vendor: CatalogVendorId): Promise<CatalogModels> {
  return request(`/api/providers/catalog/${vendor}/models`);
}

export async function saveModelPricing(providerId: string, pricing: Partial<ModelProvider>): Promise<ModelProvider> {
  return request(`/api/providers/${encodeURIComponent(providerId)}/pricing`, {
    method: 'PUT',
    body: JSON.stringify(pricing),
  });
}

export async function addCatalogModel(vendor: CatalogVendorId, modelId: string): Promise<ModelProvider> {
  return request(`/api/providers/catalog/${vendor}/models`, {
    method: "POST",
    body: JSON.stringify({ modelId }),
  });
}

export async function useCatalogModel(vendor: CatalogVendorId, modelId: string): Promise<{
  provider: ModelProvider;
  defaults: AiServiceDefaults;
}> {
  return request(`/api/providers/catalog/${vendor}/default`, {
    method: "PUT",
    body: JSON.stringify({ modelId }),
  });
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

export async function importTestSetMarkdown(input: {
  name: string;
  description?: string;
  markdown: string;
  kind?: "SIMPLE" | "COMPLEX" | "CUSTOM";
}): Promise<TestSet> {
  return request("/api/test-sets/import-md", {
    method: "POST",
    body: JSON.stringify(input),
  });
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
