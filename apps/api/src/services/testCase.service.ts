import type { TestCase } from '@dongxin/shared';
import * as labDataRepository from '../repositories/labData.repository.js';

export async function listTestCases(): Promise<TestCase[]> {
  return labDataRepository.listTestCases();
}

