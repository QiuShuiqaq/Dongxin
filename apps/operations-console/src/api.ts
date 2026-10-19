import type {
  DeviceCommandRecord,
  DeviceEvent,
  DeviceProfile,
  KnowledgeCategory,
  KnowledgeDocument,
  ModelProvider,
  ProactiveMode,
  ProactiveSettings,
  ProductProfile,
  SystemLog,
} from "@dongxin/shared";

export interface OperationsConsoleData {
  environment: "LOCAL_PREPRODUCTION";
  devices: DeviceProfile[];
  recentCommands: DeviceCommandRecord[];
  recentEvents: DeviceEvent[];
  alerts: DeviceEvent[];
  auditLogs: SystemLog[];
  products: ProductProfile[];
  knowledgeDocuments: KnowledgeDocument[];
  providers: ModelProvider[];
  proactiveSettings: ProactiveSettings;
  mqtt: { enabled: boolean; connected: boolean; brokerUrl: string };
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
    mqtt: string;
    authentication: string;
    deployment: string;
  };
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:3077";

export async function getOperationsConsole(): Promise<OperationsConsoleData> {
  return request("/api/operations/console");
}

export async function createKnowledgeDocument(input: {
  title: string;
  category: KnowledgeCategory;
  content: string;
  tags: string[];
  status: "DRAFT" | "PUBLISHED";
}): Promise<KnowledgeDocument> {
  return request("/api/knowledge/documents", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateProactiveSettings(input: {
  enabled?: boolean;
  mode?: ProactiveMode;
  minIntervalMinutes?: number;
}): Promise<ProactiveSettings> {
  return request("/api/proactive/settings", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
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
