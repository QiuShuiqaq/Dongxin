import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type {
  EvaluationItem,
  EvaluationProviderSummary,
  EvaluationRun,
  EvaluationSummary,
  ModelProvider,
  PromptVersion,
  TestCase,
  TestSet
} from '@dongxin/shared';
import { AiResultSchema } from '@dongxin/shared';
import { z } from 'zod';
import { callModel } from '../modelGateway.js';
import { ApiError } from '../http/apiError.js';
import { applySafetyRules } from '../rules.js';
import * as labDataRepository from '../repositories/labData.repository.js';
import { getCurrentDeviceState } from './device.service.js';
import { listProviders } from './provider.service.js';
import { findPrompt, listPrompts } from './prompt.service.js';
import { getTestSet, STANDARD_TEST_SET_ID } from './testSet.service.js';

export const EvaluationRequestSchema = z.object({
  providerIds: z.array(z.string()).optional(),
  testSetId: z.string().optional(),
  testCaseIds: z.array(z.string()).optional(),
  promptId: z.string().optional()
});

export async function listRecentEvaluations(limit = 50): Promise<EvaluationRun[]> {
  const evaluations = await labDataRepository.listEvaluations();
  return evaluations.slice(-limit).reverse();
}

export async function runEvaluation(requestBody: unknown): Promise<EvaluationRun> {
  const body = EvaluationRequestSchema.parse(requestBody);
  const [providers, prompts, previousRuns] = await Promise.all([
    listProviders(),
    listPrompts(),
    labDataRepository.listEvaluations()
  ]);
  const prompt = findPrompt(prompts, body.promptId);
  const selectedProviders = providers.filter((provider) =>
    body.providerIds?.length ? body.providerIds.includes(provider.id) : provider.enabled
  );

  if (!selectedProviders.length) {
    throw new ApiError(422, 'NO_PROVIDER_SELECTED', 'No provider available for evaluation');
  }

  const testSet = await resolveTestSet(body);
  const selectedTestCases = resolveSelectedTestCases(testSet, body.testCaseIds);

  if (!selectedTestCases.length) {
    throw new ApiError(422, 'TEST_CASE_NOT_FOUND', 'No test cases selected for this evaluation');
  }

  const startedAt = new Date().toISOString();
  const items: EvaluationItem[] = [];
  for (const provider of selectedProviders) {
    for (const testCase of selectedTestCases) {
      items.push(await runEvaluationItem(provider, prompt, testCase));
    }
  }

  const run: EvaluationRun = {
    id: randomUUID(),
    source: 'EVALUATION',
    promptId: prompt.id,
    testSetId: testSet.id,
    testSetName: testSet.name,
    providerIds: selectedProviders.map((provider) => provider.id),
    startedAt,
    completedAt: new Date().toISOString(),
    summary: buildEvaluationSummary(items, selectedProviders),
    items
  };

  await labDataRepository.saveEvaluations([...previousRuns, run].slice(-100));
  return run;
}

async function resolveTestSet(body: z.infer<typeof EvaluationRequestSchema>): Promise<TestSet> {
  if (body.testSetId) {
    return getTestSet(body.testSetId);
  }

  return getTestSet(STANDARD_TEST_SET_ID);
}

function resolveSelectedTestCases(testSet: TestSet, testCaseIds?: string[]): TestCase[] {
  if (testCaseIds?.length) {
    return testSet.cases.filter((testCase) => testCaseIds.includes(testCase.id));
  }

  return testSet.cases;
}

