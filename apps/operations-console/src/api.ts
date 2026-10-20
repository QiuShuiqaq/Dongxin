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

export interface OperationsUser {
  username: string;
  displayName: string;
  role: "ADMIN";
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

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:3077";
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
