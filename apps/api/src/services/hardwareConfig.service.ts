import { randomUUID } from "node:crypto";
import type {
  BleLocalControlSimulationResponse,
  Ci1302EventSimulationResponse,
  DeviceIntent,
  DeviceState,
  ProductCapabilityKey,
  ProductProfile,
  VoiceProfile,
  VoiceProfileStatus,
} from "@dongxin/shared";
import {
  BleLocalControlSimulationRequestSchema,
  Ci1302EventSimulationRequestSchema,
  ProductProfileSchema,
  VoiceProfileSchema,
  VoiceProfileTransitionRequestSchema,
} from "@dongxin/shared";
import { ApiError } from "../http/apiError.js";
import {
  findProductProfileByDeviceModel,
  getProductProfile,
  getVoiceProfile,
  listProductProfiles,
  listVoiceProfiles,
  saveProductProfile,
  saveVoiceProfile,
} from "../repositories/hardwareConfig.repository.js";
import {
  getCurrentDeviceState,
  executeDeviceCommand,
} from "./device.service.js";
import { appendLog } from "./log.service.js";
import { getDeviceProfile } from "../repositories/system.repository.js";

const STATUS_TRANSITIONS: Record<VoiceProfileStatus, VoiceProfileStatus[]> = {
  DRAFT: ["RESOURCE_GENERATING"],
  RESOURCE_GENERATING: ["DRAFT", "SAMPLE_VALIDATION"],
  SAMPLE_VALIDATION: ["DRAFT", "APPROVED"],
  APPROVED: ["SAMPLE_VALIDATION", "RELEASED"],
  RELEASED: ["ROLLED_BACK"],
  ROLLED_BACK: ["DRAFT"],
};

const INTENT_CAPABILITY: Partial<Record<DeviceIntent, ProductCapabilityKey>> = {
  LIGHT_ON: "LIGHT",
  LIGHT_OFF: "LIGHT",
  NIGHT_LIGHT_ON: "NIGHT_LIGHT",
  NIGHT_LIGHT_OFF: "NIGHT_LIGHT",
  HEAT_WEAK_ON: "HEAT_WEAK",
  HEAT_WEAK_OFF: "HEAT_WEAK",
  HEAT_STRONG_ON: "HEAT_STRONG",
  HEAT_STRONG_OFF: "HEAT_STRONG",
  FAN_ON: "FAN",
  FAN_OFF: "FAN",
  VENTILATION_ON: "VENTILATION",
  VENTILATION_OFF: "VENTILATION",
  SWING_ON: "SWING",
  SWING_OFF: "SWING",
  PURIFY_ON: "PURIFICATION",
  PURIFY_OFF: "PURIFICATION",
  DRY_ON: "DRY",
  DRY_OFF: "DRY",
  DEFOG_ON: "DEFOG",
  DEFOG_OFF: "DEFOG",
  BATH_MODE_ON: "BATH_MODE",
  BATH_MODE_OFF: "BATH_MODE",
  CONSTANT_TEMP_ON: "CONSTANT_TEMPERATURE",
  CONSTANT_TEMP_OFF: "CONSTANT_TEMPERATURE",
  SET_TEMP: "TARGET_TEMPERATURE",
};

const lastBleResults = new Map<
  string,
  BleLocalControlSimulationResponse
>();

export async function getHardwareConfig() {
  const [productProfiles, voiceProfiles] = await Promise.all([
    listProductProfiles(),
    listVoiceProfiles(),
  ]);
  return { productProfiles, voiceProfiles };
}

export async function updateProductProfile(
  profileId: string,
  body: unknown,
): Promise<ProductProfile> {
  const existing = await requireProductProfile(profileId);
  const profile = ProductProfileSchema.parse({
    ...(body as Record<string, unknown>),
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  });
  validateSafetyDefaults(profile);
  const saved = await saveProductProfile(profile);
  await appendLog({
    type: "DEVICE",
    summary: `Product profile updated ${profile.model}`,
    payload: {
      profileId: profile.id,
      capabilityCount: profile.capabilities.length,
    },
  });
  return saved;
}

