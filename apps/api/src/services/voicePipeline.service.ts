import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type {
  AiResult,
  DeviceCommandRecord,
  DeviceIntent,
  DeviceState,
  SafetyResult,
  TestCase,
  VoicePipelineBatchRun,
  VoicePipelineRequest,
  VoicePipelineResponse,
  VoicePipelineStage,
} from "@dongxin/shared";
import {
  VoicePipelineBatchRequestSchema,
  VoicePipelineBatchRunSchema,
  VoicePipelineRequestSchema,
  VoicePipelineResponseSchema,
} from "@dongxin/shared";
import { isEnvConfigured } from "../envStore.js";
import { callModel } from "../modelGateway.js";
import { applySafetyRules } from "../rules.js";
import { getProductionCostSettings } from "../repositories/productionCost.repository.js";
import { appendLog } from "./log.service.js";
import { getVoiceKnowledge } from "./knowledge.service.js";
import { matchOnlineRule, matchDirectDeviceCommand, looksLikeProblem, normalizeRuleText } from './onlineRule.service.js';
export { matchOnlineRule } from './onlineRule.service.js';
import { getDeviceProfile } from '../repositories/system.repository.js';
import { isConversationEnd, voiceConversations } from "./conversation.service.js";
import type { ConversationMessage } from "./conversation.service.js";
import { findPrompt, listPrompts } from "./prompt.service.js";
import { findProvider, getDefaultProviderForService, listProviders } from "./provider.service.js";
import { getTestSet } from "./testSet.service.js";
import {
  executeCommandForDevice,
  getDeviceState,
  listCommandsForDevice,
  queueDeviceCommand,
} from "./deviceRegistry.service.js";
import { intentToDeviceAction } from "./deviceAccess.service.js";
import { publishQueuedDeviceCommand } from "./mqttGateway.service.js";
import { synthesizeSpeech, transcribeAudio } from "./speech.service.js";
import { createDeviceVoiceReplyAsset } from "./deviceAudioAsset.service.js";
import { runVoiceWork, assertWorkActive } from '../runtime/workload.js';
import { getDeviceControlRevision } from '../deviceSimulator.js';
import {
  appendProductionVoiceHistory,
  type ProductionVoiceHistoryInput,
} from '../repositories/productionVoiceHistory.repository.js';
import { ApiError } from '../http/apiError.js';
import { voiceCommandGuard, assertVoiceRevision } from '../runtime/commandGuard.js';
import { patchDeviceCommand } from '../repositories/system.repository.js';
import { takeProactiveConfirmation } from './proactiveConfirmation.service.js';

export async function runLlmModuleTest(input: {
  deviceId: string;
  text: string;
  providerId?: string;
  promptId?: string;
  conversationId?: string;
  llmTemperature?: number;
  llmMaxOutputTokens?: number;
  llmHistoryTurns?: number;
}) {
  return runVoiceWork(input.deviceId, () => voiceConversations.run({ deviceId: input.deviceId, channel: 'llm-test' }, input, async (context) => {
    const deviceState = await getDeviceState(input.deviceId);
    const result = await resolveByLlm(input.text.trim(), deviceState, input.providerId, input.promptId,
      input.llmHistoryTurns === undefined ? context.messages : input.llmHistoryTurns === 0 ? [] : context.messages.slice(-input.llmHistoryTurns * 2),
      undefined, input.llmTemperature, input.llmMaxOutputTokens);
    const value = {
      conversationId: context.id,
      inputText: input.text.trim(),
      providerId: result.providerId,
      aiResult: result.aiResult,
      safetyResult: applySafetyRules(result.aiResult, deviceState),
      latencyMs: result.latencyMs,
      usage: result.usage,
      error: result.error,
    };
    return { value, turn: result.error ? undefined : { text: input.text.trim(), aiResult: result.aiResult, replyText: result.aiResult.speak }, end: isConversationEnd(input.text) };
  }), { priority: 0 });
}

export async function runVoicePipeline(
  requestBody: unknown,
  options: { priority?: number; signal?: AbortSignal; recordProductionHistory?: boolean } = {},
): Promise<VoicePipelineResponse> {
  const body = VoicePipelineRequestSchema.parse(requestBody);
  initialRevisions.set(body, getDeviceControlRevision(body.deviceId));
  try {
    const response = await runVoiceWork(body.deviceId, () => runAdmittedPipeline(body), {
      priority: options.priority ?? (body.inputSource.startsWith('DEVICE') ? 1 : 0),
      signal: options.signal,
    });
    if (options.recordProductionHistory && body.inputSource.startsWith('DEVICE')) {
      await recordProductionVoiceHistorySafely(productionRecordFromPipeline(body, response));
    }
    return response;
  } catch (error) {
    if (options.recordProductionHistory && body.inputSource.startsWith('DEVICE')) {
      await recordProductionVoiceHistorySafely({
        sessionId: body.conversationId ?? randomUUID(),
        deviceId: body.deviceId,
        inputSource: body.inputSource as 'DEVICE_TEXT' | 'DEVICE_AUDIO',
        inputText: body.text?.trim() ?? '',
        replyText: '',
        route: 'UNRESOLVED',
        result: 'FAILED',
        intent: null,
        safetyDecision: null,
        commandStatus: null,
        latencyMs: null,
        costCny: null,
        error: safeVoiceHistoryError(error),
      });
    }
    throw error;
  }
}

