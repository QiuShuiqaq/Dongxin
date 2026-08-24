import type { EvaluationRun, ModelProvider, PromptVersion, TestCase, TestSet } from '@dongxin/shared';
import {
  EvaluationRunSchema,
  ModelProviderSchema,
  PromptVersionSchema,
  TestCaseSchema,
  TestSetSchema
} from '@dongxin/shared';
import { z } from 'zod';
import { readJsonFile, writeJsonFile } from '../storage.js';

export async function listProviders(): Promise<ModelProvider[]> {
  const providers = await readJsonFile<ModelProvider[]>('model-providers.json', []);
  return z.array(ModelProviderSchema).parse(providers);
}

export async function saveProviders(providers: ModelProvider[]): Promise<ModelProvider[]> {
  const parsedProviders = z.array(ModelProviderSchema).parse(providers);
  await writeJsonFile('model-providers.json', parsedProviders);
  return parsedProviders;
}

export async function listPrompts(): Promise<PromptVersion[]> {
  const prompts = await readJsonFile<PromptVersion[]>('prompts.json', []);
  return z.array(PromptVersionSchema).parse(prompts);
}

export async function listTestCases(): Promise<TestCase[]> {
  const testCases = await readJsonFile<TestCase[]>('test-cases.json', []);
  return z.array(TestCaseSchema).parse(testCases);
}

export async function listTestSets(): Promise<TestSet[]> {
  const testSets = await readJsonFile<TestSet[]>('test-sets.json', []);
  return z.array(TestSetSchema).parse(testSets);
}

export async function saveTestSets(testSets: TestSet[]): Promise<void> {
  const parsed = z.array(TestSetSchema).parse(testSets);
  await writeJsonFile('test-sets.json', parsed);
}

export async function listEvaluations(): Promise<EvaluationRun[]> {
  const evaluations = await readJsonFile<EvaluationRun[]>('evaluations.json', []);
  return z.array(EvaluationRunSchema).parse(evaluations);
}

export async function saveEvaluations(evaluations: EvaluationRun[]): Promise<void> {
  await writeJsonFile('evaluations.json', evaluations);
}