export async function updateVoiceProfile(
  profileId: string,
  body: unknown,
): Promise<VoiceProfile> {
  const existing = await requireVoiceProfile(profileId);
  if (
    existing.status !== "DRAFT" &&
    existing.status !== "RESOURCE_GENERATING"
  ) {
    throw new ApiError(
      409,
      "VOICE_PROFILE_LOCKED",
      "已进入样机验证的版本不可直接修改，请复制为新草稿",
    );
  }
  const profile = VoiceProfileSchema.parse({
    ...(body as Record<string, unknown>),
    id: existing.id,
    status: existing.status,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  });
  if (
    existing.status === "RESOURCE_GENERATING" &&
    (profile.productProfileId !== existing.productProfileId ||
      profile.version !== existing.version ||
      profile.wakeWord !== existing.wakeWord ||
      profile.supportsSeparateAndContinuousSpeech !==
        existing.supportsSeparateAndContinuousSpeech ||
      profile.personalWakeWordPolicy !== existing.personalWakeWordPolicy ||
      profile.offlineFirst !== existing.offlineFirst ||
      JSON.stringify(profile.commands) !== JSON.stringify(existing.commands))
  ) {
    throw new ApiError(
      409,
      "VOICE_CONTENT_LOCKED",
      "资源生成开始后词表已冻结，请先退回草稿再修改",
    );
  }
  await requireProductProfile(profile.productProfileId);
  assertUniqueSemanticIds(profile);
  const saved = await saveVoiceProfile(profile);
  await appendLog({
    type: "VOICE",
    summary: `Voice profile updated ${profile.version}`,
    payload: {
      profileId: profile.id,
      status: profile.status,
      commandCount: profile.commands.length,
    },
  });
  return saved;
}

export async function transitionVoiceProfile(
  profileId: string,
  body: unknown,
): Promise<VoiceProfile> {
  const existing = await requireVoiceProfile(profileId);
  const { nextStatus } = VoiceProfileTransitionRequestSchema.parse(body);
  if (!STATUS_TRANSITIONS[existing.status].includes(nextStatus)) {
    throw new ApiError(
      409,
      "INVALID_VOICE_PROFILE_TRANSITION",
      `语音版本不能从 ${existing.status} 直接进入 ${nextStatus}`,
    );
  }
  if (nextStatus === "SAMPLE_VALIDATION" && !existing.resource) {
    throw new ApiError(
      409,
      "VOICE_RESOURCE_REQUIRED",
      "进入样机验证前必须记录资源包文件和 SHA-256",
    );
  }
  if (nextStatus === "RELEASED") {
    const profiles = await listVoiceProfiles();
    const released = profiles.find(
      (profile) =>
        profile.productProfileId === existing.productProfileId &&
        profile.status === "RELEASED" &&
        profile.id !== existing.id,
    );
    if (released) {
      throw new ApiError(
        409,
        "ACTIVE_VOICE_PROFILE_EXISTS",
        `请先回滚当前发布版本 ${released.version}`,
      );
    }
  }
  const saved = await saveVoiceProfile({
    ...existing,
    status: nextStatus,
    updatedAt: new Date().toISOString(),
  });
  await appendLog({
    type: "VOICE",
    summary: `Voice profile ${existing.version}: ${existing.status} -> ${nextStatus}`,
    payload: {
      profileId: existing.id,
      previousStatus: existing.status,
      nextStatus,
    },
  });
  return saved;
}

export async function cloneVoiceProfile(
  profileId: string,
  version: string,
): Promise<VoiceProfile> {
  const existing = await requireVoiceProfile(profileId);
  const profiles = await listVoiceProfiles();
  if (
    profiles.some(
      (profile) =>
        profile.productProfileId === existing.productProfileId &&
        profile.version === version,
    )
  ) {
    throw new ApiError(
      409,
      "VOICE_VERSION_EXISTS",
      `语音版本 ${version} 已存在`,
    );
  }
  const now = new Date().toISOString();
  const saved = await saveVoiceProfile({
    ...existing,
    id: `voice-${randomUUID()}`,
    version,
    status: "DRAFT",
    resource: null,
    createdAt: now,
    updatedAt: now,
  });
  await appendLog({
    type: "VOICE",
    summary: `Voice profile cloned ${existing.version} -> ${version}`,
    payload: { sourceProfileId: existing.id, profileId: saved.id },
  });
  return saved;
}

export async function assertDeviceIntentSupported(
  model: string,
  intent: DeviceIntent,
): Promise<void> {
  const profile = await findProductProfileByDeviceModel(model);
  if (!profile) {
    return;
  }
  assertIntentSupported(profile, intent);
}