const initialRevisions = new WeakMap<VoicePipelineRequest, number>();
async function runAdmittedPipeline(body: VoicePipelineRequest): Promise<VoicePipelineResponse> {
  if (body.testMode === 'ASR_ONLY') return executeVoicePipeline(body, []);
  return voiceConversations.run(
    { deviceId: body.deviceId, channel: 'pipeline' },
    { conversationId: body.conversationId, resumeLatest: body.inputSource.startsWith('DEVICE') },
    async (context) => {
      body.conversationId = context.id;
      const response = await executeVoicePipeline(body, context.messages);
      response.conversationId = context.id;
      const text = removeWakeWord(response.transcript ?? '') || (response.route === 'ONLINE_RULE' ? response.transcript ?? '' : '');
      const ciPromptEcho = body.inputSource === 'DEVICE_AUDIO' && body.ciWakeAcknowledged && text === '我在';
      const resolved = response.route !== 'UNRESOLVED' && !response.stages.some((stage) => stage.key === 'LLM' && stage.status === 'FAILED');
      return {
        value: response,
        turn: resolved && text && !ciPromptEcho ? {
          text,
          aiResult: response.aiResult,
          replyText: response.replyText,
          executionStatus: response.commandRecord?.status ?? 'NOT_EXECUTED',
        } : undefined,
        end: isConversationEnd(text),
      };
    },
  );
}

function productionRecordFromPipeline(
  body: VoicePipelineRequest,
  response: VoicePipelineResponse,
): ProductionVoiceHistoryInput {
  const failed = response.stages.find((stage) => stage.status === 'FAILED' || stage.status === 'NOT_CONFIGURED');
  return {
    sessionId: response.conversationId ?? response.sessionId,
    deviceId: body.deviceId,
    inputSource: body.inputSource as 'DEVICE_TEXT' | 'DEVICE_AUDIO',
    inputText: response.transcript ?? body.text?.trim() ?? '',
    replyText: response.replyText,
    route: response.route,
    result: failed ? 'FAILED' : 'COMPLETED',
    intent: response.aiResult.intent ?? null,
    safetyDecision: response.safetyResult.decision,
    commandStatus: response.commandRecord?.status ?? null,
    latencyMs: response.totalLatencyMs,
    costCny: response.cost.totalCny,
    error: failed?.error?.slice(0, 500) ?? (failed ? `${failed.key}_${failed.status}` : null),
  };
}

async function recordProductionVoiceHistorySafely(input: ProductionVoiceHistoryInput): Promise<void> {
  try {
    await appendProductionVoiceHistory(input);
  } catch (error) {
    console.error('[production-voice-history] failed to persist device turn', safeVoiceHistoryError(error));
  }
}

function safeVoiceHistoryError(error: unknown): string {
  if (error instanceof ApiError) return error.code.slice(0, 500);
  return error instanceof Error ? error.name.slice(0, 500) : 'INTERNAL_ERROR';
}

