import type { EvaluationRun, ModelProvider, PromptVersion, TestCase } from '@dongxin/shared';
import {
  ModelProviderSchema,
  PromptVersionSchema,
  TestCaseSchema
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

export async function listEvaluations(): Promise<EvaluationRun[]> {
  return readJsonFile<EvaluationRun[]>('evaluations.json', []);
}

export async function saveEvaluations(evaluations: EvaluationRun[]): Promise<void> {
  await writeJsonFile('evaluations.json', evaluations);
}

