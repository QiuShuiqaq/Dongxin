import { randomUUID } from 'node:crypto';
import type { AiResult, DeviceCommandRecord, ModelTokenUsage, VoiceTurnResponse } from '@dongxin/shared';
import { VoiceTurnRequestSchema } from '@dongxin/shared';
import { callModel } from '../modelGateway.js';
import { applySafetyRules } from '../rules.js';
import { appendLog } from './log.service.js';
import { resolveLowCostIntent } from './lowCostIntent.service.js';
import { getVoiceKnowledge } from './knowledge.service.js';
import { getDeviceProfile } from '../repositories/system.repository.js';
import {
  executeCommandForDevice,
  getDeviceState,
  queueDeviceCommand
} from './deviceRegistry.service.js';
import { findPrompt, listPrompts } from './prompt.service.js';
import { findProvider, listProviders } from './provider.service.js';
import { runVoiceWork, assertWorkActive } from '../runtime/workload.js';
import { getDeviceControlRevision } from '../deviceSimulator.js';
import { ApiError } from '../http/apiError.js';
import { voiceCommandGuard } from '../runtime/commandGuard.js';

export async function handleVoiceTurn(requestBody: unknown): Promise<VoiceTurnResponse> {
  const body = VoiceTurnRequestSchema.parse(requestBody);
  const revision = getDeviceControlRevision(body.deviceId);
  return runVoiceWork(body.deviceId, () => executeVoiceTurn(body, revision));
}
async function executeVoiceTurn(body: ReturnType<typeof VoiceTurnRequestSchema.parse>, revision: number): Promise<VoiceTurnResponse> {
  const deviceState = await getDeviceState(body.deviceId);
  const model = (await getDeviceProfile(body.deviceId))?.model;
  const lowCostResult = await resolveLowCostIntent(body.text, model);
  let source: 'rule' | 'knowledge' | 'llm';
  let providerId: string | null = null;
  let promptId: string | null = null;
  let aiResult: AiResult;
  let latencyMs = 0;
  let usage: ModelTokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costCny: 0,
    isEstimated: false
  };

  if (lowCostResult) {
    source = lowCostResult.source;
    aiResult = lowCostResult.aiResult;
  } else {
    const [providers, prompts] = await Promise.all([listProviders(), listPrompts()]);
    const provider = findProvider(providers, body.providerId);
    const prompt = findPrompt(prompts, body.promptId);
    const modelOutput = await callModel({
      provider,
      prompt,
      inputText: body.text,
      deviceState,
      knowledgeContext: (await getVoiceKnowledge(body.text, [], model)).context,
    });
    source = 'llm';
    providerId = provider.id;
    promptId = prompt.id;
    aiResult = modelOutput.aiResult;
    latencyMs = modelOutput.latencyMs;
    usage = modelOutput.usage;
  }

  assertWorkActive();
  if (body.applyToDevice && aiResult.resultType === 'DEVICE_CONTROL' && revision !== getDeviceControlRevision(body.deviceId)) {
    throw new ApiError(409, 'STALE_VOICE_COMMAND', '设备状态已变化，本次语音控制已取消，请重新操作');
  }
  const safetyResult = applySafetyRules(aiResult, await getDeviceState(body.deviceId));
  let commandRecord: DeviceCommandRecord | null = null;
  let nextState = deviceState;

  if (body.applyToDevice && safetyResult.decision === 'APPROVED' && safetyResult.commands.length) {
    commandRecord = await queueDeviceCommand({
      deviceId: body.deviceId,
      intent: safetyResult.commands[0],
      slots: { ...aiResult.slots, ...voiceCommandGuard(body.deviceId, revision) },
      status: 'QUEUED',
      safetyDecision: safetyResult.decision,
      speak: safetyResult.speak,
      completedAt: null
    });
    assertWorkActive();
    const result = await executeCommandForDevice(body.deviceId, commandRecord);
    commandRecord = result.command;
    nextState = result.state;
  } else if (body.applyToDevice && safetyResult.decision === 'NEEDS_CONFIRMATION' && safetyResult.commands.length) {
    commandRecord = await queueDeviceCommand({
      deviceId: body.deviceId,
      intent: safetyResult.commands[0],
      slots: aiResult.slots,
      status: 'NEEDS_CONFIRMATION',
      safetyDecision: safetyResult.decision,
      speak: safetyResult.speak,
      completedAt: null
    });
  } else if (body.applyToDevice && safetyResult.decision === 'REJECTED' && safetyResult.commands.length) {
    commandRecord = await queueDeviceCommand({
      deviceId: body.deviceId,
      intent: safetyResult.commands[0],
      slots: aiResult.slots,
      status: 'REJECTED',
      safetyDecision: safetyResult.decision,
      speak: safetyResult.speak,
      completedAt: new Date().toISOString()
    });
  }

  const sessionId = body.sessionId || randomUUID();

  await appendLog({
    type: 'VOICE',
    summary: `Voice turn ${body.deviceId}`,
    payload: {
      billingSource: 'RUNTIME',
      requestType: source === 'llm' ? 'LLM' : source === 'knowledge' ? 'KNOWLEDGE' : 'RULE',
      source,
      sessionId,
      providerId,
      promptId,
      text: body.text,
      asrConfidence: body.asrConfidence ?? null,
      latencyMs,
      usage,
      aiResult,
      safetyResult,
      deviceState: nextState
    }
  });

  return {
    sessionId,
    replyText: safetyResult.speak || aiResult.speak || '',
    aiResult,
    safetyResult,
    deviceState: nextState,
    commandRecord
  };
}
