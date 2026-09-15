import type {
  DeviceCommandRecord,
  DeviceEvent,
  DeviceProfile,
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
  mqtt: { enabled: boolean; connected: boolean; brokerUrl: string };
  metrics: {
    totalDevices: number;
    onlineDevices: number;
    faultDevices: number;
    openAlerts: number;
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
  const response = await fetch(`${apiBaseUrl}/api/operations/console`);
  const payload = (await response.json()) as OperationsConsoleData & {
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`);
  return payload;
}
