import { randomUUID } from 'node:crypto';
import type { DeviceCommandRecord, VoiceTurnResponse } from '@dongxin/shared';
import { VoiceTurnRequestSchema } from '@dongxin/shared';
import { callModel } from '../modelGateway.js';
import { applySafetyRules } from '../rules.js';
import { appendLog } from './log.service.js';
import {
  executeCommandForDevice,
  getDeviceState,
  queueDeviceCommand
} from './deviceRegistry.service.js';
import { findPrompt, listPrompts } from './prompt.service.js';
import { findProvider, listProviders } from './provider.service.js';

export async function handleVoiceTurn(requestBody: unknown): Promise<VoiceTurnResponse> {
  const body = VoiceTurnRequestSchema.parse(requestBody);
  const [providers, prompts] = await Promise.all([listProviders(), listPrompts()]);
  const provider = findProvider(providers, body.providerId);
  const prompt = findPrompt(prompts, body.promptId);
  const deviceState = await getDeviceState(body.deviceId);
  const modelOutput = await callModel({
    provider,
    prompt,
    inputText: body.text,
    deviceState
  });
  const safetyResult = applySafetyRules(modelOutput.aiResult, deviceState);
  let commandRecord: DeviceCommandRecord | null = null;
  let nextState = deviceState;

  if (body.applyToDevice && safetyResult.decision === 'APPROVED' && safetyResult.commands.length) {
    commandRecord = await queueDeviceCommand({
      deviceId: body.deviceId,
      intent: safetyResult.commands[0],
      slots: modelOutput.aiResult.slots,
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
      slots: modelOutput.aiResult.slots,
      status: 'NEEDS_CONFIRMATION',
      safetyDecision: safetyResult.decision,
      speak: safetyResult.speak,
      completedAt: null
    });
  } else if (body.applyToDevice && safetyResult.decision === 'REJECTED' && safetyResult.commands.length) {
    commandRecord = await queueDeviceCommand({
      deviceId: body.deviceId,
      intent: safetyResult.commands[0],
      slots: modelOutput.aiResult.slots,
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
      sessionId,
      providerId: body.providerId,
      promptId: body.promptId ?? prompt.id,
      text: body.text,
      asrConfidence: body.asrConfidence ?? null,
      deviceState: nextState
    }
  });

  return {
    sessionId,
    replyText: safetyResult.speak || modelOutput.aiResult.speak || '',
    aiResult: modelOutput.aiResult,
    safetyResult,
    deviceState: nextState,
    commandRecord
  };
}

