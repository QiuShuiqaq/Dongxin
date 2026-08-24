import { randomUUID } from 'node:crypto';
import type { AiResult, DeviceCommandRecord, ModelTokenUsage, VoiceTurnResponse } from '@dongxin/shared';
import { VoiceTurnRequestSchema } from '@dongxin/shared';
import { callModel } from '../modelGateway.js';
import { applySafetyRules } from '../rules.js';
import { appendLog } from './log.service.js';
import { resolveLowCostIntent } from './lowCostIntent.service.js';
import {
  executeCommandForDevice,
  getDeviceState,
  queueDeviceCommand
} from './deviceRegistry.service.js';
import { findPrompt, listPrompts } from './prompt.service.js';
import { findProvider, listProviders } from './provider.service.js';

export async function handleVoiceTurn(requestBody: unknown): Promise<VoiceTurnResponse> {
  const body = VoiceTurnRequestSchema.parse(requestBody);
  const deviceState = await getDeviceState(body.deviceId);
  const lowCostResult = await resolveLowCostIntent(body.text);
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
      deviceState
    });
    source = 'llm';
    providerId = provider.id;
    promptId = prompt.id;
    aiResult = modelOutput.aiResult;
    latencyMs = modelOutput.latencyMs;
    usage = modelOutput.usage;
  }

  const safetyResult = applySafetyRules(aiResult, deviceState);
  let commandRecord: DeviceCommandRecord | null = null;
  let nextState = deviceState;

  if (body.applyToDevice && safetyResult.decision === 'APPROVED' && safetyResult.commands.length) {
    commandRecord = await queueDeviceCommand({
      deviceId: body.deviceId,
      intent: safetyResult.commands[0],
      slots: aiResult.slots,
      status: 'QUEUED',
      safetyDecision: safetyResult.decision,
      speak: safetyResult.speak,
      completedAt: null
    });
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
