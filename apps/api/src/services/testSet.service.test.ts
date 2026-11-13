import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

const dataDir = await mkdtemp(join(process.cwd(), 'test-set-transaction-test-'));
const previousDataDir = process.env.DONGXIN_DATA_DIR;
process.env.DONGXIN_DATA_DIR = dataDir;
after(async () => {
  if (previousDataDir === undefined) delete process.env.DONGXIN_DATA_DIR;
  else process.env.DONGXIN_DATA_DIR = previousDataDir;
  await rm(dataDir, { recursive: true });
});

const {
  addTestCaseToSet, createTestSet, deleteTestCaseFromSet, getTestSet,
  listTestSetSummaries, updateTestCaseInSet, updateTestSet,
} = await import('./testSet.service.js');

test('parallel test-set creation preserves every set', async () => {
  const created = await Promise.all(Array.from({ length: 20 }, (_, index) =>
    createTestSet({ name: `parallel-${index}`, description: '', kind: 'CUSTOM' })));
  const summaries = await listTestSetSummaries();
  assert.equal(new Set(created.map((item) => item.id)).size, 20);
  assert.ok(created.every((item) => summaries.some((summary) => summary.id === item.id)));
});

test('parallel case mutations preserve all edits and unique generated IDs', async () => {
  const set = await createTestSet({ name: 'case-transaction', description: '', kind: 'CUSTOM' });
  await Promise.all(Array.from({ length: 30 }, (_, index) =>
    addTestCaseToSet(set.id, { category: '语音', inputText: `测试语句 ${index}` })));
  const afterAdd = await getTestSet(set.id);
  assert.equal(afterAdd.cases.length, 30);
  assert.equal(new Set(afterAdd.cases.map((item) => item.id)).size, 30);
  assert.equal(afterAdd.caseCount, 30);

  await Promise.all(afterAdd.cases.map((item, index) =>
    updateTestCaseInSet(set.id, item.id, { inputText: `修订语句 ${index}` })));
  const afterEdit = await getTestSet(set.id);
  assert.equal(new Set(afterEdit.cases.map((item) => item.inputText)).size, 30);
  assert.ok(afterEdit.cases.every((item) => item.inputText.startsWith('修订语句 ')));

  await Promise.all(afterEdit.cases.slice(0, 10).map((item) => deleteTestCaseFromSet(set.id, item.id)));
  assert.equal((await getTestSet(set.id)).cases.length, 20);
});

test('a rejected mutation cannot overwrite another set or poison the transaction queue', async () => {
  const left = await createTestSet({ name: 'left', description: '', kind: 'CUSTOM' });
  const right = await createTestSet({ name: 'right', description: '', kind: 'CUSTOM' });
  await Promise.all([
    updateTestSet(left.id, { description: 'updated-left' }),
    updateTestSet(right.id, { description: 'updated-right' }),
  ]);
  assert.equal((await getTestSet(left.id)).description, 'updated-left');
  assert.equal((await getTestSet(right.id)).description, 'updated-right');
  await assert.rejects(addTestCaseToSet(left.id, { id: 'one', category: '语音', inputText: '第一句' }).then(() =>
    addTestCaseToSet(left.id, { id: 'one', category: '语音', inputText: '重复' })),
  (error: unknown) => (error as { statusCode?: number }).statusCode === 409);
  await addTestCaseToSet(left.id, { id: 'two', category: '语音', inputText: '第二句' });
  assert.deepEqual((await getTestSet(left.id)).cases.map((item) => item.id), ['one', 'two']);
  assert.equal((await getTestSet(right.id)).cases.length, 0);
});