async function executeVoicePipeline(body: VoicePipelineRequest, history: ConversationMessage[]): Promise<VoicePipelineResponse> {
  const started = performance.now();
  const sessionId = randomUUID();
  const stages: VoicePipelineStage[] = [];
  let transcript: string | null = body.text?.trim() || null;
  let asrCost = 0;
  let llmCost = 0;
  let ttsCost = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let isEstimated = false;

  addStage(stages, {
    key: "INPUT",
    label: "用户输入",
    status: "COMPLETED",
    source: body.inputSource,
    result: transcript || "音频已接收",
    detail: {
      inputSource: body.inputSource,
      mimeType: body.mimeType,
      inputText: transcript,
      hasAudio: Boolean(body.audioBase64),
    },
    latencyMs: 0,
    costCny: 0,
    error: null,
  });

  const deviceOfflineHandled = body.inputSource === "DEVICE_AUDIO";
  if (deviceOfflineHandled) {
    addStage(stages, {
      key: "OFFLINE_INTENT",
      label: "CI1302离线识别",
      status: "SKIPPED",
      source: "CI1302",
      result: body.ciWakeAcknowledged ? "CI1302已唤醒；本次为在线回退音频" : "本次为在线音频请求",
      detail: {
        handledOnDevice: true,
        reason: "DEVICE_AUDIO is the online fallback upload",
      },
      latencyMs: 0,
      costCny: 0,
      error: null,
    });
  }

  if (isAudioSource(body.inputSource)) {
    const asr = body.audioBase64
      ? await transcribeAudio({
          audioBase64: body.audioBase64,
          mimeType: body.mimeType,
          providerId: body.asrProviderId,
        })
      : {
          status: "FAILED" as const,
          providerId: body.asrProviderId ?? null,
          providerName: null,
          text: null,
          audioBase64: null,
          audioMimeType: null,
          latencyMs: 0,
          costCny: 0,
          isEstimated: false,
          error: "audioBase64 is required for audio input",
        };
    transcript = asr.text;
    asrCost = asr.costCny;
    isEstimated ||= asr.isEstimated;
    addStage(stages, {
      key: "ASR",
      label: "在线 ASR",
      status: asr.status,
      source: asr.providerName || asr.providerId || "ASR",
      result:
        asr.text || (asr.status === "NOT_CONFIGURED" ? "未配置 ASR 服务" : ""),
      detail: {
        inputMimeType: body.mimeType,
        outputText: asr.text,
        providerId: asr.providerId,
      },
      latencyMs: asr.latencyMs,
      costCny: asr.costCny,
      error: asr.error,
    });

    if (!transcript) {
      return buildPipelineResponse({
        sessionId,
        body,
        transcript: null,
        stages,
        route: "UNRESOLVED",
        aiResult: chat("暂时无法识别这段语音，请检查 ASR 配置或重新说一遍。"),
        safetyResult: noActionSafety("未获得可用语音文本"),
        deviceState: await getDeviceState(body.deviceId),
        commandRecord: null,
        totalLatencyMs: Math.round(performance.now() - started),
        cost: buildCost(asrCost, 0, 0, inputTokens, outputTokens, isEstimated),
        ttsAudioBase64: null,
        ttsAudioMimeType: null,
        ttsAudioPath: null,
      });
    }
  } else {
    addStage(stages, {
      key: "ASR",
      label: "在线 ASR",
      status: "SKIPPED",
      source: "TEXT_SIMULATION",
      result: "文本模拟已提供识别结果",
      detail: {
        outputText: transcript,
      },
      latencyMs: 0,
      costCny: 0,
      error: null,
    });
  }

  if (body.testMode === "ASR_ONLY") {
    const safetyResult = noActionSafety("ASR 独立测试不执行语义分析和设备控制");
    return buildPipelineResponse({
      sessionId,
      body,
      transcript,
      stages,
      route: "UNRESOLVED",
      aiResult: chat(transcript || "未识别到语音文本"),
      safetyResult,
      deviceState: await getDeviceState(body.deviceId),
      commandRecord: null,
      totalLatencyMs: Math.round(performance.now() - started),
      cost: buildCost(asrCost, 0, 0, inputTokens, outputTokens, isEstimated),
      ttsAudioBase64: null,
      ttsAudioMimeType: null,
      ttsAudioPath: null,
    });
  }

  const wakeResult = resolveWakeWord(transcript || "", body.inputSource);
  if (body.ciWakeAcknowledged && body.inputSource === 'DEVICE_AUDIO') {
    wakeResult.detected = true;
    wakeResult.source = 'CI1302_WAKE_EVENT';
  }
  addStage(stages, {
    key: "WAKE_WORD",
    label: "唤醒词",
    status: wakeResult.detected ? "MATCHED" : "COMPLETED",
    source: wakeResult.source,
    result: body.ciWakeAcknowledged && body.inputSource === 'DEVICE_AUDIO'
      ? 'CI1302 已确认唤醒' : wakeResult.detected ? '已识别“小东小东”' : '已进入测试会话',
    detail: {
      inputText: transcript,
      detected: wakeResult.detected,
      outputText: removeWakeWord(transcript || ""),
    },
    latencyMs: 0,
    costCny: 0,
    error: null,
  });

  if (body.requireWakeWord && !wakeResult.detected && !history.length) {
    const safetyResult = noActionSafety('未检测到唤醒词“小东小东”');
    addStage(stages, {
      key: "SAFETY",
      label: "安全校验",
      status: "COMPLETED",
      source: "WAKE_WORD_GATE",
      result: safetyResult.decision,
      detail: safetyResult,
      latencyMs: 0,
      costCny: 0,
      error: null,
    });
    return buildPipelineResponse({
      sessionId,
      body,
      transcript,
      stages,
      route: "UNRESOLVED",
      aiResult: chat('未检测到唤醒词“小东小东”，本次语音不执行。'),
      safetyResult,
      deviceState: await getDeviceState(body.deviceId),
      commandRecord: null,
      totalLatencyMs: Math.round(performance.now() - started),
      cost: buildCost(asrCost, 0, 0, inputTokens, outputTokens, isEstimated),
      ttsAudioBase64: null,
      ttsAudioMimeType: null,
      ttsAudioPath: null,
    });
  }

  const normalizedText = removeWakeWord(transcript || "");
  if (body.inputSource === 'DEVICE_AUDIO' && body.ciWakeAcknowledged && normalizedText === '我在') {
    const wakeStage = stages.find((stage) => stage.key === 'WAKE_WORD');
    if (wakeStage) {
      wakeStage.status = 'SKIPPED';
      wakeStage.source = 'CI1302_PROMPT';
      wakeStage.result = '忽略 CI1302 自身播报，不生成第二次回答';
    }
    return finishPipeline({ sessionId, body, transcript, stages, route: 'ONLINE_RULE',
      aiResult: chat(''), deviceState: await getDeviceState(body.deviceId), started,
      cost: buildCost(asrCost, 0, 0, inputTokens, outputTokens, isEstimated) });
  }
  if (wakeResult.detected && !normalizedText) {
    if (body.ciWakeAcknowledged) {
      return finishPipeline({ sessionId, body, transcript, stages, route: 'ONLINE_RULE', aiResult: chat(''), deviceState: await getDeviceState(body.deviceId), started, cost: buildCost(asrCost, 0, 0, inputTokens, outputTokens, isEstimated) });
    }
    if (body.inputSource !== 'DEVICE_AUDIO') {
      return finishPipeline({ sessionId, body, transcript, stages, route: 'ONLINE_RULE', aiResult: chat('我在'), deviceState: await getDeviceState(body.deviceId), started, cost: buildCost(asrCost, 0, 0, inputTokens, outputTokens, isEstimated) });
    }
    const safetyResult = noActionSafety("仅识别到唤醒词，等待用户后续指令");
    addStage(stages, {
      key: "SAFETY",
      label: "安全校验",
      status: "COMPLETED",
      source: "WAKE_WORD_GATE",
      result: safetyResult.decision,
      detail: safetyResult,
      latencyMs: 0,
      costCny: 0,
      error: null,
    });
    addStage(stages, {
      key: "TTS",
      label: "TTS 播报",
      status: "SKIPPED",
      source: "LOCAL_FIXED_AUDIO",
      result: "开发板播放本地低音量唤醒回复",
      detail: { inputText: "我在", outputAudio: "LOCAL_WAKE_ACK" },
      latencyMs: 0,
      costCny: 0,
      error: null,
    });
    return buildPipelineResponse({
      sessionId,
      body,
      transcript,
      stages,
      route: "ONLINE_RULE",
      aiResult: chat("我在"),
      safetyResult,
      deviceState: await getDeviceState(body.deviceId),
      commandRecord: null,
      totalLatencyMs: Math.round(performance.now() - started),
      cost: buildCost(asrCost, 0, 0, inputTokens, outputTokens, isEstimated),
      ttsAudioBase64: null,
      ttsAudioMimeType: null,
      ttsAudioPath: null,
    });
  }
  const proactiveResponse = body.inputSource === 'DEVICE_AUDIO'
    ? takeProactiveConfirmation(body.deviceId, normalizedText) : null;
  const proactiveAnswer = proactiveResponse?.declined ? chat('好的，不开启。') :
    proactiveResponse?.intent ? control(proactiveResponse.intent, '好的，正在处理。') : null;
  if (proactiveAnswer) {
    return finishPipeline({
      sessionId, body, transcript, stages, route: 'ONLINE_RULE', aiResult: proactiveAnswer,
      deviceState: await getDeviceState(body.deviceId), started,
      cost: buildCost(asrCost, 0, 0, inputTokens, outputTokens, isEstimated),
    });
  }
  const offlineMatchedResult =
    body.simulateOffline === "MISS" || deviceOfflineHandled
      ? null
      : matchOfflineIntent(normalizedText);
  const offlineResult =
    body.simulateOffline === "HIT" && !deviceOfflineHandled
      ? (offlineMatchedResult ?? chat("CI1302模拟命中，已返回固定播报。"))
      : offlineMatchedResult;
  const deviceState = await getDeviceState(body.deviceId);

  if (offlineResult) {
    addStage(stages, {
      key: "OFFLINE_INTENT",
      label: "CI1302离线识别",
      status: "MATCHED",
      source: "LOCAL_FIXED_INTENT",
      result: offlineResult.speak,
      detail: {
        inputText: normalizedText,
        intent: offlineResult.intent,
        resultType: offlineResult.resultType,
        output: offlineResult,
        simulateOffline: body.simulateOffline,
        cloudCost: 0,
      },
      latencyMs: 0,
      costCny: 0,
      error: null,
    });
    addSkippedOnlineStages(stages, "测试模拟离线命中；量产固定命令由STM32本地执行");
    return finishPipeline({
      sessionId,
      body,
      transcript,
      stages,
      route: "OFFLINE",
      aiResult: offlineResult,
      deviceState,
      started,
      cost: buildCost(asrCost, 0, 0, inputTokens, outputTokens, isEstimated),
    });
  }

  if (!deviceOfflineHandled) {
    addStage(stages, {
      key: "OFFLINE_INTENT",
      label: "CI1302离线识别",
      status: "SKIPPED",
      source: "CI1302",
      result: "未命中固定指令或固定对话，进入在线链路",
      detail: {
        inputText: normalizedText,
        output: null,
      },
      latencyMs: 0,
      costCny: 0,
      error: null,
    });
  }

  const onlineRule = matchOnlineRule(normalizedText);
  addStage(stages, {
    key: "ONLINE_RULE",
    label: "在线规则",
    status: onlineRule ? "MATCHED" : "COMPLETED",
    source: onlineRule ? "SERVER_RULE" : "SERVER_RULE",
    result: onlineRule?.speak || "未命中简单规则",
    detail: {
      inputText: normalizedText,
      intent: onlineRule?.intent ?? null,
      resultType: onlineRule?.resultType ?? null,
      output: onlineRule,
    },
    latencyMs: 0,
    costCny: 0,
    error: null,
  });

  if (onlineRule) {
    addStage(stages, {
      key: "KNOWLEDGE",
      label: "企业知识库",
      status: "SKIPPED",
      source: "NOT_REQUIRED",
      result: "在线规则已完成处理",
      detail: {},
      latencyMs: 0,
      costCny: 0,
      error: null,
    });
    addStage(stages, {
      key: "LLM",
      label: "LLM 大模型",
      status: "SKIPPED",
      source: "COST_CONTROL",
      result: "简单问题不调用大模型",
      detail: {},
      latencyMs: 0,
      costCny: 0,
      error: null,
    });
    return finishPipeline({
      sessionId,
      body,
      transcript,
      stages,
      route: "ONLINE_RULE",
      aiResult: onlineRule,
      deviceState,
      started,
      cost: buildCost(asrCost, 0, 0, inputTokens, outputTokens, isEstimated),
    });
  }

  const knowledgeStarted = performance.now();
  const knowledgeModel = (await getDeviceProfile(body.deviceId))?.model;
  const knowledge = await getVoiceKnowledge(normalizedText, history.filter((message) => message.role === 'user').map((message) => message.content), knowledgeModel);
  addStage(stages, {
      key: "KNOWLEDGE",
      label: "企业知识库",
      status: knowledge.fastAnswer ? "MATCHED" : "COMPLETED",
      source: knowledge.fastAnswer ? "EXACT_FAQ" : knowledge.blockedAnswer ? "KNOWLEDGE_FALLBACK" : "KNOWLEDGE_REFERENCE",
      result: knowledge.fastAnswer || knowledge.blockedAnswer || (knowledge.hits.length ? '检索结果交给大模型结合问题回答' : '未命中知识资料，继续大模型对话'),
      detail: {
        question: normalizedText,
        answer: knowledge.fastAnswer ?? knowledge.blockedAnswer,
        hitCount: knowledge.hits.length,
        hits: knowledge.hits,
        model: knowledgeModel ?? null,
        usedFallback: !knowledge.hits.length,
      },
      latencyMs: Math.round(performance.now() - knowledgeStarted),
      costCny: 0,
      error: null,
  });
  if (knowledge.fastAnswer || knowledge.blockedAnswer) {
    addStage(stages, {
      key: "LLM",
      label: "LLM 大模型",
      status: "SKIPPED",
      source: "COST_CONTROL",
      result: "知识库已返回结果",
      detail: {},
      latencyMs: 0,
      costCny: 0,
      error: null,
    });
    return finishPipeline({
      sessionId,
      body,
      transcript,
      stages,
      route: "KNOWLEDGE",
      aiResult: chat((knowledge.fastAnswer ?? knowledge.blockedAnswer)!),
      deviceState,
      started,
      cost: buildCost(asrCost, 0, 0, inputTokens, outputTokens, isEstimated),
    });
  }

  const llmResult = await resolveByLlm(
    normalizedText,
    deviceState,
    body.providerId,
    body.promptId,
    body.llmHistoryTurns === undefined ? history : body.llmHistoryTurns === 0 ? [] : history.slice(-body.llmHistoryTurns * 2),
    knowledge.context,
    body.llmTemperature,
    body.llmMaxOutputTokens,
  );
  inputTokens = llmResult.usage.inputTokens;
  outputTokens = llmResult.usage.outputTokens;
  llmCost = llmResult.usage.costCny ?? 0;
  isEstimated ||= llmResult.usage.isEstimated;
  addStage(stages, {
    key: "LLM",
    label: "LLM 大模型",
    status: llmResult.error ? "FAILED" : "COMPLETED",
    source: llmResult.providerId,
    result: llmResult.aiResult.speak,
    detail: {
      inputText: normalizedText,
      output: llmResult.aiResult,
      inputTokens,
      outputTokens,
      totalTokens: llmResult.usage.totalTokens,
      contextMessages: history.length,
      knowledgeHitCount: knowledge.hits.length,
    },
    latencyMs: llmResult.latencyMs,
    costCny: llmCost,
    error: llmResult.error,
  });

  return finishPipeline({
    sessionId,
    body,
    transcript,
    stages,
    route: "LLM",
    aiResult: llmResult.aiResult,
    deviceState,
    started,
    cost: buildCost(
      asrCost,
      llmCost,
      0,
      inputTokens,
      outputTokens,
      isEstimated,
    ),
  });
}

