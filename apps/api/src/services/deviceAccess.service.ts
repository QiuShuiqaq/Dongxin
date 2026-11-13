import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type {
  AiResult,
  DeviceAccessEventRequest,
  DeviceAction,
  DeviceCloudState,
  DeviceCommandRecord,
  DeviceCommandResultRequest,
  DeviceHeartbeatRequest,
  DeviceIntent,
  DeviceProfile,
  DeviceRegisterRequest,
  DeviceState,
  DeviceStateReportRequest,
  ModelProvider
} from '@dongxin/shared';
import {
  DeviceAccessEventRequestSchema,
  DeviceAccessVoiceTurnRequestSchema,
  DeviceCommandResultRequestSchema,
  DeviceHeartbeatRequestSchema,
  DeviceRegisterRequestSchema,
  DeviceStateReportRequestSchema,
  LocalControlEventPayloadSchema
} from '@dongxin/shared';
import { isEnvConfigured } from '../envStore.js';
import { ApiError } from '../http/apiError.js';
import { callModel } from '../modelGateway.js';
import { applySafetyRules } from '../rules.js';
import {
  finishDeviceCommand,
  listDeviceCommands,
  patchDeviceCommand,
  updateDeviceProfiles,
} from '../repositories/system.repository.js';
import { patchCurrentDeviceState } from './device.service.js';
import { getProvisionedDeviceModel } from './deviceAuth.service.js';
import {
  getDevice,
  getDeviceState,
  listDevices,
  queueDeviceCommand,
  recordDeviceEvent,
  saveDevices
} from './deviceRegistry.service.js';
import { appendLog } from './log.service.js';
import { resolveLowCostIntent } from './lowCostIntent.service.js';
import { getVoiceKnowledge } from './knowledge.service.js';
import { findPrompt, listPrompts } from './prompt.service.js';
import { findProvider, listProviders } from './provider.service.js';
import { handleProactiveEvent } from './proactive.service.js';
import { runVoiceWork, assertWorkActive } from '../runtime/workload.js';
import { bumpDeviceControlRevision, getDeviceControlRevision, getDeviceState as getCachedDeviceState } from '../deviceSimulator.js';
import { voiceCommandGuard, isCommandCurrent, isCommandRevisionCurrent, commandExpiresAt, assertVoiceRevision } from '../runtime/commandGuard.js';
import { RequestReplay } from '../runtime/requestReplay.js';
import { cloudStateToDeviceStatePatch, deviceStateChanged } from '../runtime/deviceCloudState.js';
import { devicePresence } from '../runtime/devicePresence.js';
import {
  appendProductionVoiceHistory,
  type ProductionVoiceHistoryInput,
} from '../repositories/productionVoiceHistory.repository.js';

export { cloudStateToDeviceStatePatch } from '../runtime/deviceCloudState.js';

const localEventReplay = new RequestReplay(2048, 1024 * 1024, 60_000);

export interface DeviceAccessUsage {
  usedLlm: boolean;
  providerId: string | null;
  inputTokens: number;
  outputTokens: number;
  costCny: number | null;
  isEstimated: boolean;
  latencyMs: number;
}

export interface DeviceVoiceTurnData {
  sessionId: string;
  replyText: string;
  needConfirm: boolean;
  confirmToken: string | null;
  source: 'rule' | 'knowledge' | 'llm' | 'confirm' | 'none';
  actions: DeviceAction[];
  usage: DeviceAccessUsage;
}