export async function simulateCi1302Event(
  body: unknown,
): Promise<Ci1302EventSimulationResponse> {
  const input = Ci1302EventSimulationRequestSchema.parse(body);
  const product = await requireProductProfile(input.productProfileId);
  const voice = await requireVoiceProfile(input.voiceProfileId);
  const device = await getDeviceProfile(input.deviceId);
  if (!device) {
    throw new ApiError(
      404,
      "DEVICE_NOT_FOUND",
      `Unknown device: ${input.deviceId}`,
    );
  }
  if (
    device.model !== product.model &&
    !product.deviceModelAliases.includes(device.model)
  ) {
    throw new ApiError(
      422,
      "DEVICE_PRODUCT_MISMATCH",
      "测试设备不属于所选产品型号",
    );
  }
  if (voice.productProfileId !== product.id) {
    throw new ApiError(
      422,
      "VOICE_PRODUCT_MISMATCH",
      "语音版本不属于所选产品型号",
    );
  }

  let response: Ci1302EventSimulationResponse = {
    accepted: true,
    route: "NO_ACTION",
    eventType: input.eventType,
    semanticId: input.semanticId ?? null,
    matchedCommand: null,
    reason: "事件已接收，不触发负载控制",
    feedback: "",
    deviceState: getCurrentDeviceState(),
  };

  if (input.eventType === "OFFLINE_MISS") {
    response = {
      ...response,
      route: input.networkOnline ? "ONLINE_ASR" : "NETWORK_UNAVAILABLE",
      reason: input.networkOnline
        ? "离线未命中，进入在线 ASR 链路"
        : "离线未命中且网络不可用",
      feedback: input.networkOnline ? "" : "网络未连接，请使用固定指令",
    };
  } else if (input.eventType === "OFFLINE_COMMAND") {
    const command = voice.commands.find(
      (item) => item.enabled && item.semanticId === input.semanticId,
    );
    if (!command) {
      response = {
        ...response,
        accepted: false,
        route: "REJECTED",
        reason: "语义 ID 未在当前语音版本中启用",
        feedback: "REJECT",
      };
    } else {
      assertIntentSupported(product, command.intent);
      const safetyRejection = getSimulatedSafetyRejection(
        command.intent,
        command.slots,
        getCurrentDeviceState(),
      );
      response = safetyRejection
        ? {
            ...response,
            accepted: false,
            route: "REJECTED",
            matchedCommand: command,
            reason: safetyRejection,
            feedback: "REJECT",
          }
        : {
            ...response,
            route: "LOCAL_CONTROL",
            matchedCommand: command,
            reason: "CI1302 仅上报语义，控制由 C3 统一状态机执行",
            feedback: command.feedbackTone,
            deviceState: input.applyToDevice
              ? executeDeviceCommand(command.intent, command.slots)
              : getCurrentDeviceState(),
          };
    }
  }

  await appendLog({
    type: "DEVICE",
    summary: `CI1302 event ${input.eventType}`,
    payload: {
      ...input,
      route: response.route,
      matchedIntent: response.matchedCommand?.intent ?? null,
      accepted: response.accepted,
    },
  });
  return response;
}