export async function runVoicePipelineBatch(
  requestBody: unknown,
): Promise<VoicePipelineBatchRun> {
  const body = VoicePipelineBatchRequestSchema.parse(requestBody);
  const startedAt = new Date().toISOString();
  const testSet = await getTestSet(body.testSetId);
  const selectedIds = body.testCaseIds?.length
    ? new Set(body.testCaseIds)
    : null;
  const cases = selectedIds
    ? testSet.cases.filter((testCase) => selectedIds.has(testCase.id))
    : testSet.cases;

  const items = [];
  for (const testCase of cases) {
    const response = await runVoicePipeline({
      deviceId: body.deviceId,
      inputSource: "TEXT_SIMULATION",
      text: testCase.inputText,
      providerId: body.providerId,
      asrProviderId: body.asrProviderId,
      ttsProviderId: body.ttsProviderId,
      promptId: body.promptId,
      applyToDevice: body.applyToDevice,
      simulateOffline: body.simulateOffline,
    });
    const { isMatch, failureReason } = judgePipelineCase(testCase, response);

    items.push({
      id: `${testCase.id}:${response.sessionId}`,
      testCaseId: testCase.id,
      category: testCase.category,
      inputText: testCase.inputText,
      expectedIntent: testCase.expectedIntent,
      actualIntent: response.aiResult.intent,
      resultType: response.aiResult.resultType,
      route: response.route,
      isMatch,
      failureReason,
      response,
    });
  }

  const completedAt = new Date().toISOString();
  const run: VoicePipelineBatchRun = {
    id: randomUUID(),
    source: "PIPELINE_BATCH",
    testSetId: testSet.id,
    testSetName: testSet.name,
    providerId: body.providerId ?? null,
    asrProviderId: body.asrProviderId ?? null,
    ttsProviderId: body.ttsProviderId ?? null,
    promptId: body.promptId ?? null,
    startedAt,
    completedAt,
    summary: buildBatchSummary(items),
    items,
  };

  await appendLog({
    type: "AI",
    summary: `Pipeline batch ${testSet.name}`,
    payload: {
      billingSource: "PIPELINE_BATCH",
      runId: run.id,
      testSetId: run.testSetId,
      testSetName: run.testSetName,
      summary: run.summary,
    },
  });

  return VoicePipelineBatchRunSchema.parse(run);
}

