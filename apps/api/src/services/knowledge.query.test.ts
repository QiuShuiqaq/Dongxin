import assert from 'node:assert/strict';
import { after, beforeEach, mock, test } from 'node:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ModelProviderSchema, PromptVersionSchema } from '@dongxin/shared';
import type { ModelCallInput } from '../modelGateway.js';

await mkdir(resolve('.artifacts'), { recursive: true });
const testData = await mkdtemp(resolve('.artifacts', 'knowledge-query-'));
process.env.DONGXIN_DATA_DIR = testData;
after(async () => { await rm(testData, { recursive: true, force: true }); });
const provider = ModelProviderSchema.parse({ id: 'fixture', name: 'fixture', type: 'OPENAI_COMPATIBLE', enabled: true, model: 'fixture' });
const prompt = PromptVersionSchema.parse({ id: 'fixture', name: 'fixture', version: 1, status: 'ACTIVE', createdAt: '', systemPrompt: 'fixture' });
let fail = false;
let control = false;
let calls: ModelCallInput[] = [];
mock.module(new URL('../modelGateway.js', import.meta.url).href, { namedExports: { callModel: async (input: ModelCallInput) => {
  calls.push(input);
  if (fail) throw new Error('fixture outage');
  return { aiResult: { resultType: control ? 'CONTROL' : 'CHAT', speak: '测试回答，依据知识ID:dx-company-about' }, usage: {}, latencyMs: 1 };
} } });
mock.module(new URL('./provider.service.js', import.meta.url).href, { namedExports: { getDefaultProviderForService: async () => provider } });
mock.module(new URL('./prompt.service.js', import.meta.url).href, { namedExports: { listPrompts: async () => [prompt] } });
const service = await import('./knowledge.service.js');
beforeEach(() => { calls = []; fail = false; control = false; });

test('exact curated FAQ returns verified text without invoking the model', async () => {
  const response = await service.answerKnowledgeQuestion({ question: '介绍一下东信' });
  assert.equal(response.route, 'FAQ');
  assert.equal(calls.length, 0);
  assert.ok(response.hits.some((hit) => hit.sourceId === 'dx-company-new'));
});

test('RAG supplies bounded source context and a read-only instruction to the model', async () => {
  const response = await service.answerKnowledgeQuestion({ question: '东信的企业背景和产品是什么' });
  assert.equal(response.route, 'RAG');
  assert.equal(response.usedFallback, false);
  assert.equal(calls.length, 1);
  assert.ok(response.hits.length > 0);
  for (const hit of response.hits) {
    assert.ok(calls[0].knowledgeContext?.includes(`知识ID:${hit.documentId}`));
    assert.ok(calls[0].knowledgeContext?.includes(hit.sourceId!));
  }
  assert.ok((calls[0].knowledgeContext?.length ?? 0) <= 5000);
  assert.ok(calls[0].prompt.systemPrompt.includes('不生成控制动作'));
  assert.equal(calls[0].temperature, 0);
});

test('missing warranty evidence, provider errors and control output never become invented answers', async () => {
  assert.equal((await service.answerKnowledgeQuestion({ question: '东信产品免费保修多久' })).route, 'FALLBACK');
  assert.equal(calls.length, 0);
  fail = true;
  const failed = await service.answerKnowledgeQuestion({ question: '东信的企业背景和产品是什么' });
  assert.equal(failed.route, 'FALLBACK');
  assert.equal(failed.answer, service.UNKNOWN_KNOWLEDGE_ANSWER);
  assert.ok(failed.reason?.includes('调用失败'));
  fail = false; control = true;
  const unexpected = await service.answerKnowledgeQuestion({ question: '东信的企业背景和产品是什么' });
  assert.equal(unexpected.route, 'FALLBACK');
  assert.equal(unexpected.answer, service.UNKNOWN_KNOWLEDGE_ANSWER);
});
