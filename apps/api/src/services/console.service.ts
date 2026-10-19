import type {
  DeviceCommandRecord,
  DeviceEvent,
  DeviceExecutionTrace,
  ExecutionTraceStage,
} from "@dongxin/shared";
import { getMqttGatewayStatus } from "./mqttGateway.service.js";
import { listKnowledgeDocuments } from "./knowledge.service.js";
import { listProviders } from "./provider.service.js";
import { getProactiveSettings } from "./proactive.service.js";
import {
  listBoardProfiles,
  listProductProfiles,
  listVoiceProfiles,
} from "../repositories/hardwareConfig.repository.js";
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
    boards: boards.filter((board) => board.lifecycle !== "RETIRED"),
    products,
    voiceProfiles,
    devices,
    traces: buildExecutionTraces(commands, events).slice(0, 50),
    mqtt: getMqttGatewayStatus(),
    gates: [
      {
        id: "P0",
        label: "执行基线",
        status: "PASSED",
        detail: "现有STM32主控 + ESP32-C3联网语音模块；CI1302后续接入",
      },
      {
        id: "P1",
        label: "联网与消息",
        status: "PASSED",
        detail: "C3 WiFi、MQTT、命令收取和回执链路已有实板证据",
      },
      {
        id: "P2",
        label: "STM32只读接入",
        status: "PASSED",
        detail: "COM5通过GPIO19收到并校验真实32字节状态帧",
      },
      {
        id: "P3",
        label: "STM32双向控制",
        status: "ACTIVE",
        detail: "命令映射和安全顺序待实现；GPIO18发送保持禁用",
      },
      {
        id: "P4",
        label: "在线语音闭环",
        status: "ACTIVE",
        detail: "ASR/LLM/TTS接口已连通，实板受控播放和整链路待验证",
      },
      {
        id: "P5",
        label: "合同数据集",
        status: "BLOCKED",
        detail: "等待控制语料冻结及东信知识资料",
      },
      {
        id: "P6",
        label: "CI1302离线语音",
        status: "BLOCKED",
        detail: "后续样板阶段接入，不阻塞当前在线链路研发",
      },
    ],
  };
}

export async function getOperationsConsoleData() {
  const [
    devices,
    commands,
    events,
    logs,
    products,
    knowledgeDocuments,
    providers,
    proactiveSettings,
  ] = await Promise.all([
    listDeviceProfiles(),
    listDeviceCommands(),
    listDeviceEvents(),
    listSystemLogs(),
    listProductProfiles(),
    listKnowledgeDocuments(),
    listProviders(),
    getProactiveSettings(),
  ]);
  const operationalDevices = devices.filter((device) =>
    isOperationalDevice(device),
  );
  const operationalDeviceIds = new Set(
    operationalDevices.map((device) => device.id),
  );
  const operationalCommands = commands.filter((command) =>
    operationalDeviceIds.has(command.deviceId),
  );
  const recentEvents = events
    .filter((event) => operationalDeviceIds.has(event.deviceId))
    .reverse()
    .slice(0, 100);
  const faultEvents = recentEvents.filter((event) => event.type === "FAULT");
  const terminalCommands = operationalCommands.filter(
    (command) => command.status !== "QUEUED",
  );
  const successfulCommands = terminalCommands.filter(
    (command) => command.status === "APPLIED",
  );
  return {
    environment: "LOCAL_PREPRODUCTION" as const,
    devices: operationalDevices,
    recentCommands: [...operationalCommands].reverse().slice(0, 100),
    recentEvents,
    alerts: faultEvents,
    auditLogs: [...logs].reverse().slice(0, 100),
    products,
    knowledgeDocuments,
    providers,
    proactiveSettings,
    mqtt: getMqttGatewayStatus(),
    metrics: {
      totalDevices: operationalDevices.length,
      onlineDevices: operationalDevices.filter(
        (device) => device.status === "ONLINE",
      ).length,
      faultDevices: operationalDevices.filter(
        (device) => device.status === "FAULT",
      ).length,
      openAlerts: faultEvents.length,
      completedCommands: terminalCommands.length,
      commandSuccessRate: terminalCommands.length
        ? Math.round(
            (successfulCommands.length / terminalCommands.length) * 1000,
          ) / 10
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

function isOperationalDevice(device: {
  protocol: string;
  model: string;
}): boolean {
  if (device.protocol === "SIMULATOR") return false;
  const model = device.model.toUpperCase();
  return !["SIMULATOR", "SUPERMINI", "LICHUANG", "DEVKIT"].some((marker) =>
    model.includes(marker),
  );
}

function buildExecutionTraces(
  commands: DeviceCommandRecord[],
  events: DeviceEvent[],
): DeviceExecutionTrace[] {
  return [...commands].reverse().map((command) => {
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
    const message =
      stringOrNull(payload.message) ?? stringOrNull(error?.message);
    const pending = command.status === "QUEUED";
    const rejected = command.status === "REJECTED";
    const failed = command.status === "FAILED";
    const stm32Uart = executionPath === "STM32_UART";
    const stages: ExecutionTraceStage[] = [
      stage(
        "REQUEST",
        "平台下发",
        "COMPLETED",
        command.intent,
        "devices.routes.ts",
      ),
      stage(
        "MQTT",
        "MQTT投递",
        pending ? "PENDING" : "COMPLETED",
        `dongxin/v1/devices/${command.deviceId}/down/command`,
        "mqttGateway.service.ts",
      ),
      stage(
        "PARSER",
        "固件解析",
        pending ? "PENDING" : "COMPLETED",
        pending ? "等待设备回执" : "单动作命令已解析",
        "device_command.c",
      ),
      stage(
        "QUEUE",
        "C3命令队列",
        pending ? "PENDING" : "COMPLETED",
        "按来源串行处理",
        "command_queue.c",
      ),
      stage(
        "SAFETY",
        "动作校验",
        pending
          ? "PENDING"
          : rejected
            ? "REJECTED"
            : failed
              ? "FAILED"
              : "COMPLETED",
        errorCode ?? (rejected ? "命令被安全规则拒绝" : "动作和参数已校验"),
        "device_command.c",
      ),
      stage(
        "CONTROLLER",
        stm32Uart ? "STM32协议适配" : "研发模拟执行",
        pending
          ? "PENDING"
          : rejected
            ? "SKIPPED"
            : failed
              ? "FAILED"
              : "COMPLETED",
        message ??
          (stm32Uart ? "命令已转换为样机协议" : "当前未进入STM32物理控制"),
        stm32Uart ? "stm32_uart_adapter.c" : "device_controller.c",
      ),
      stage(
        "HAL",
        stm32Uart ? "STM32主控执行" : "虚拟状态更新",
        pending
          ? "PENDING"
          : rejected
            ? "SKIPPED"
            : failed
              ? "FAILED"
              : "COMPLETED",
        executionPath ?? "执行路径未随旧回执上报",
        stm32Uart ? "STM32 sample firmware" : "virtual HAL",
      ),
      stage(
        "STATE",
        "状态同步",
        pending ? "PENDING" : rejected || failed ? "SKIPPED" : "COMPLETED",
        isRecord(payload.state) ? "设备状态快照已上报" : "旧回执未包含状态快照",
        "device_state.c",
      ),
      stage(
        "RECEIPT",
        "结果回执",
        pending ? "PENDING" : "COMPLETED",
        command.status,
        "mqtt_agent.c",
      ),
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
