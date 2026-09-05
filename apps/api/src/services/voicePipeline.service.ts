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
import { answerKnowledgeQuestion } from "./knowledge.service.js";
import { findPrompt, listPrompts } from "./prompt.service.js";
import { findProvider, listProviders } from "./provider.service.js";
import { getTestSet } from "./testSet.service.js";
import {
  executeCommandForDevice,
  getDeviceState,
  queueDeviceCommand,
} from "./deviceRegistry.service.js";
import { intentToDeviceAction } from "./deviceAccess.service.js";
import { synthesizeSpeech, transcribeAudio } from "./speech.service.js";

export async function runVoicePipeline(
  requestBody: unknown,
): Promise<VoicePipelineResponse> {
  const body = VoicePipelineRequestSchema.parse(requestBody);
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
      label: "离线模块",
      status: "SKIPPED",
      source: "DEVICE_LOCAL_MODULE",
      result: "设备端离线模块未命中，本次请求进入在线 ASR",
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

  const wakeResult = resolveWakeWord(transcript || "", body.inputSource);
  addStage(stages, {
    key: "WAKE_WORD",
    label: "唤醒词",
    status: wakeResult.detected ? "MATCHED" : "COMPLETED",
    source: wakeResult.source,
    result: wakeResult.detected ? "已识别“小东小东”" : "已进入测试会话",
    detail: {
      inputText: transcript,
      detected: wakeResult.detected,
      outputText: removeWakeWord(transcript || ""),
    },
    latencyMs: 0,
    costCny: 0,
    error: null,
  });

  const normalizedText = removeWakeWord(transcript || "");
  const offlineMatchedResult =
    body.simulateOffline === "MISS" || deviceOfflineHandled
      ? null
      : matchOfflineIntent(normalizedText);
  const offlineResult =
    body.simulateOffline === "HIT" && !deviceOfflineHandled
      ? (offlineMatchedResult ?? chat("离线模块模拟命中，已返回固定播报。"))
      : offlineMatchedResult;
  const deviceState = await getDeviceState(body.deviceId);

  if (offlineResult) {
    addStage(stages, {
      key: "OFFLINE_INTENT",
      label: "离线模块",
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
    addSkippedOnlineStages(stages, "离线模块已完成处理");
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
      label: "离线模块",
      status: "SKIPPED",
      source: "LOCAL_FIXED_INTENT",
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

  const knowledgeQuestion = looksLikeKnowledgeQuestion(normalizedText);
  if (knowledgeQuestion) {
    const knowledgeStarted = performance.now();
    const knowledge = await answerKnowledgeQuestion({
      question: normalizedText,
      limit: 2,
    });
    const knowledgeResult = chat(limitSpeak(knowledge.answer));
    addStage(stages, {
      key: "KNOWLEDGE",
      label: "企业知识库",
      status: "MATCHED",
      source: "RAG_KEYWORD_ROUTE",
      result: knowledgeResult.speak,
      detail: {
        question: normalizedText,
        answer: knowledgeResult.speak,
        hitCount: knowledge.hits.length,
        usedFallback: knowledge.usedFallback,
      },
      latencyMs: Math.round(performance.now() - knowledgeStarted),
      costCny: 0,
      error: null,
    });
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
      aiResult: knowledgeResult,
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
  const safetyResult = applySafetyRules(input.aiResult, input.deviceState);
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
  if (safetyResult.commands.length && input.body.applyToDevice) {
    const command = await queueDeviceCommand({
      deviceId: input.body.deviceId,
      intent: safetyResult.commands[0],
      slots: input.aiResult.slots,
      status: "QUEUED",
      safetyDecision: safetyResult.decision,
      speak: safetyResult.speak,
      completedAt: null,
    });
    if (
      input.body.inputSource === "DEVICE_AUDIO" ||
      input.body.inputSource === "DEVICE_TEXT"
    ) {
      commandRecord = command;
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

  const replyText =
    safetyResult.decision === "NO_ACTION" ||
    safetyResult.decision === "APPROVED"
      ? input.aiResult.speak
      : safetyResult.speak || input.aiResult.speak;
  let ttsAudioBase64: string | null = null;
  let ttsAudioMimeType: string | null = null;
  if (input.route === "OFFLINE") {
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
    });
    ttsAudioBase64 = tts.audioBase64;
    ttsAudioMimeType = tts.audioMimeType;
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
  };

  await appendLog({
    type: "VOICE",
    summary: `Voice pipeline test ${input.body.deviceId}`,
    payload: {
      billingSource: "PIPELINE_TEST",
      sessionId: input.sessionId,
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

function resolveWakeWord(
  text: string,
  inputSource: VoicePipelineRequest["inputSource"],
) {
  const detected = text.includes("小东小东");
  return {
    detected,
    source: detected
      ? "WAKE_NET_OR_ASR"
      : inputSource === "TEXT_SIMULATION" || inputSource === "DEVICE_TEXT"
        ? "TEST_SESSION"
        : "ASR_TEXT",
  };
}

function matchOfflineIntent(text: string): AiResult | null {
  const normalized = text.trim();
  if (!normalized) {
    return chat("您好，我是您的 AI 浴霸助手小东，有什么需要服务的？");
  }
  if (
    matches(normalized, ["谢谢", "感谢", "辛苦了", "再见", "拜拜", "晚安"]) &&
    !looksLikeProblem(normalized)
  ) {
    return chat("好的，再见。");
  }
  if (matches(normalized, ["你是谁", "你能做什么", "有什么功能"])) {
    return chat("我是 AI 浴霸助手小东，可以帮您控制浴霸并回答产品问题。");
  }
  if (looksLikeProblem(normalized)) {
    return null;
  }
  return matchDirectDeviceCommand(normalized);
}

function matchOnlineRule(text: string): AiResult | null {
  const normalized = text.trim();
  if (matches(normalized, ["谢谢", "感谢", "再见", "拜拜", "晚安"])) {
    return chat("好的，再见。");
  }
  if (matches(normalized, ["你好", "您好", "早上好", "晚上好", "在吗"])) {
    return chat("您好，我是 AI 浴霸助手小东，有什么可以帮您？");
  }
  if (looksLikeProblem(normalized)) {
    return null;
  }
  return matchDirectDeviceCommand(normalized);
}

function matchDirectDeviceCommand(text: string): AiResult | null {
  const commands: Array<{
    intent: DeviceIntent;
    words: string[];
    speak: string;
    requiresConfirm?: boolean;
  }> = [
    { intent: "LIGHT_OFF", words: ["关灯", "关闭照明"], speak: "已关闭照明。" },
    { intent: "LIGHT_ON", words: ["开灯", "打开照明"], speak: "已打开照明。" },
    {
      intent: "VENTILATION_OFF",
      words: ["关闭换气", "关掉换气", "关闭通风"],
      speak: "已关闭换气。",
    },
    {
      intent: "VENTILATION_ON",
      words: ["开启换气", "打开换气", "开始换气", "通风"],
      speak: "已打开换气。",
    },
    {
      intent: "FAN_OFF",
      words: ["关闭吹风", "关掉吹风"],
      speak: "已关闭吹风。",
    },
    {
      intent: "FAN_ON",
      words: ["打开吹风", "开启吹风", "凉风"],
      speak: "已打开吹风。",
    },
    {
      intent: "SWING_OFF",
      words: ["关闭摆风", "关掉摆风"],
      speak: "已关闭摆风。",
    },
    {
      intent: "SWING_ON",
      words: ["打开摆风", "开启摆风", "扫风"],
      speak: "已打开摆风。",
    },
    {
      intent: "HEAT_WEAK_OFF",
      words: ["关闭弱暖", "关闭取暖", "关闭暖风"],
      speak: "已关闭暖风。",
    },
    {
      intent: "HEAT_WEAK_ON",
      words: ["打开弱暖", "开启弱暖", "开启取暖", "打开暖风", "有点冷"],
      speak: "已打开弱暖。",
    },
    {
      intent: "HEAT_STRONG_ON",
      words: ["打开强暖", "开启强暖", "强暖"],
      speak: "即将打开强暖。",
      requiresConfirm: true,
    },
    {
      intent: "DRY_OFF",
      words: ["关闭干燥", "关闭除湿"],
      speak: "已关闭干燥。",
    },
    {
      intent: "DRY_ON",
      words: ["打开干燥", "开启干燥", "除湿"],
      speak: "已打开干燥。",
    },
    {
      intent: "DEFOG_ON",
      words: ["打开除雾", "开启除雾"],
      speak: "已打开除雾。",
    },
    {
      intent: "STANDBY",
      words: ["全部关闭", "关闭浴霸", "浴霸关机", "待机"],
      speak: "已进入待机。",
    },
  ];

  if (looksLikeProblem(text)) {
    return null;
  }

  const match = commands.find((command) =>
    command.words.some((word) => text.includes(word)),
  );
  if (match) {
    return control(match.intent, match.speak, match.requiresConfirm ?? false);
  }

  const temperatureMatch = text.match(/([3-4][0-9])\s*度/);
  if (temperatureMatch && matches(text, ["设置", "调到", "调整", "温度"])) {
    const temperature = Number(temperatureMatch[1]);
    return {
      resultType: "DEVICE_CONTROL",
      intent: "SET_TEMP",
      confidence: 0.96,
      slots: { temperature },
      requiresConfirm: false,
      speak: `已将温度设置为 ${temperature} 度。`,
    };
  }

  return null;
}

async function resolveByLlm(
  text: string,
  deviceState: DeviceState,
  providerId: string | undefined,
  promptId: string | undefined,
) {
  const [providers, prompts] = await Promise.all([
    listProviders(),
    listPrompts(),
  ]);
  const provider = providerId
    ? findProvider(providers, providerId)
    : providers.find(
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
  route: "UNRESOLVED";
  aiResult: AiResult;
  safetyResult: SafetyResult;
  deviceState: DeviceState;
  commandRecord: DeviceCommandRecord | null;
  totalLatencyMs: number;
  cost: ReturnType<typeof buildCost>;
  ttsAudioBase64: string | null;
  ttsAudioMimeType: string | null;
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

function looksLikeKnowledgeQuestion(text: string): boolean {
  return matches(text, [
    "怎么用",
    "如何使用",
    "说明书",
    "安装",
    "故障",
    "报错",
    "维修",
    "售后",
    "保修",
    "清洁",
    "保养",
    "型号",
    "不能工作",
    "不工作",
    "为什么",
  ]);
}

function looksLikeProblem(text: string): boolean {
  return matches(text, [
    "问题",
    "故障",
    "出问题",
    "坏了",
    "为什么",
    "怎么回事",
    "能不能",
    "是否",
    "好像",
    "不工作",
    "不能用",
    "失灵",
    "反馈",
    "咨询",
  ]);
}

function matches(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

function removeWakeWord(text: string): string {
  return text
    .replace(/小东小东/g, "")
    .replace(/^[，。、“”\s]+|[，。、“”\s]+$/g, "")
    .trim();
}

function limitSpeak(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 50 ? `${normalized.slice(0, 48)}...` : normalized;
}

function isAudioSource(source: VoicePipelineRequest["inputSource"]): boolean {
  return source === "BROWSER_AUDIO" || source === "DEVICE_AUDIO";
}