export async function simulateBleLocalControl(
  body: unknown,
): Promise<BleLocalControlSimulationResponse> {
  const input = BleLocalControlSimulationRequestSchema.parse(body);
  const product = await requireProductProfile(input.productProfileId);
  const device = await getDeviceProfile(input.deviceId);
  if (!device) {
    throw new ApiError(
      404,
      "DEVICE_NOT_FOUND",
      `Unknown device: ${input.deviceId}`,
    );
  }
  if (
    device.model !== product.model &&
    !product.deviceModelAliases.includes(device.model)
  ) {
    throw new ApiError(
      422,
      "DEVICE_PRODUCT_MISMATCH",
      "测试设备不属于所选产品型号",
    );
  }

  const resultKey = [
    input.deviceId,
    input.controllerType,
    input.controllerId,
  ].join(":");
  const previous = lastBleResults.get(resultKey);
  if (previous?.sequence === input.sequence) {
    return {
      ...previous,
      outcome: "DUPLICATE",
      duplicate: true,
      reason: "重复序号未再次执行，返回上一次结果",
      deviceState: getCurrentDeviceState(),
    };
  }

  let response: BleLocalControlSimulationResponse;
  if (!input.bonded || !input.encrypted) {
    response = {
      accepted: false,
      route: "UNAUTHORIZED",
      outcome: "REJECTED",
      controllerType: input.controllerType,
      controllerId: input.controllerId,
      sequence: input.sequence,
      intent: input.intent,
      duplicate: false,
      stateTransmitted: false,
      reason: !input.bonded
        ? "终端不在C3绑定白名单中"
        : "控制特征只允许加密连接访问",
      deviceState: getCurrentDeviceState(),
    };
  } else if (
    (input.controllerType === "WALL_PANEL" &&
      product.localControllers.wallPanelCount < 1) ||
    (input.controllerType === "HANDHELD_REMOTE" &&
      product.localControllers.handheldRemoteCount < 1)
  ) {
    response = {
      accepted: false,
      route: "REJECTED",
      outcome: "REJECTED",
      controllerType: input.controllerType,
      controllerId: input.controllerId,
      sequence: input.sequence,
      intent: input.intent,
      duplicate: false,
      stateTransmitted: true,
      reason: "当前产品型号未配置该类BLE终端",
      deviceState: getCurrentDeviceState(),
    };
  } else {
    const capabilityKey = INTENT_CAPABILITY[input.intent];
    const capability = capabilityKey
      ? product.capabilities.find((item) => item.key === capabilityKey)
      : null;
    if (capabilityKey && capability?.support !== "ENABLED") {
      response = {
        accepted: false,
        route: "REJECTED",
        outcome: "REJECTED",
        controllerType: input.controllerType,
        controllerId: input.controllerId,
        sequence: input.sequence,
        intent: input.intent,
        duplicate: false,
        stateTransmitted: true,
        reason: `产品能力未启用：${capability?.label ?? capabilityKey}`,
        deviceState: getCurrentDeviceState(),
      };
    } else {
      const safetyRejection = getSimulatedSafetyRejection(
        input.intent,
        input.slots,
        getCurrentDeviceState(),
      );
      response = safetyRejection
        ? {
            accepted: false,
            route: "REJECTED",
            outcome: "REJECTED",
            controllerType: input.controllerType,
            controllerId: input.controllerId,
            sequence: input.sequence,
            intent: input.intent,
            duplicate: false,
            stateTransmitted: true,
            reason: safetyRejection,
            deviceState: getCurrentDeviceState(),
          }
        : {
            accepted: true,
            route: "LOCAL_CONTROL",
            outcome: input.applyToDevice ? "APPLIED" : "VALIDATED",
            controllerType: input.controllerType,
            controllerId: input.controllerId,
            sequence: input.sequence,
            intent: input.intent,
            duplicate: false,
            stateTransmitted: true,
            reason: input.applyToDevice
              ? "平台模拟C3统一命令入口并更新模拟设备状态"
              : "协议、授权和产品能力校验通过，未修改模拟设备",
            deviceState: input.applyToDevice
              ? executeDeviceCommand(input.intent, input.slots)
              : getCurrentDeviceState(),
          };
    }
  }

  lastBleResults.set(resultKey, response);
  await appendLog({
    type: "DEVICE",
    summary: `BLE local control ${input.controllerType}`,
    payload: {
      ...input,
      route: response.route,
      outcome: response.outcome,
      accepted: response.accepted,
    },
  });
  return response;
}

function getSimulatedSafetyRejection(
  intent: DeviceIntent,
  slots: Record<string, unknown>,
  state: DeviceState,
): string | null {
  const heating = state.activeModes.some((mode) =>
    [
      "HEAT_WEAK_ON",
      "HEAT_STRONG_ON",
      "BATH_MODE_ON",
      "CONSTANT_TEMP_ON",
    ].includes(mode),
  );
  const airflow =
    heating ||
    state.activeModes.some((mode) =>
      ["FAN_ON", "VENTILATION_ON", "DRY_ON"].includes(mode),
    );

  if (
    state.faultCode &&
    ["HEAT_WEAK_ON", "HEAT_STRONG_ON", "BATH_MODE_ON", "CONSTANT_TEMP_ON"].includes(
      intent,
    )
  ) {
    return "设备故障锁定期间禁止开启取暖";
  }
  if (intent === "FAN_OFF" && heating) {
    return "取暖期间不能关闭风机";
  }
  if (intent === "VENTILATION_ON" && heating) {
    return "取暖期间不能切换到换气";
  }
  if (intent === "SWING_ON" && !airflow) {
    return "开启摆风前必须先开启风路";
  }
  if (
    intent === "SET_TEMP" &&
    (typeof slots.temperature !== "number" ||
      !Number.isInteger(slots.temperature) ||
      slots.temperature < 30 ||
      slots.temperature > 45)
  ) {
    return "目标温度范围为30至45摄氏度";
  }
  if (
    intent === "SET_TIMER" &&
    (typeof slots.durationMinutes !== "number" ||
      !Number.isInteger(slots.durationMinutes) ||
      slots.durationMinutes < 1 ||
      slots.durationMinutes > 120)
  ) {
    return "定时范围为1至120分钟";
  }
  return null;
}

