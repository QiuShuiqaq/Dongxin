import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KnowledgeDocument } from '@dongxin/shared';
import { selectVoiceKnowledge } from './knowledge.service.js';

const document: KnowledgeDocument = { id: 'test', title: '测试设备怎么清洁？', content: '以下是测试用答案，不是正式产品资料。', tags: ['清洁'], category: 'MAINTENANCE', status: 'PUBLISHED', createdAt: '', updatedAt: '' };

test('only an exact published FAQ returns a fast answer', () => {
  const exact = selectVoiceKnowledge([document], '测试设备怎么清洁');
  assert.equal(exact.fastAnswer, document.content);
  assert.equal(exact.hits[0].documentId, document.id);
  assert.equal(selectVoiceKnowledge([{ ...document, status: 'DRAFT' }], document.title).fastAnswer, null);
  const related = selectVoiceKnowledge([document], '清洁时要注意什么');
  assert.equal(related.fastAnswer, null);
  assert.ok(related.context.includes(document.content));
  assert.deepEqual(selectVoiceKnowledge([document], '给我讲个故事').hits, []);
});

test('long documents become model references and follow-ups retrieve previous topics only as context', () => {
  const long = selectVoiceKnowledge([{ ...document, content: '文'.repeat(601) }], document.title);
  assert.equal(long.fastAnswer, null);
  assert.equal(long.hits.length, 1);
  const followUp = selectVoiceKnowledge([document], '那接下来呢', [document.title]);
  assert.equal(followUp.fastAnswer, null);
  assert.ok(followUp.context.includes(document.content));
});

test('model knowledge requires its exact model; reference, review and archived content cannot answer', () => {
  const scoped: KnowledgeDocument = { ...document, scope: 'MODEL', modelIds: ['DX-TEST-A'] };
  assert.equal(selectVoiceKnowledge([scoped], document.title).fastAnswer, null);
  assert.equal(selectVoiceKnowledge([scoped], document.title, [], 'DX-TEST-B').fastAnswer, null);
  assert.equal(selectVoiceKnowledge([scoped], document.title, [], 'dx-test-a').fastAnswer, document.content);
  for (const status of ['DRAFT', 'IN_REVIEW', 'ARCHIVED'] as const) {
    assert.equal(selectVoiceKnowledge([{ ...document, status }], document.title).hits.length, 0);
  }
  assert.equal(selectVoiceKnowledge([{ ...document, scope: 'REFERENCE' }], document.title).hits.length, 0);
});

test('unknown warranty and model facts fall back while ordinary chat remains available', () => {
  assert.ok(selectVoiceKnowledge([], '东信浴霸的保修期是多少').blockedAnswer);
  assert.ok(selectVoiceKnowledge([], '东信浴霸的额定功率是多少').blockedAnswer);
  assert.equal(selectVoiceKnowledge([], '给我讲个故事').blockedAnswer, null);
  assert.ok(selectVoiceKnowledge([], '那这款呢', ['东信浴霸的额定功率是多少']).blockedAnswer);
  assert.ok(selectVoiceKnowledge([{ ...document, title: '东信主要生产哪些产品', tags: ['浴霸'] }], '浴霸额定功率是多少').blockedAnswer,
    'general product matches do not establish a model specification');
});

test('paragraph retrieval finds evidence beyond the beginning and retains its identity', () => {
  const deep = { ...document, sourceId: 'source-fixture', sourceLocation: '第 8 页', content: `${'无关介绍'.repeat(400)}\n\n测试专用水滴防护检查：不得使用水冲洗面板。` };
  const result = selectVoiceKnowledge([deep], '水滴防护检查');
  assert.equal(result.fastAnswer, null);
  assert.ok(result.context.includes('不得使用水冲洗面板'));
  assert.ok(result.context.includes('source-fixture 第 8 页'));
});