async function runEvaluationItem(
  provider: ModelProvider,
  prompt: PromptVersion,
  testCase: TestCase
): Promise<EvaluationItem> {
  const started = performance.now();

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
      usage: modelOutput.usage,
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
      latencyMs: Math.round(performance.now() - started),
      usage: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function buildEvaluationSummary(items: EvaluationItem[], providers: ModelProvider[]): EvaluationSummary {
  const latencies = items.map((item) => item.latencyMs).sort((left, right) => left - right);
  const totals = items.reduce(
    (accumulator, item) => {
      const usage = item.usage;
      accumulator.inputTokens += usage?.inputTokens ?? 0;
      accumulator.outputTokens += usage?.outputTokens ?? 0;
      accumulator.totalTokens += usage?.totalTokens ?? 0;
      accumulator.costCny += getUsageCost(item.providerId, usage, providers);
      accumulator.estimatedCostCny += getUsageCost(item.providerId, usage, providers);
      accumulator.jsonValid += item.aiResult ? 1 : 0;
      accumulator.clarifyCount += item.aiResult?.resultType === 'NEED_CLARIFY' ? 1 : 0;
      accumulator.rejectCount += item.safetyResult?.decision === 'REJECTED' ? 1 : 0;
      return accumulator;
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costCny: 0,
      estimatedCostCny: 0,
      jsonValid: 0,
      clarifyCount: 0,
      rejectCount: 0
    }
  );

  return {
    total: items.length,
    passed: items.filter((item) => item.isMatch).length,
    failed: items.filter((item) => !item.isMatch).length,
    jsonValid: totals.jsonValid,
    clarifyCount: totals.clarifyCount,
    rejectCount: totals.rejectCount,
    averageLatencyMs: average(latencies),
    p95LatencyMs: percentile(latencies, 0.95),
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    totalTokens: totals.totalTokens,
    costCny: totals.costCny,
    estimatedCostCny: totals.estimatedCostCny,
    providerSummaries: buildProviderSummaries(items, providers)
  };
}

function buildProviderSummaries(items: EvaluationItem[], providers: ModelProvider[]): EvaluationProviderSummary[] {
  const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
  const grouped = new Map<
    string,
    {
      providerId: string;
      providerName: string;
      total: number;
      passed: number;
      failed: number;
      jsonValid: number;
      clarifyCount: number;
      rejectCount: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costCny: number;
      latencies: number[];
    }
  >();

  for (const item of items) {
    const provider = providerMap.get(item.providerId);
    const current =
      grouped.get(item.providerId) ??
      {
        providerId: item.providerId,
        providerName: provider?.name || item.providerId,
        total: 0,
        passed: 0,
        failed: 0,
        jsonValid: 0,
        clarifyCount: 0,
        rejectCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costCny: 0,
        latencies: []
      };

    current.total += 1;
    current.passed += item.isMatch ? 1 : 0;
    current.failed += item.isMatch ? 0 : 1;
    current.jsonValid += item.aiResult ? 1 : 0;
    current.clarifyCount += item.aiResult?.resultType === 'NEED_CLARIFY' ? 1 : 0;
    current.rejectCount += item.safetyResult?.decision === 'REJECTED' ? 1 : 0;
    current.inputTokens += item.usage?.inputTokens ?? 0;
    current.outputTokens += item.usage?.outputTokens ?? 0;
    current.totalTokens += item.usage?.totalTokens ?? 0;
    current.costCny += getUsageCost(item.providerId, item.usage, providers);
    current.latencies.push(item.latencyMs);
    grouped.set(item.providerId, current);
  }

  return Array.from(grouped.values())
    .map((item) => ({
      providerId: item.providerId,
      providerName: item.providerName,
      total: item.total,
      passed: item.passed,
      failed: item.failed,
      accuracy: item.total ? item.passed / item.total : 0,
      jsonValid: item.jsonValid,
      clarifyCount: item.clarifyCount,
      rejectCount: item.rejectCount,
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      totalTokens: item.totalTokens,
      costCny: item.costCny,
      averageLatencyMs: average(item.latencies),
      p95LatencyMs: percentile(item.latencies, 0.95)
    }))
    .sort((left, right) => left.providerName.localeCompare(right.providerName));
}

function getUsageCost(providerId: string, usage: EvaluationItem['usage'], providers: ModelProvider[]): number {
  if (!usage) {
    return 0;
  }

  if (typeof usage.costCny === 'number' && Number.isFinite(usage.costCny)) {
    return usage.costCny;
  }

  const provider = providers.find((item) => item.id === providerId);
  if (!provider) {
    return 0;
  }

  const inputPrice = provider.inputPricePerMTokens;
  const outputPrice = provider.outputPricePerMTokens;
  if (typeof inputPrice !== 'number' || typeof outputPrice !== 'number') {
    return 0;
  }

  return (usage.inputTokens * inputPrice + usage.outputTokens * outputPrice) / 1_000_000;
}

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}
