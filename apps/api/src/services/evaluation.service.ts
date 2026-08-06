import { randomUUID } from 'node:crypto';
import type { EvaluationItem, EvaluationRun, ModelProvider, PromptVersion, TestCase } from '@dongxin/shared';
import { AiResultSchema } from '@dongxin/shared';
import { z } from 'zod';
import { callModel } from '../modelGateway.js';
import { applySafetyRules } from '../rules.js';
import * as labDataRepository from '../repositories/labData.repository.js';
import { getCurrentDeviceState } from './device.service.js';
import { findProvider, listProviders } from './provider.service.js';
import { findPrompt, listPrompts } from './prompt.service.js';
import { listTestCases } from './testCase.service.js';

export const EvaluationRequestSchema = z.object({
  providerIds: z.array(z.string()).optional(),
  testCaseIds: z.array(z.string()).optional(),
  promptId: z.string().optional()
});

export async function listRecentEvaluations(limit = 50): Promise<EvaluationRun[]> {
  const evaluations = await labDataRepository.listEvaluations();
  return evaluations.slice(-limit).reverse();
}

export async function runEvaluation(requestBody: unknown): Promise<EvaluationRun> {
  const body = EvaluationRequestSchema.parse(requestBody);
  const [providers, prompts, testCases, previousRuns] = await Promise.all([
    listProviders(),
    listPrompts(),
    listTestCases(),
    labDataRepository.listEvaluations()
  ]);
  const prompt = findPrompt(prompts, body.promptId);
  const selectedProviders = providers.filter((provider) =>
    body.providerIds?.length ? body.providerIds.includes(provider.id) : provider.enabled
  );
  const selectedTestCases = testCases.filter((testCase) =>
    body.testCaseIds?.length ? body.testCaseIds.includes(testCase.id) : true
  );

  const items: EvaluationItem[] = [];
  for (const testCase of selectedTestCases) {
    for (const provider of selectedProviders) {
      items.push(await runEvaluationItem(provider, prompt, testCase));
    }
  }

  const totalLatency = items.reduce((sum, item) => sum + item.latencyMs, 0);
  const run: EvaluationRun = {
    id: randomUUID(),
    promptId: prompt.id,
    providerIds: selectedProviders.map((provider) => provider.id),
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    summary: {
      total: items.length,
      passed: items.filter((item) => item.isMatch).length,
      failed: items.filter((item) => !item.isMatch).length,
      averageLatencyMs: items.length ? Math.round(totalLatency / items.length) : 0
    },
    items
  };

  await labDataRepository.saveEvaluations([...previousRuns, run].slice(-100));
  return run;
}

export { findProvider };

async function runEvaluationItem(
  provider: ModelProvider,
  prompt: PromptVersion,
  testCase: TestCase
): Promise<EvaluationItem> {
  try {
    const modelOutput = await callModel({
      provider,
      prompt,
      inputText: testCase.inputText,
      deviceState: getCurrentDeviceState()
    });
    const safetyResult = applySafetyRules(modelOutput.aiResult, getCurrentDeviceState());
    const isMatch =
      testCase.expectedIntent === modelOutput.aiResult.intent &&
      AiResultSchema.safeParse(modelOutput.aiResult).success;

    return {
      testCaseId: testCase.id,
      providerId: provider.id,
      inputText: testCase.inputText,
      expectedIntent: testCase.expectedIntent,
      aiResult: modelOutput.aiResult,
      safetyResult,
      isMatch,
      latencyMs: modelOutput.latencyMs,
      error: null
    };
  } catch (error) {
    return {
      testCaseId: testCase.id,
      providerId: provider.id,
      inputText: testCase.inputText,
      expectedIntent: testCase.expectedIntent,
      aiResult: null,
      safetyResult: null,
      isMatch: false,
      latencyMs: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

