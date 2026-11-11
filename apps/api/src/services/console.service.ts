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
import { getOperationsAuthStatus } from "./operationsAuth.service.js";
import { getRuntimeStatus } from '../runtime/status.js';
import { PILOT_DEVICE_LIMIT } from '../runtime/pilotLimits.js';
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
        detail: "现有 STM32 主控 + ESP32-C3 联网语音；CI1302 已接线，新固件联调待验收",
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
        status: "PASSED",
        detail: "真实样机已完成照明、吹风命令下发、状态回传和匹配回执闭环",
      },
      {
        id: "P4",
        label: "在线语音闭环",
        status: "ACTIVE",
        detail: "在线录音、ASR/规则/LLM、STM32回执判定和受控TTS代码已贯通，效果验收由研发人员手动执行",
      },
      {
        id: "P5",
        label: "合同数据集",
        status: "BLOCKED",
        detail: "首批企业资料已整理，待补充型号说明书、售后规则及正式测试数据集",
      },
      {
        id: "P6",
        label: "CI1302离线语音",
        status: "ACTIVE",
        detail: "开发板已实测唤醒及照明词码；STM32/C3软件接入已编译，样机烧录及在线离线仲裁实物验收待完成",
      },
      {
        id: "P7",
        label: "生产平台",
        status: "ACTIVE",
        detail: "进入生产化准备；本地预生产能力已具备，云端鉴权、独立设备密钥和基础设施待实施",
      },
    ],
  };
}

export async function getOperationsConsoleData(section = 'all') {
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
    (command) => ["APPLIED", "REJECTED", "FAILED"].includes(command.status),
  );
  const successfulCommands = terminalCommands.filter(
    (command) => command.status === "APPLIED",
  );
  return {
    environment: process.env.NODE_ENV === 'production' ? 'BOUNDED_HARDWARE_PILOT' : 'LOCAL_PREPRODUCTION',
    runtime: ['system', 'all'].includes(section) ? getRuntimeStatus() : undefined,
    devices: section === 'all' ? operationalDevices : section === 'overview' ? operationalDevices.slice(0, 8) : [],
    recentCommands: ['all', 'overview', 'records'].includes(section) ? [...operationalCommands].reverse().slice(0, section === 'overview' ? 10 : 100) : [],
    recentEvents: ['all', 'overview', 'devices', 'records'].includes(section) ? recentEvents : [],
    alerts: ['all', 'records'].includes(section) ? faultEvents : [],
    auditLogs: ['all', 'records'].includes(section) ? [...logs].reverse().slice(0, 100) : [],
    products: ['all', 'devices'].includes(section) ? products : [],
    knowledgeDocuments: section === 'all' ? knowledgeDocuments : [],
    knowledgeStats: { published: knowledgeDocuments.filter((item) => item.status === 'PUBLISHED').length,
      review: knowledgeDocuments.filter((item) => item.status === 'IN_REVIEW').length,
      drafts: knowledgeDocuments.filter((item) => item.status === 'DRAFT').length, archived: knowledgeDocuments.filter((item) => item.status === 'ARCHIVED').length },
    logCount: logs.length,
    providers: ['all', 'ai', 'overview'].includes(section) ? providers : [],
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
      database: "LOCAL_JSON_NOT_PRODUCTION",
      pilotDeviceCount: devices.filter((device) => device.protocol !== 'SIMULATOR').length,
      pilotDeviceLimit: PILOT_DEVICE_LIMIT,
      mqtt: getMqttGatewayStatus().brokerUrl.startsWith('mqtts://') ? 'MQTT_TLS' : 'LOCAL_BROKER',
      authentication: getOperationsAuthStatus().readiness,
      deployment: process.env.NODE_ENV === 'production' ? 'BOUNDED_PILOT_ONLY' : 'DEVELOPMENT_ONLY',
    },
  };
}

export async function getOperationsDevicePage(query: { page: number; pageSize: number; search: string; status?: string }) {
  const search = query.search.trim().toLowerCase();
  const devices = (await listDeviceProfiles()).filter(isOperationalDevice)
    .filter((device) => (!query.status || device.status === query.status)
      && (!search || [device.id, device.name, device.model, device.firmwareVersion ?? ''].join(' ').toLowerCase().includes(search)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { items: devices.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: devices.length, page: query.page };
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
