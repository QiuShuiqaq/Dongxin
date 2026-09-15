import type {
  BoardProfile,
  DeviceCommandRecord,
  DeviceExecutionTrace,
  DeviceProfile,
  DeviceState,
  ProductProfile,
  VoiceProfile,
} from "@dongxin/shared";

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

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:3077";

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