async function finishPipeline(input: {
  sessionId: string;
  body: VoicePipelineRequest;
  transcript: string | null;
  stages: VoicePipelineStage[];
  route: "OFFLINE" | "ONLINE_RULE" | "KNOWLEDGE" | "LLM";
  aiResult: AiResult;
  deviceState: DeviceState;
  started: number;
  cost: ReturnType<typeof buildCost>;
}): Promise<VoicePipelineResponse> {
  assertWorkActive();
  // Re-check current state after ASR/LLM. A panel/offline operation supersedes
  // an older AI decision, even when the cloud request itself succeeded.
  if (input.body.applyToDevice && input.aiResult.resultType === 'DEVICE_CONTROL' &&
      initialRevisions.get(input.body) !== getDeviceControlRevision(input.body.deviceId)) {
    throw new ApiError(409, 'STALE_VOICE_COMMAND', '设备状态已变化，本次语音控制已取消，请重新操作');
  }
  const safetyResult = applySafetyRules(input.aiResult, await getDeviceState(input.body.deviceId));
  if (input.body.applyToDevice && safetyResult.commands.length) assertVoiceRevision(input.body.deviceId, initialRevisions.get(input.body)!);
  addStage(input.stages, {
    key: "SAFETY",
    label: "安全校验",
    status: "COMPLETED",
    source: "SERVER_SAFETY_RULES",
    result: safetyResult.decision,
    detail: {
      input: input.aiResult,
      commands: safetyResult.commands,
      output: safetyResult,
    },
    latencyMs: 0,
    costCny: 0,
    error: null,
  });

  let commandRecord: DeviceCommandRecord | null = null;
  let nextDeviceState = input.deviceState;
  if (safetyResult.commands.length && input.body.applyToDevice && safetyResult.decision === 'APPROVED') {
    assertWorkActive();
    const command = await queueDeviceCommand({
      deviceId: input.body.deviceId,
      intent: safetyResult.commands[0],
      slots: { ...input.aiResult.slots,
        ...(input.body.deviceControlRevision !== undefined ? { expectedControlRevision: input.body.deviceControlRevision } : {}),
        ...voiceCommandGuard(input.body.deviceId, initialRevisions.get(input.body)!) },
      status: "QUEUED",
      safetyDecision: safetyResult.decision,
      speak: safetyResult.speak,
      completedAt: null,
    });
    try { assertVoiceRevision(input.body.deviceId, initialRevisions.get(input.body)!); }
    catch (error) {
      await patchDeviceCommand(command.id, { status: 'FAILED', completedAt: new Date().toISOString() });
      throw error;
    }
    if (
      input.body.inputSource === "DEVICE_AUDIO" ||
      input.body.inputSource === "DEVICE_TEXT"
    ) {
      commandRecord = command;
      await publishQueuedDeviceCommand(command);
      commandRecord = await waitForDeviceCommandResult(
        input.body.deviceId,
        command.id,
        3500,
      );
      nextDeviceState = await getDeviceState(input.body.deviceId);
    } else {
      const executed = await executeCommandForDevice(
        input.body.deviceId,
        command,
      );
      commandRecord = executed.command;
      nextDeviceState = executed.state;
    }
    addStage(input.stages, {
      key: "DEVICE",
      label: "设备执行",
      status: "COMPLETED",
      source: input.body.inputSource.startsWith("DEVICE")
        ? "COMMAND_QUEUE"
        : "SIMULATOR",
      result: commandRecord.status,
      detail: {
        inputIntent: safetyResult.commands[0],
        slots: input.aiResult.slots,
        commandId: commandRecord.id,
        intent: commandRecord.intent,
        outputStatus: commandRecord.status,
      },
      latencyMs: 0,
      costCny: 0,
      error: null,
    });
  } else {
    addStage(input.stages, {
      key: "DEVICE",
      label: "设备执行",
      status: "SKIPPED",
      source: "TEST_PREVIEW",
      result: safetyResult.commands.length
        ? "未勾选执行设备命令"
        : "当前结果不包含设备命令",
      detail: {
        commands: safetyResult.commands,
        applyToDevice: input.body.applyToDevice,
      },
      latencyMs: 0,
      costCny: 0,
      error: null,
    });
  }

  let replyText =
    safetyResult.decision === "NO_ACTION" ||
    safetyResult.decision === "APPROVED"
      ? input.aiResult.speak
      : safetyResult.speak || input.aiResult.speak;
  if (commandRecord && input.body.inputSource.startsWith("DEVICE")) {
    if (commandRecord.status === "QUEUED") {
      replyText = "设备暂未确认执行结果，请稍后查看状态。";
    } else if (commandRecord.status !== "APPLIED") {
      replyText = "设备未能执行这条指令，请检查设备状态。";
    }
  }
  let ttsAudioBase64: string | null = null;
  let ttsAudioMimeType: string | null = null;
  let ttsAudioPath: string | null = null;
  if (!input.body.synthesizeSpeech) {
    addStage(input.stages, {
      key: "TTS",
      label: "TTS 播报",
      status: "SKIPPED",
      source: "REQUEST_DISABLED",
      result: "本次请求仅验证识别和控制结果，未生成播报音频",
      detail: {
        inputText: replyText,
        outputAudio: null,
      },
      latencyMs: 0,
      costCny: 0,
      error: null,
    });
  } else if (input.route === "OFFLINE") {
    addStage(input.stages, {
      key: "TTS",
      label: "TTS 播报",
      status: "SKIPPED",
      source: "LOCAL_FIXED_AUDIO",
      result: "离线固定回复不调用云端 TTS",
      detail: {
        inputText: replyText,
        outputAudio: null,
      },
      latencyMs: 0,
      costCny: 0,
      error: null,
    });
  } else if (replyText) {
    const tts = await synthesizeSpeech({
      text: replyText,
      providerId: input.body.ttsProviderId,
      voice: input.body.ttsVoice,
      audioFormat: input.body.inputSource === "DEVICE_AUDIO" ? "wav" : undefined,
    });
    ttsAudioMimeType = tts.audioMimeType;
    if (tts.audioBase64 && input.body.inputSource === "DEVICE_AUDIO") {
      const asset = createDeviceVoiceReplyAsset({
        deviceId: input.body.deviceId,
        wavBase64: tts.audioBase64,
      });
      ttsAudioPath = asset.path;
    } else {
      ttsAudioBase64 = tts.audioBase64;
    }
    input.cost.ttsCny += tts.costCny;
    input.cost.totalCny += tts.costCny;
    input.cost.isEstimated ||= tts.isEstimated;
    addStage(input.stages, {
      key: "TTS",
      label: "TTS 播报",
      status: tts.status,
      source: tts.providerName || tts.providerId || "TTS",
      result: tts.status === "COMPLETED" ? "已生成播报音频" : "未生成播报音频",
      detail: {
        inputText: replyText,
        outputAudioMimeType: tts.audioMimeType,
        providerId: tts.providerId,
      },
      latencyMs: tts.latencyMs,
      costCny: tts.costCny,
      error: tts.error,
    });
  }

  const response: VoicePipelineResponse = {
    sessionId: input.sessionId,
    conversationId: input.body.conversationId,
    inputSource: input.body.inputSource,
    transcript: input.transcript,
    replyText,
    route: input.route,
    stages: input.stages,
    aiResult: input.aiResult,
    safetyResult,
    deviceState: nextDeviceState,
    commandRecord,
    totalLatencyMs: Math.round(performance.now() - input.started),
    cost: input.cost,
    ttsAudioBase64,
    ttsAudioMimeType,
    ttsAudioPath,
  };

  await appendLog({
    type: "VOICE",
    summary: `Voice pipeline test ${input.body.deviceId}`,
    payload: {
      billingSource: "PIPELINE_TEST",
      sessionId: input.sessionId,
      conversationId: input.body.conversationId,
      inputSource: input.body.inputSource,
      transcript: input.transcript,
      route: input.route,
      stages: input.stages,
      cost: input.cost,
      aiResult: input.aiResult,
      safetyResult,
      commandRecord,
    },
  });

  return VoicePipelineResponseSchema.parse(response);
}