function assertIntentSupported(
  profile: ProductProfile,
  intent: DeviceIntent,
): void {
  const capabilityKey = INTENT_CAPABILITY[intent];
  if (!capabilityKey) {
    return;
  }
  const capability = profile.capabilities.find(
    (item) => item.key === capabilityKey,
  );
  if (!capability || capability.support !== "ENABLED") {
    throw new ApiError(
      422,
      "UNSUPPORTED",
      `${profile.name} 未启用能力 ${capability?.label ?? capabilityKey}`,
    );
  }
}

function validateSafetyDefaults(profile: ProductProfile): void {
  const safety = profile.safetyDefaults;
  if (
    safety.targetTemperatureMinCelsius >
      safety.targetTemperatureDefaultCelsius ||
    safety.targetTemperatureDefaultCelsius > safety.targetTemperatureMaxCelsius
  ) {
    throw new ApiError(
      422,
      "INVALID_TEMPERATURE_RANGE",
      "默认目标温度必须位于最小值与最大值之间",
    );
  }
  const io = profile.ioExpansion;
  if (
    io.addresses.length !== io.deviceCount ||
    new Set(io.addresses).size !== io.addresses.length ||
    io.portCount !== io.deviceCount * 8 ||
    io.addresses.some((address) => address < 0x20 || address > 0x27)
  ) {
    throw new ApiError(
      422,
      "INVALID_IO_EXPANSION",
      "PCF8574地址必须位于0x20至0x27、保持唯一，且每颗芯片对应8路IO",
    );
  }
  if (
    profile.status === "ACTIVE" &&
    profile.controller === "ESP32_C3" &&
    (profile.flashSizeMB < 8 || !profile.otaReserved)
  ) {
    throw new ApiError(
      422,
      "INVALID_PRODUCTION_FLASH",
      "ACTIVE C3产品必须使用至少8MB Flash并预留OTA",
    );
  }
  if (
    profile.status === "ACTIVE" &&
    (!safety.hardwareThermalCutoffRequired ||
      !safety.powerOnAllLoadsOff ||
      !safety.heatRequiresFan)
  ) {
    throw new ApiError(
      422,
      "INVALID_PRODUCTION_SAFETY",
      "ACTIVE产品不能关闭硬件温断、上电全关或取暖风机互锁",
    );
  }
  if (
    profile.localControllers.wallPanelCount +
      profile.localControllers.handheldRemoteCount >
    profile.localControllers.maximumBondedControllers
  ) {
    throw new ApiError(
      422,
      "INVALID_BLE_CONTROLLER_LIMIT",
      "默认绑定终端数量不能超过最大BLE绑定数量",
    );
  }
}

function assertUniqueSemanticIds(profile: VoiceProfile): void {
  const ids = profile.commands.map((command) => command.semanticId);
  if (new Set(ids).size !== ids.length) {
    throw new ApiError(
      422,
      "DUPLICATE_SEMANTIC_ID",
      "同一语音版本内的语义 ID 不可重复",
    );
  }
}

async function requireProductProfile(
  profileId: string,
): Promise<ProductProfile> {
  const profile = await getProductProfile(profileId);
  if (!profile) {
    throw new ApiError(
      404,
      "PRODUCT_PROFILE_NOT_FOUND",
      `Unknown product profile: ${profileId}`,
    );
  }
  return profile;
}

async function requireVoiceProfile(profileId: string): Promise<VoiceProfile> {
  const profile = await getVoiceProfile(profileId);
  if (!profile) {
    throw new ApiError(
      404,
      "VOICE_PROFILE_NOT_FOUND",
      `Unknown voice profile: ${profileId}`,
    );
  }
  return profile;
}