export async function registerDeviceAccess(requestBody: unknown, transport: 'HTTP' | 'MQTT' = 'HTTP') {
  const receivedAt = performance.now();
  const body = DeviceRegisterRequestSchema.parse(requestBody);
  const provisionedModel = await getProvisionedDeviceModel(body.deviceId);
  if (provisionedModel && provisionedModel !== body.model) {
    throw new ApiError(409, 'DEVICE_MODEL_MISMATCH', '设备上报型号与预置型号不一致');
  }
  const now = new Date().toISOString();
  let registrationEventNeeded = false;
  await updateDeviceProfiles((devices) => {
  const existing = devices.find((device) => device.id === body.deviceId);
  if (existing && existing.model !== body.model) {
    throw new ApiError(409, 'DEVICE_MODEL_MISMATCH', '设备型号已登记，不能通过注册报文修改');
  }
  registrationEventNeeded = !existing || existing.status !== 'ONLINE';
  const nextDevice: DeviceProfile = {
    id: body.deviceId,
    name: existing?.name ?? `东信浴霸 ${body.deviceId}`,
    model: body.model,
    firmwareVersion: body.firmwareVersion ?? existing?.firmwareVersion ?? null,
    capabilities: body.capabilities,
    protocol: transport,
    status: 'ONLINE',
    notes: existing?.notes ?? `protocol=${body.protocolVersion}; capabilities=${Object.entries(body.capabilities)
      .filter(([, enabled]) => enabled)
      .map(([capability]) => capability)
      .join(',')}`,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  return upsertDevice(devices, nextDevice);
  });
  patchCurrentDeviceState({ isOnline: true }, body.deviceId);
  if (registrationEventNeeded) await recordDeviceEvent({
    deviceId: body.deviceId,
    type: 'STATE_REPORT',
    payload: {
      event: 'REGISTER',
      model: body.model,
      firmwareVersion: body.firmwareVersion ?? null,
      protocolVersion: body.protocolVersion,
      capabilities: body.capabilities,
      isOnline: true
    }
  });

  if (transport === 'HTTP') devicePresence.observeHttp(body.deviceId, 'ONLINE', receivedAt);

  return {
    deviceId: body.deviceId,
    pollIntervalSeconds: 3,
    heartbeatIntervalSeconds: 900,
    protocolVersion: body.protocolVersion
  };
}

export async function handleDeviceHeartbeat(requestBody: unknown, transport: 'HTTP' | 'MQTT' = 'HTTP') {
  const receivedAt = performance.now();
  const body = DeviceHeartbeatRequestSchema.parse(requestBody);
  await ensureDevice(body.deviceId);
  await patchDeviceProfile(body.deviceId, {
    firmwareVersion: body.firmwareVersion ?? undefined,
    status: 'ONLINE'
  });
  if (transport === 'HTTP') devicePresence.observeHttp(body.deviceId, 'ONLINE', receivedAt);

  return {
    isRegistered: true,
    hasPendingCommands: await hasPendingPollCommands(body.deviceId)
  };
}

export async function getDeviceAccessConfig(deviceId: string) {
  await ensureDevice(deviceId);
  return {
    pollIntervalSeconds: 3,
    heartbeatIntervalSeconds: 900,
    voiceTimeoutMs: 3000,
    mcuAckTimeoutMs: 2000,
    activeProtocolVersion: '0.1'
  };
}

export async function handleDeviceStateReport(requestBody: unknown, transport: 'HTTP' | 'MQTT' = 'HTTP') {
  const receivedAt = performance.now();
  const body = DeviceStateReportRequestSchema.parse(requestBody);
  await ensureDevice(body.deviceId);
  if (typeof body.state.isOnline === 'boolean') {
    await patchDeviceProfile(body.deviceId, {
      status: body.state.isOnline ? 'ONLINE' : 'OFFLINE'
    });
  }
  const previous = getCachedDeviceState(body.deviceId);
  const current = patchDeviceCloudState(body.state, body.deviceId);
  if (deviceStateChanged(previous, current)) {
    await recordDeviceEvent({
      deviceId: body.deviceId,
      type: 'STATE_REPORT',
      payload: {
        reportedAt: body.reportedAt ?? new Date().toISOString(),
        ...body.state
      }
    });
  }

  if (transport === 'HTTP') devicePresence.observeHttp(body.deviceId, body.state.isOnline === false ? 'OFFLINE' : 'ONLINE', receivedAt);

  return {
    accepted: true,
    hasPendingCommands: await hasPendingPollCommands(body.deviceId)
  };
}

export async function handleDeviceAccessEvent(requestBody: unknown) {
  const body = DeviceAccessEventRequestSchema.parse(requestBody);
  await ensureDevice(body.deviceId);
  if (body.eventType === 'LOCAL_CONTROL') {
    const payload = LocalControlEventPayloadSchema.parse(body.payload);
    const fingerprint = createHash('sha256').update(JSON.stringify({ payload, occurredAt: body.occurredAt })).digest('hex');
    return localEventReplay.run(JSON.stringify([body.deviceId, body.eventId]), fingerprint, async () => {
      // Even an already-off command is a fresh user decision. Invalidate older
      // online work without inferring a new state from an unverified intent.
      if (payload.state) patchDeviceCloudState(payload.state, body.deviceId, { bumpRevision: false });
      const revision = bumpDeviceControlRevision(body.deviceId);
      await recordDeviceEvent({
        deviceId: body.deviceId,
        type: 'STATE_REPORT',
        payload: { ...payload, eventType: body.eventType, eventId: body.eventId, occurredAt: body.occurredAt ?? new Date().toISOString(), revision },
      });
      return { accepted: true, controlRevision: revision, proactive: { shouldSpeak: false, replyText: '', needConfirm: false, suggestedActions: [] as DeviceAction[] } };
    });
  }
  const proactive = await resolveProactiveResponse(body);
  await recordDeviceEvent({
    deviceId: body.deviceId,
    type: mapAccessEventType(body.eventType),
    payload: {
      eventId: body.eventId ?? null,
      eventType: body.eventType,
      occurredAt: body.occurredAt ?? new Date().toISOString(),
      ...body.payload
    }
  });

  return {
    accepted: true,
    proactive
  };
}

export async function handleDeviceAccessVoiceTurn(
  requestBody: unknown,
  options: { recordProductionHistory?: boolean } = {},
): Promise<DeviceVoiceTurnData> {
  const body = DeviceAccessVoiceTurnRequestSchema.parse(requestBody);
  await ensureDevice(body.deviceId);
  if (body.reportedState) {
    patchDeviceCloudState(body.reportedState, body.deviceId);
  }
  const revision = getDeviceControlRevision(body.deviceId);
  const normalizedBody = { ...body, sessionId: body.sessionId || randomUUID() };
  const started = performance.now();
  try {
    return await runVoiceWork(
      body.deviceId,
      () => executeDeviceAccessVoiceTurn(normalizedBody, revision, options.recordProductionHistory === true, started),
    );
  } catch (error) {
    if (options.recordProductionHistory) {
      await recordDeviceVoiceHistorySafely({
        sessionId: normalizedBody.sessionId,
        deviceId: normalizedBody.deviceId,
        inputSource: 'DEVICE_TEXT',
        inputText: normalizedBody.text,
        replyText: '',
        route: 'UNRESOLVED',
        result: 'FAILED',
        intent: null,
        safetyDecision: null,
        commandStatus: null,
        latencyMs: Math.round(performance.now() - started),
        costCny: null,
        error: safeDeviceVoiceHistoryError(error),
      });
    }
    throw error;
  }
}

async function executeDeviceAccessVoiceTurn(
  body: ReturnType<typeof DeviceAccessVoiceTurnRequestSchema.parse> & { sessionId: string },
  revision: number,
  recordProductionHistory: boolean,
  started: number,
): Promise<DeviceVoiceTurnData> {
  if (body.confirmToken) {
    const response = await confirmPendingVoiceCommand(body.deviceId, body.sessionId, body.confirmToken);
    if (recordProductionHistory) {
      await recordDeviceVoiceHistorySafely({
        sessionId: response.sessionId,
        deviceId: body.deviceId,
        inputSource: 'DEVICE_TEXT',
        inputText: body.text,
        replyText: response.replyText,
        route: 'ONLINE_RULE',
        result: 'COMPLETED',
        intent: null,
        safetyDecision: null,
        commandStatus: response.actions.length ? 'QUEUED' : null,
        latencyMs: Math.round(performance.now() - started),
        costCny: 0,
        error: null,
      });
    }
    return response;
  }

  const sessionId = body.sessionId;
  const currentState = await getDeviceState(body.deviceId);
  const model = (await getDevice(body.deviceId)).model;
  const knowledge = await getVoiceKnowledge(body.text, [], model);
  const lowCostResult = await resolveLowCostIntent(body.text, model);
  const resolved = lowCostResult
    ? {
        source: lowCostResult.source,
        aiResult: lowCostResult.aiResult,
        usage: emptyUsage(false),
        providerId: null
      }
    : await callConfiguredModel(body.text, currentState, knowledge.context);

  assertWorkActive();
  if (resolved.aiResult.resultType === 'DEVICE_CONTROL' && revision !== getDeviceControlRevision(body.deviceId)) {
    throw new ApiError(409, 'STALE_VOICE_COMMAND', '设备状态已变化，本次语音控制已取消，请重新操作');
  }
  const safetyResult = applySafetyRules(resolved.aiResult, await getDeviceState(body.deviceId));
  const confirmToken = safetyResult.decision === 'NEEDS_CONFIRMATION' ? `confirm_${randomUUID()}` : null;
  const commandIntents = safetyResult.decision === 'APPROVED' ? safetyResult.commands
    : safetyResult.decision === 'NEEDS_CONFIRMATION' && resolved.aiResult.intent ? [resolved.aiResult.intent] : [];
  const actions: DeviceAction[] = [];

  for (const intent of commandIntents) {
    assertWorkActive();
    const mappedAction = intentToDeviceAction(intent, resolved.aiResult.slots);
    if (!mappedAction) {
      continue;
    }

    const command = await queueDeviceCommand({
      deviceId: body.deviceId,
      intent,
      slots: {
        ...resolved.aiResult.slots,
        ...voiceCommandGuard(body.deviceId, revision),
        delivery: safetyResult.decision === 'NEEDS_CONFIRMATION' ? 'confirmation' : 'direct-response',
        confirmToken
      },
      status: safetyResult.decision === 'NEEDS_CONFIRMATION' ? 'NEEDS_CONFIRMATION' : 'QUEUED',
      safetyDecision: safetyResult.decision,
      speak: safetyResult.speak,
      completedAt: null
    });

    if (safetyResult.decision === 'APPROVED') actions.push({
      ...mappedAction,
      commandId: command.id
    });
  }

  await appendLog({
    type: 'VOICE',
    summary: `Device voice turn ${body.deviceId}`,
    payload: {
      billingSource: 'RUNTIME',
      requestType: mapRequestType(resolved.source),
      deviceId: body.deviceId,
      sessionId,
      text: body.text,
      asrConfidence: body.asrConfidence ?? null,
      source: resolved.source,
      providerId: resolved.providerId,
      aiResult: resolved.aiResult,
      safetyResult,
      actions,
      usage: resolved.usage
    }
  });

  if (actions.length) assertVoiceRevision(body.deviceId, revision);
  const response: DeviceVoiceTurnData = {
    sessionId,
    replyText: safetyResult.speak || resolved.aiResult.speak || '',
    needConfirm: safetyResult.decision === 'NEEDS_CONFIRMATION',
    confirmToken,
    source: resolved.source,
    actions,
    usage: resolved.usage
  };
  if (recordProductionHistory) {
    await recordDeviceVoiceHistorySafely({
      sessionId,
      deviceId: body.deviceId,
      inputSource: 'DEVICE_TEXT',
      inputText: body.text,
      replyText: response.replyText,
      route: deviceVoiceRoute(resolved.source),
      result: 'COMPLETED',
      intent: resolved.aiResult.intent ?? null,
      safetyDecision: safetyResult.decision,
      commandStatus: response.needConfirm ? 'NEEDS_CONFIRMATION' : actions.length ? 'QUEUED' : null,
      latencyMs: Math.round(performance.now() - started),
      costCny: resolved.usage.costCny,
      error: null,
    });
  }
  return response;
}

function deviceVoiceRoute(source: DeviceVoiceTurnData['source']): 'ONLINE_RULE' | 'KNOWLEDGE' | 'LLM' | 'UNRESOLVED' {
  if (source === 'knowledge') return 'KNOWLEDGE';
  if (source === 'llm') return 'LLM';
  if (source === 'none') return 'UNRESOLVED';
  return 'ONLINE_RULE';
}

async function recordDeviceVoiceHistorySafely(input: ProductionVoiceHistoryInput): Promise<void> {
  try {
    await appendProductionVoiceHistory(input);
  } catch (error) {
    console.error('[production-voice-history] failed to persist device turn', safeDeviceVoiceHistoryError(error));
  }
}

function safeDeviceVoiceHistoryError(error: unknown): string {
  if (error instanceof ApiError) return error.code.slice(0, 500);
  return error instanceof Error ? error.name.slice(0, 500) : 'INTERNAL_ERROR';
}

function mapRequestType(source: DeviceVoiceTurnData['source']): 'LLM' | 'RULE' | 'KNOWLEDGE' {
  if (source === 'llm') {
    return 'LLM';
  }
  if (source === 'knowledge') {
    return 'KNOWLEDGE';
  }
  return 'RULE';
}

export async function pollDeviceAccessCommands(deviceId: string, limit: number) {
  await ensureDevice(deviceId);
  const commands = await listDeviceCommands();
  return {
    commands: commands
      .filter((command) => command.deviceId === deviceId)
      .filter((command) => command.status === 'QUEUED')
      .filter((command) => command.slots.delivery !== 'direct-response')
      .filter((command) => isCommandCurrent(command))
      .slice(0, limit)
      .map(commandToPollingResponse)
      .filter((command): command is NonNullable<ReturnType<typeof commandToPollingResponse>> => Boolean(command))
  };
}

export async function handleDeviceCommandResult(requestBody: unknown) {
  const body = DeviceCommandResultRequestSchema.parse(requestBody);
  await ensureDevice(body.deviceId);
  const nextStatus = mapCommandResultStatus(body.status);
  const result = await finishDeviceCommand(body.deviceId, body.commandId, nextStatus, body.executedAt ?? new Date().toISOString());
  if (!result) {
    throw new ApiError(404, 'COMMAND_NOT_FOUND', `Unknown command for device: ${body.commandId}`);
  }

  if (result.outcome === 'DUPLICATE') {
    return { accepted: true, duplicate: true, command: result.command };
  }

  if (result.outcome === 'CONFLICT') {
    await recordDeviceEvent({
      deviceId: body.deviceId,
      type: 'COMMAND_RESULT',
      payload: {
        commandId: body.commandId,
        status: body.status,
        ignored: true,
        reason: `Command is not awaiting this result (status ${result.command.status})`
      }
    });
    return { accepted: false, ignored: true, command: result.command };
  }

  if (body.state) {
    patchDeviceCloudState(body.state, body.deviceId);
  }

  await recordDeviceEvent({
    deviceId: body.deviceId,
    type: 'COMMAND_RESULT',
    payload: {
      commandId: body.commandId,
      status: body.status,
      executedAt: body.executedAt ?? new Date().toISOString(),
      mcuFrame: body.mcuFrame ?? null,
      executionPath: body.executionPath ?? null,
      message: body.message ?? null,
      error: body.error ?? null,
      state: body.state ?? null
    }
  });

  return {
    accepted: true,
    command: result.command
  };
}

function upsertDevice(devices: DeviceProfile[], nextDevice: DeviceProfile): DeviceProfile[] {
  const index = devices.findIndex((device) => device.id === nextDevice.id);
  if (index < 0) {
    return [...devices, nextDevice];
  }
  const nextDevices = [...devices];
  nextDevices[index] = nextDevice;
  return nextDevices;
}

async function patchDeviceProfile(deviceId: string, patch: Partial<DeviceProfile>): Promise<void> {
  await updateDeviceProfiles((devices) => {
  const current = devices.find((device) => device.id === deviceId);
  if (!current) {
    throw new ApiError(404, 'DEVICE_NOT_FOUND', `Unknown device: ${deviceId}`);
  }
  return upsertDevice(devices, {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  });
  });
}

async function ensureDevice(deviceId: string): Promise<void> {
  await getDevice(deviceId);
}

async function hasPendingPollCommands(deviceId: string): Promise<boolean> {
  const commands = await listDeviceCommands();
  return commands.some(
    (command) =>
      command.deviceId === deviceId &&
      command.status === 'QUEUED' &&
      command.slots.delivery !== 'direct-response' &&
      isCommandCurrent(command)
  );
}

function patchDeviceCloudState(
  state: DeviceCloudState,
  deviceId: string,
  options?: { bumpRevision?: boolean },
): DeviceState {
  return patchCurrentDeviceState(cloudStateToDeviceStatePatch(state, getCachedDeviceState(deviceId)), deviceId, options);
}

function mapAccessEventType(eventType: DeviceAccessEventRequest['eventType']) {
  switch (eventType) {
    case 'CI_WAKE':
      return 'VOICE';
    case 'LOCAL_CONTROL':
      return 'STATE_REPORT';
    case 'FAULT':
      return 'FAULT';
    case 'COMMAND_RESULT':
      return 'COMMAND_RESULT';
    case 'OCCUPANCY_ENTER':
    case 'OCCUPANCY_LEAVE':
    case 'OCCUPANCY_STAY':
      return 'OCCUPANCY';
    case 'LOW_TEMPERATURE':
    case 'HIGH_HUMIDITY':
    case 'LONG_RUNNING':
    default:
      return 'RADAR';
  }
}

async function resolveProactiveResponse(body: DeviceAccessEventRequest) {
  if (
    body.eventType !== 'OCCUPANCY_ENTER' &&
    body.eventType !== 'OCCUPANCY_LEAVE' &&
    body.eventType !== 'LOW_TEMPERATURE' &&
    body.eventType !== 'HIGH_HUMIDITY' &&
    body.eventType !== 'LONG_RUNNING'
  ) {
    return {
      shouldSpeak: false,
      replyText: '',
      needConfirm: false,
      suggestedActions: [] as DeviceAction[]
    };
  }

  const decision = await handleProactiveEvent({
    deviceId: body.deviceId,
    eventType: body.eventType,
    ambientTemperature: readNumber(body.payload.ambientTemperature),
    humidity: readNumber(body.payload.humidity),
    hasOccupancy: typeof body.payload.hasOccupancy === 'boolean' ? body.payload.hasOccupancy : undefined,
    occurredAt: body.occurredAt
  }, true);

  return {
    shouldSpeak: decision.shouldSpeak,
    replyText: decision.speak,
    needConfirm: decision.requiresConfirm,
    suggestedActions: decision.suggestedIntent
      ? [intentToDeviceAction(decision.suggestedIntent, {})].filter((action): action is DeviceAction => Boolean(action))
      : []
  };
}

function matchRuleIntent(text: string): AiResult | null {
  const normalized = text.trim();
  if (matches(normalized, ['关灯', '关闭照明'])) {
    return control('LIGHT_OFF', '已关闭照明');
  }
  if (matches(normalized, ['开灯', '打开灯', '打开照明', '照明'])) {
    return control('LIGHT_ON', '已打开照明');
  }
  if (matches(normalized, ['关闭换气', '关换气', '关闭通风'])) {
    return control('VENTILATION_OFF', '已关闭换气');
  }
  if (matches(normalized, ['打开换气', '开换气', '通风', '空气不好', '有味道'])) {
    return control('VENTILATION_ON', '已打开换气');
  }
  if (matches(normalized, ['关闭吹风', '关吹风'])) {
    return control('FAN_OFF', '已关闭吹风');
  }
  if (matches(normalized, ['打开吹风', '开吹风', '凉风'])) {
    return control('FAN_ON', '已打开吹风');
  }
  if (matches(normalized, ['关闭摆风', '关摆风', '关闭扫风'])) {
    return control('SWING_OFF', '已关闭摆风');
  }
  if (matches(normalized, ['打开摆风', '开摆风', '扫风'])) {
    return control('SWING_ON', '已打开摆风');
  }
  if (matches(normalized, ['关闭暖风', '关暖风', '关闭取暖'])) {
    return control('HEAT_WEAK_OFF', '已关闭暖风');
  }
  if (matches(normalized, ['强暖', '大暖风'])) {
    return control('HEAT_STRONG_ON', '已准备打开强暖', true);
  }
  if (matches(normalized, ['弱暖', '小暖风', '取暖'])) {
    return control('HEAT_WEAK_ON', '已打开弱暖');
  }
  if (matches(normalized, ['关闭除湿', '关除湿'])) {
    return control('DRY_OFF', '已关闭除湿');
  }
  if (matches(normalized, ['打开除湿', '开除湿', '干燥'])) {
    return control('DRY_ON', '已打开除湿');
  }
  if (matches(normalized, ['全部关闭', '全部关', '关闭浴霸', '关机', '待机'])) {
    return control('STANDBY', '已关闭浴霸主要功能');
  }

  const temperatureMatch = normalized.match(/([3-4][0-9])\s*度/);
  if (temperatureMatch) {
    return {
      resultType: 'DEVICE_CONTROL',
      intent: 'SET_TEMP',
      confidence: 0.96,
      slots: {
        temperature: Number(temperatureMatch[1])
      },
      requiresConfirm: false,
      speak: `已将温度设置为 ${temperatureMatch[1]} 度`
    };
  }

  return null;
}

async function callConfiguredModel(inputText: string, deviceState: DeviceState, knowledgeContext?: string) {
  const [providers, prompts] = await Promise.all([listProviders(), listPrompts()]);
  const provider = selectConfiguredProvider(providers);
  if (!provider) {
    throw new ApiError(404, 'PROVIDER_NOT_FOUND', 'No model provider configured');
  }
  const prompt = findPrompt(prompts);
  const modelOutput = await callModel({
    provider: findProvider(providers, provider.id),
    prompt,
    inputText,
    deviceState,
    knowledgeContext,
  });

  await appendLog({
    type: 'AI',
    summary: `LLM call ${provider.id}`,
    payload: {
      billingSource: 'RUNTIME',
      requestType: 'LLM',
      providerId: provider.id,
      promptId: prompt.id,
      inputText,
      latencyMs: modelOutput.latencyMs,
      usage: modelOutput.usage,
      aiResult: modelOutput.aiResult
    }
  });

  return {
    source: 'llm' as const,
    aiResult: modelOutput.aiResult,
    providerId: provider.id,
    usage: {
      usedLlm: true,
      providerId: provider.id,
      inputTokens: modelOutput.usage.inputTokens,
      outputTokens: modelOutput.usage.outputTokens,
      costCny: modelOutput.usage.costCny,
      isEstimated: modelOutput.usage.isEstimated,
      latencyMs: modelOutput.latencyMs
    }
  };
}

function selectConfiguredProvider(providers: ModelProvider[]): ModelProvider | undefined {
  const configuredProviders = providers.filter(
    (item) => item.enabled && item.type === 'OPENAI_COMPATIBLE' && item.apiKeyEnv && isEnvConfigured(item.apiKeyEnv)
  );

  return configuredProviders.sort((left, right) => estimateProviderCost(left) - estimateProviderCost(right))[0] ?? providers[0];
}

function estimateProviderCost(provider: ModelProvider) {
  const input = typeof provider.inputPricePerMTokens === 'number' ? provider.inputPricePerMTokens : Number.POSITIVE_INFINITY;
  const output = typeof provider.outputPricePerMTokens === 'number' ? provider.outputPricePerMTokens : Number.POSITIVE_INFINITY;
  return input + output;
}

async function confirmPendingVoiceCommand(
  deviceId: string,
  sessionId: string | undefined,
  confirmToken: string
): Promise<DeviceVoiceTurnData> {
  const commands = await listDeviceCommands();
  const pending = commands.find(
    (command) =>
      command.deviceId === deviceId &&
      command.status === 'NEEDS_CONFIRMATION' &&
      command.slots.confirmToken === confirmToken
  );

  if (!pending) {
    return {
      sessionId: sessionId || randomUUID(),
      replyText: '确认已过期，请重新说一遍。',
      needConfirm: false,
      confirmToken: null,
      source: 'confirm',
      actions: [],
      usage: emptyUsage(false)
    };
  }

  const revision = getDeviceControlRevision(deviceId);
  const currentState = await getDeviceState(deviceId);
  const safety = applySafetyRules({
    resultType: 'DEVICE_CONTROL', intent: pending.intent, confidence: 1,
    slots: pending.slots, requiresConfirm: false, speak: pending.speak ?? '',
  }, currentState);
  if (!isCommandRevisionCurrent(pending) || safety.decision !== 'APPROVED') {
    await patchDeviceCommand(pending.id, { status: 'REJECTED', completedAt: new Date().toISOString() });
    return {
      sessionId: sessionId || randomUUID(),
      replyText: safety.decision !== 'APPROVED' ? safety.speak : '设备状态已变化或确认已过期，请重新说一遍。',
      needConfirm: false, confirmToken: null, source: 'confirm', actions: [], usage: emptyUsage(false),
    };
  }
  const nextCommand = await patchDeviceCommand(pending.id, {
    status: 'QUEUED',
    safetyDecision: 'APPROVED',
    slots: {
      ...pending.slots,
      ...voiceCommandGuard(deviceId, revision),
      confirmToken: null,
      delivery: 'direct-response'
    }
  });
  assertVoiceRevision(deviceId, revision);
  const action = intentToDeviceAction(pending.intent, pending.slots);

  return {
    sessionId: sessionId || randomUUID(),
    replyText: pending.speak || '已确认执行。',
    needConfirm: false,
    confirmToken: null,
    source: 'confirm',
    actions: action && nextCommand ? [{ ...action, commandId: nextCommand.id }] : [],
    usage: emptyUsage(false)
  };
}

export function commandToPollingResponse(command: DeviceCommandRecord) {
  const action = intentToDeviceAction(command.intent, command.slots);
  if (!action) {
    return null;
  }

  return {
    commandId: command.id,
    ...(typeof command.slots.expectedControlRevision === 'number'
      ? { expectedControlRevision: command.slots.expectedControlRevision } : {}),
    source: 'server',
    expireAt: new Date(commandExpiresAt(command)).toISOString(),
    expireAtUnixMs: commandExpiresAt(command),
    replyText: command.speak || '',
    actions: [
      {
        ...action,
        commandId: command.id
      }
    ]
  };
}

export function intentToDeviceAction(intent: DeviceIntent, slots: Record<string, unknown>): DeviceAction | null {
  switch (intent) {
    case 'LIGHT_ON':
    case 'NIGHT_LIGHT_ON':
      return { code: 'light', value: 'on' };
    case 'LIGHT_OFF':
    case 'NIGHT_LIGHT_OFF':
      return { code: 'light', value: 'off' };
    case 'HEAT_WEAK_ON':
      return withDuration({ code: 'heater', value: 'weak' }, slots);
    case 'HEAT_STRONG_ON':
      return withDuration({ code: 'heater', value: 'strong' }, slots);
    case 'HEAT_WEAK_OFF':
    case 'HEAT_STRONG_OFF':
    case 'CONSTANT_TEMP_OFF':
      return { code: 'heater', value: 'off' };
    case 'VENTILATION_ON':
      return withDuration({ code: 'ventilation', value: 'on' }, slots);
    case 'VENTILATION_OFF':
      return { code: 'ventilation', value: 'off' };
    case 'FAN_ON':
      return withDuration({ code: 'fan', value: 'on' }, slots);
    case 'FAN_OFF':
      return { code: 'fan', value: 'off' };
    case 'SWING_ON':
      return { code: 'swing', value: 'on' };
    case 'SWING_OFF':
      return { code: 'swing', value: 'off' };
    case 'DRY_ON':
    case 'DEFOG_ON':
      return withDuration({ code: 'dry', value: 'on' }, slots);
    case 'DRY_OFF':
    case 'DEFOG_OFF':
      return { code: 'dry', value: 'off' };
    case 'BATH_MODE_ON':
      return { code: 'bath', value: 'on' };
    case 'BATH_MODE_OFF':
      return { code: 'bath', value: 'off' };
    case 'CONSTANT_TEMP_ON':
      return { code: 'constantTemperature', value: 'on' };
    case 'CONSTANT_TEMP_OFF':
      return { code: 'constantTemperature', value: 'off' };
    case 'STANDBY':
      return { code: 'standby', value: 'on' };
    case 'SET_TEMP':
      return {
        code: 'temperature',
        value: 'set',
        targetTemperature: typeof slots.temperature === 'number' ? slots.temperature : null
      };
    case 'SET_TIMER':
      return {
        code: 'timer',
        value: 'set',
        durationMinutes: typeof slots.durationMinutes === 'number' ? slots.durationMinutes : null
      };
    default:
      return null;
  }
}

function withDuration(action: DeviceAction, slots: Record<string, unknown>): DeviceAction {
  return {
    ...action,
    durationMinutes: typeof slots.durationMinutes === 'number' ? slots.durationMinutes : undefined
  };
}

function mapCommandResultStatus(status: DeviceCommandResultRequest['status']): 'APPLIED' | 'REJECTED' | 'FAILED' {
  switch (status) {
    case 'success':
      return 'APPLIED';
    case 'rejected':
      return 'REJECTED';
    case 'failed':
    case 'timeout':
    default:
      return 'FAILED';
  }
}

function control(intent: DeviceIntent, speak: string, requiresConfirm = false): AiResult {
  return {
    resultType: 'DEVICE_CONTROL',
    intent,
    confidence: 0.98,
    slots: {},
    requiresConfirm,
    speak
  };
}

function emptyUsage(usedLlm: boolean): DeviceAccessUsage {
  return {
    usedLlm,
    providerId: null,
    inputTokens: 0,
    outputTokens: 0,
    costCny: 0,
    isEstimated: false,
    latencyMs: 0
  };
}

function matches(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
