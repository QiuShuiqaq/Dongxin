import type { PromptVersion } from '@dongxin/shared';
import { ApiError } from '../http/apiError.js';
import * as labDataRepository from '../repositories/labData.repository.js';

export async function listPrompts(): Promise<PromptVersion[]> {
  return labDataRepository.listPrompts();
}

export function findPrompt(prompts: PromptVersion[], promptId?: string): PromptVersion {
  const prompt = promptId
    ? prompts.find((item) => item.id === promptId)
    : prompts.find((item) => item.status === 'ACTIVE') || prompts[0];

  if (!prompt) {
    throw new ApiError(404, 'PROMPT_NOT_FOUND', 'No prompt version configured');
  }

  return prompt;
}
