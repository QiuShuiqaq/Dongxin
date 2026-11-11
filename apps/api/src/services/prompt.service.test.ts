import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { PromptVersionSchema } from '@dongxin/shared';

let stored = [] as Array<ReturnType<typeof PromptVersionSchema.parse>>;
mock.module(new URL('../repositories/labData.repository.js', import.meta.url).href, {
  namedExports: { listPrompts: async () => stored },
});
const { findPrompt, listPrompts } = await import('./prompt.service.js');

test('a fresh deployment has one active, safe built-in prompt without writing storage', async () => {
  stored = [];
  const prompts = await listPrompts();
  assert.equal(prompts.length, 1);
  const prompt = PromptVersionSchema.parse(findPrompt(prompts));
  assert.equal(prompt.status, 'ACTIVE');
  assert.match(prompt.systemPrompt, /明确要求控制浴霸/);
  assert.match(prompt.systemPrompt, /不得编造/);
  assert.equal(stored.length, 0);
});

test('existing configured prompts take precedence and unknown explicit versions still fail', async () => {
  stored = [PromptVersionSchema.parse({
    id: 'custom', name: 'Production prompt', version: 2, status: 'ACTIVE',
    createdAt: '2026-11-11T00:00:00.000Z', systemPrompt: 'Keep existing policy',
  })];
  const prompts = await listPrompts();
  assert.deepEqual(prompts, stored);
  assert.equal(findPrompt(prompts).id, 'custom');
  assert.throws(() => findPrompt(prompts, 'bath-heater-default-v1'), { code: 'PROMPT_NOT_FOUND' });
});