async function waitForDeviceCommandResult(
  deviceId: string,
  commandId: string,
  timeoutMs: number,
): Promise<DeviceCommandRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assertWorkActive();
    const command = (await listCommandsForDevice(deviceId)).find(
      (candidate) => candidate.id === commandId,
    );
    if (command && command.status !== "QUEUED") return command;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const command = (await listCommandsForDevice(deviceId)).find(
    (candidate) => candidate.id === commandId,
  );
  if (!command) {
    throw new Error(`Device command disappeared while waiting: ${commandId}`);
  }
  return command;
}

function resolveWakeWord(
  text: string,
  inputSource: VoicePipelineRequest["inputSource"],
) {
  const detected = normalizeWakeText(text).includes("小东小东");
  return {
    detected,
    source: detected
      ? "CI1302_OR_ASR"
      : inputSource === "TEXT_SIMULATION" || inputSource === "DEVICE_TEXT"
        ? "TEST_SESSION"
        : "ASR_TEXT",
  };
}

function matchOfflineIntent(text: string): AiResult | null {
  const normalized = normalizeRuleText(text);
  if (!normalized) {
    return chat("我在");
  }
  if (["谢谢", "感谢", "辛苦了"].includes(normalized)) return chat('不客气，我在。');
  if (isConversationEnd(normalized)) {
    return chat("好的，再见。");
  }
  if (["你是谁", "你能做什么", "有什么功能"].includes(normalized)) {
    return chat("我是 AI 浴霸助手小东，可以帮您控制浴霸并回答产品问题。");
  }
  if (looksLikeProblem(normalized)) {
    return null;
  }
  return matchDirectDeviceCommand(normalized);
}


