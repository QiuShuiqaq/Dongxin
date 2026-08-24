import type { DeviceState, SafetyResult } from '@dongxin/shared';
import type { ModelCallOutput } from '../modelGateway.js';
import { z } from 'zod';
import { callModel } from '../modelGateway.js';
import { applySafetyRules } from '../rules.js';
import { getCurrentDeviceState, executeDeviceCommand } from './device.service.js';
import { appendLog } from './log.service.js';
import { listProviders, findProvider } from './provider.service.js';
import { listPrompts, findPrompt } from './prompt.service.js';

export const ChatTestRequestSchema = z.object({
  providerId: z.string().min(1),
  promptId: z.string().min(1).optional(),
  inputText: z.string().min(1),
  applyToDevice: z.boolean().default(false)
});

export interface ChatTestResponse extends ModelCallOutput {
  safetyResult: SafetyResult;
  deviceState: DeviceState;
}

export async function runChatTest(requestBody: unknown): Promise<ChatTestResponse> {
  const body = ChatTestRequestSchema.parse(requestBody);
  const [providers, prompts] = await Promise.all([listProviders(), listPrompts()]);
  const provider = findProvider(providers, body.providerId);
  const prompt = findPrompt(prompts, body.promptId);
  const modelOutput = await callModel({
    provider,
    prompt,
    inputText: body.inputText,
    deviceState: getCurrentDeviceState()
  });
  const safetyResult = applySafetyRules(modelOutput.aiResult, getCurrentDeviceState());
  let deviceState = getCurrentDeviceState();

  if (body.applyToDevice && safetyResult.decision === 'APPROVED') {
    for (const command of safetyResult.commands) {
      deviceState = executeDeviceCommand(command, modelOutput.aiResult.slots);
    }
  }

  await appendLog({
    type: 'AI',
    summary: `Chat test ${provider.id}`,
    payload: {
      billingSource: 'EVALUATION',
      requestType: 'LLM',
      providerId: provider.id,
      promptId: prompt.id,
      inputText: body.inputText,
      latencyMs: modelOutput.latencyMs,
      usage: modelOutput.usage,
      aiResult: modelOutput.aiResult,
      safetyResult
    }
  });

  return {
    ...modelOutput,
    safetyResult,
    deviceState
  };
}
