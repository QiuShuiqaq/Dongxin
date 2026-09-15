import type {
  DeviceCommandRecord,
  DeviceEvent,
  DeviceExecutionTrace,
  ExecutionTraceStage,
} from "@dongxin/shared";
import { getMqttGatewayStatus } from "./mqttGateway.service.js";
import { listBoardProfiles, listProductProfiles, listVoiceProfiles } from "../repositories/hardwareConfig.repository.js";
import {
  listDeviceCommands,
  listDeviceEvents,
  listDeviceProfiles,
  listSystemLogs,
} from "../repositories/system.repository.js";

export async function getDevelopmentConsoleData() {
  const [boards, products, voiceProfiles, devices, commands, events] =
    await Promise.all([
      listBoardProfiles(),
      listProductProfiles(),
      listVoiceProfiles(),
      listDeviceProfiles(),
      listDeviceCommands(),
      listDeviceEvents(),
    ]);
  return {
    environment: "LOCAL_DEVELOPMENT" as const,
    boards,
    products,
    voiceProfiles,
    devices,
    traces: buildExecutionTraces(commands, events).slice(0, 50),
    mqtt: getMqttGatewayStatus(),
    gates: [
      { id: "G0", label: "方案与边界", status: "PASSED", detail: "C3单主控、CI1302、3×PCF8574基线已确认" },
      { id: "G1", label: "C3软件闭环", status: "PASSED", detail: "COM3实板WiFi/MQTT/安全状态机闭环通过" },
      { id: "G2", label: "低压IO联调", status: "BLOCKED", detail: "等待DX-AI-01 Rev.A样板和最终GPIO表" },
      { id: "G3", label: "语音链路", status: "BLOCKED", detail: "等待CI1302样板、SDK资源与PCM实测" },
      { id: "G4", label: "真实负载验收", status: "BLOCKED", detail: "等待NTC、PTC、电机参数及东信安全样板" },
    ],
  };
}

export async function getOperationsConsoleData() {
  const [devices, commands, events, logs, products] = await Promise.all([
    listDeviceProfiles(),
    listDeviceCommands(),
    listDeviceEvents(),
    listSystemLogs(),
    listProductProfiles(),
  ]);
  const operationalDevices = devices.filter(
    (device) =>
      device.protocol !== "SIMULATOR" &&
      !device.model.toUpperCase().includes("SIMULATOR"),
  );
  const operationalDeviceIds = new Set(operationalDevices.map((device) => device.id));
  const operationalCommands = commands.filter((command) =>
    operationalDeviceIds.has(command.deviceId),
  );
  const recentEvents = events
    .filter((event) => operationalDeviceIds.has(event.deviceId))
    .reverse()
    .slice(0, 100);
  const faultEvents = recentEvents.filter((event) => event.type === "FAULT");
  const terminalCommands = operationalCommands.filter((command) => command.status !== "QUEUED");
  const successfulCommands = terminalCommands.filter((command) => command.status === "APPLIED");
  return {
    environment: "LOCAL_PREPRODUCTION" as const,
    devices: operationalDevices,
    recentCommands: [...operationalCommands].reverse().slice(0, 100),
    recentEvents,
    alerts: faultEvents,
    auditLogs: [...logs].reverse().slice(0, 100),
    products,
    mqtt: getMqttGatewayStatus(),
    metrics: {
      totalDevices: operationalDevices.length,
      onlineDevices: operationalDevices.filter((device) => device.status === "ONLINE").length,
      faultDevices: operationalDevices.filter((device) => device.status === "FAULT").length,
      openAlerts: faultEvents.length,
      commandSuccessRate: terminalCommands.length
        ? Math.round((successfulCommands.length / terminalCommands.length) * 1000) / 10
        : 100,
    },
    productionReadiness: {
      database: "LOCAL_JSON",
      mqtt: "LOCAL_BROKER",
      authentication: "NOT_CONFIGURED",
      deployment: "DEVELOPMENT_ONLY",
    },
  };
}

function buildExecutionTraces(
  commands: DeviceCommandRecord[],
  events: DeviceEvent[],
): DeviceExecutionTrace[] {
  return [...commands]
    .reverse()
    .map((command) => {
      const resultEvent = [...events]
        .reverse()
        .find(
          (event) =>
            event.deviceId === command.deviceId &&
            event.type === "COMMAND_RESULT" &&
            event.payload.commandId === command.id,
        );
      const payload = resultEvent?.payload ?? {};
      const error = isRecord(payload.error) ? payload.error : null;
      const executionPath = stringOrNull(payload.executionPath);
      const errorCode = stringOrNull(error?.code);
      const message = stringOrNull(payload.message) ?? stringOrNull(error?.message);
      const pending = command.status === "QUEUED";
      const rejected = command.status === "REJECTED";
      const failed = command.status === "FAILED";
      const stages: ExecutionTraceStage[] = [
        stage("REQUEST", "平台下发", "COMPLETED", command.intent, "devices.routes.ts"),
        stage("MQTT", "MQTT投递", pending ? "PENDING" : "COMPLETED", `dongxin/v1/devices/${command.deviceId}/down/command`, "mqttGateway.service.ts"),
        stage("PARSER", "固件解析", pending ? "PENDING" : "COMPLETED", pending ? "等待设备回执" : "单动作命令已解析", "device_command.c"),
        stage("QUEUE", "统一队列", pending ? "PENDING" : "COMPLETED", "按来源串行执行", "command_queue.c"),
        stage("SAFETY", "安全状态机", pending ? "PENDING" : rejected ? "REJECTED" : failed ? "FAILED" : "COMPLETED", errorCode ?? (rejected ? "命令被本地安全规则拒绝" : "本地规则通过"), "device_controller.c"),
        stage("CONTROLLER", "设备控制器", pending ? "PENDING" : rejected ? "SKIPPED" : failed ? "FAILED" : "COMPLETED", message ?? "状态迁移完成", "device_controller.c"),
        stage("HAL", "硬件抽象层", pending ? "PENDING" : rejected ? "SKIPPED" : failed ? "FAILED" : "COMPLETED", executionPath ?? "执行路径未随旧回执上报", "direct_control_hal.c"),
        stage("STATE", "状态同步", pending ? "PENDING" : rejected || failed ? "SKIPPED" : "COMPLETED", isRecord(payload.state) ? "设备状态快照已上报" : "旧回执未包含状态快照", "device_state.c"),
        stage("RECEIPT", "结果回执", pending ? "PENDING" : "COMPLETED", command.status, "mqtt_agent.c"),
      ];
      return {
        traceId: `trace-${command.id}`,
        commandId: command.id,
        deviceId: command.deviceId,
        intent: command.intent,
        status: command.status,
        executionPath,
        errorCode,
        message,
        startedAt: command.createdAt,
        completedAt: command.completedAt ?? null,
        stages,
        state: isRecord(payload.state) ? payload.state : null,
      };
    });
}

function stage(
  key: ExecutionTraceStage["key"],
  label: string,
  status: ExecutionTraceStage["status"],
  detail: string,
  module: string,
): ExecutionTraceStage {
  return { key, label, status, detail, module };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}