async function resolveByLlm(
  text: string,
  deviceState: DeviceState,
  providerId: string | undefined,
  promptId: string | undefined,
  history: ConversationMessage[] = [],
  knowledgeContext?: string,
  temperature?: number,
  maxOutputTokens?: number,
) {
  const [providers, prompts, defaultProvider] = await Promise.all([
    listProviders(),
    listPrompts(),
    getDefaultProviderForService("LLM"),
  ]);
  const provider = providerId
    ? findProvider(providers, providerId)
    : defaultProvider || providers.find(
        (item) =>
          item.enabled &&
          item.type === "OPENAI_COMPATIBLE" &&
          item.apiKeyEnv &&
          isEnvConfigured(item.apiKeyEnv),
      ) ||
      providers.find((item) => item.enabled) ||
      providers[0];
  const prompt = findPrompt(prompts, promptId);
  if (!provider) {
    return {
      providerId: null,
      aiResult: chat("当前没有可用的大模型，请先配置模型供应商。"),
      latencyMs: 0,
      usage: emptyUsage(),
      error: "No model provider configured",
    };
  }

  try {
    const modelOutput = await callModel({
      provider,
      prompt,
      inputText: text,
      deviceState,
      history,
      knowledgeContext,
      temperature,
      maxOutputTokens,
    });
    return {
      providerId: provider.id,
      aiResult: modelOutput.aiResult,
      latencyMs: modelOutput.latencyMs,
      usage: modelOutput.usage,
      error: null,
    };
  } catch (error) {
    return {
      providerId: provider.id,
      aiResult: chat("当前大模型暂时不可用，请稍后再试。"),
      latencyMs: 0,
      usage: emptyUsage(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function addSkippedOnlineStages(
  stages: VoicePipelineStage[],
  reason: string,
): void {
  for (const stage of [
    ["ONLINE_RULE", "在线规则"],
    ["KNOWLEDGE", "企业知识库"],
    ["LLM", "LLM 大模型"],
  ] as const) {
    addStage(stages, {
      key: stage[0],
      label: stage[1],
      status: "SKIPPED",
      source: "OFFLINE_ROUTE",
      result: reason,
      detail: {},
      latencyMs: 0,
      costCny: 0,
      error: null,
    });
  }
}

function addStage(
  stages: VoicePipelineStage[],
  stage: VoicePipelineStage,
): void {
  stages.push(stage);
}

function buildPipelineResponse(input: {
  sessionId: string;
  body: VoicePipelineRequest;
  transcript: string | null;
  stages: VoicePipelineStage[];
  route: VoicePipelineResponse["route"];
  aiResult: AiResult;
  safetyResult: SafetyResult;
  deviceState: DeviceState;
  commandRecord: DeviceCommandRecord | null;
  totalLatencyMs: number;
  cost: ReturnType<typeof buildCost>;
  ttsAudioBase64: string | null;
  ttsAudioMimeType: string | null;
  ttsAudioPath: string | null;
}): VoicePipelineResponse {
  const response: VoicePipelineResponse = {
    sessionId: input.sessionId,
    inputSource: input.body.inputSource,
    transcript: input.transcript,
    replyText: input.aiResult.speak,
    route: input.route,
    stages: input.stages,
    aiResult: input.aiResult,
    safetyResult: input.safetyResult,
    deviceState: input.deviceState,
    commandRecord: input.commandRecord,
    totalLatencyMs: input.totalLatencyMs,
    cost: input.cost,
    ttsAudioBase64: input.ttsAudioBase64,
    ttsAudioMimeType: input.ttsAudioMimeType,
    ttsAudioPath: input.ttsAudioPath,
  };
  return VoicePipelineResponseSchema.parse(response);
}

function judgePipelineCase(
  testCase: TestCase,
  response: VoicePipelineResponse,
): { isMatch: boolean; failureReason: string | null } {
  const failedStage = response.stages.find(
    (stage) => stage.status === "FAILED",
  );
  if (failedStage) {
    return {
      isMatch: false,
      failureReason: `${failedStage.label}失败：${failedStage.error || failedStage.result}`,
    };
  }

  if (response.route === "UNRESOLVED") {
    return {
      isMatch: false,
      failureReason: "链路未完成",
    };
  }

  if (testCase.expectedIntent) {
    const isMatch = response.aiResult.intent === testCase.expectedIntent;
    return {
      isMatch,
      failureReason: isMatch
        ? null
        : `期望 ${testCase.expectedIntent}，实际 ${response.aiResult.intent || response.aiResult.resultType}`,
    };
  }

  const isNonControl =
    response.aiResult.resultType !== "DEVICE_CONTROL" &&
    response.safetyResult.commands.length === 0;
  return {
    isMatch: isNonControl,
    failureReason: isNonControl
      ? null
      : `不应触发设备控制，实际 ${response.aiResult.intent || response.aiResult.resultType}`,
  };
}

function buildBatchSummary(
  items: VoicePipelineBatchRun["items"],
): VoicePipelineBatchRun["summary"] {
  const total = items.length;
  const passed = items.filter((item) => item.isMatch).length;
  const failed = total - passed;
  const routeBreakdown: Record<string, number> = {};
  const failureBreakdown: Record<string, number> = {};
  const latencies = items
    .map((item) => item.response.totalLatencyMs)
    .sort((left, right) => left - right);

  let asrCostCny = 0;
  let llmCostCny = 0;
  let ttsCostCny = 0;
  let totalCostCny = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;

  for (const item of items) {
    routeBreakdown[item.route] = (routeBreakdown[item.route] || 0) + 1;
    if (!item.isMatch) {
      const reason = item.failureReason || "未通过";
      failureBreakdown[reason] = (failureBreakdown[reason] || 0) + 1;
    }
    asrCostCny += item.response.cost.asrCny;
    llmCostCny += item.response.cost.llmCny;
    ttsCostCny += item.response.cost.ttsCny;
    totalCostCny += item.response.cost.totalCny;
    inputTokens += item.response.cost.inputTokens;
    outputTokens += item.response.cost.outputTokens;
    totalTokens += item.response.cost.totalTokens;
  }

  return {
    total,
    passed,
    failed,
    passRate: total ? passed / total : 0,
    routeBreakdown,
    failureBreakdown,
    averageLatencyMs: total
      ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / total)
      : 0,
    p95LatencyMs: percentile(latencies, 0.95),
    asrCostCny,
    llmCostCny,
    ttsCostCny,
    totalCostCny,
    inputTokens,
    outputTokens,
    totalTokens,
    llmCallRate: total ? (routeBreakdown.LLM || 0) / total : 0,
    ruleHitRate: total ? (routeBreakdown.ONLINE_RULE || 0) / total : 0,
    offlineHitRate: total ? (routeBreakdown.OFFLINE || 0) / total : 0,
  };
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) {
    return 0;
  }
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil(values.length * ratio) - 1),
  );
  return values[index];
}

function buildCost(
  asrCny: number,
  llmCny: number,
  ttsCny: number,
  inputTokens: number,
  outputTokens: number,
  isEstimated: boolean,
) {
  return {
    asrCny,
    llmCny,
    ttsCny,
    totalCny: asrCny + llmCny + ttsCny,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    isEstimated,
  };
}

function emptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costCny: 0,
    isEstimated: false,
  };
}

function chat(speak: string): AiResult {
  return {
    resultType: "CHAT",
    intent: null,
    confidence: 0.98,
    slots: {},
    requiresConfirm: false,
    speak,
  };
}

function control(
  intent: DeviceIntent,
  speak: string,
  requiresConfirm = false,
): AiResult {
  return {
    resultType: "DEVICE_CONTROL",
    intent,
    confidence: 0.98,
    slots: {},
    requiresConfirm,
    speak,
  };
}

function noActionSafety(reason: string): SafetyResult {
  return {
    decision: "NO_ACTION",
    commands: [],
    reason,
    speak: "",
  };
}


function removeWakeWord(text: string): string {
  return normalizeWakeText(text)
    .replace(/小东小东/g, "")
    .replace(/^[，。、“”\s]+|[，。、“”\s]+$/g, "")
    .trim();
}

function normalizeWakeText(text: string): string {
  return text.replace(/[，,。.!！?？、\s]+/g, "");
}

function isAudioSource(source: VoicePipelineRequest["inputSource"]): boolean {
  return source === "BROWSER_AUDIO" || source === "DEVICE_AUDIO";
}
