import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pbkdf2Sync } from 'node:crypto';
import Fastify from 'fastify';
import { zipSync, strToU8 } from 'fflate';

// Every write targets a unique, ignored directory on D:. No live credentials,
// LLM calls, MQTT, serial connections, audio or device controls are used.
await mkdir(resolve('.artifacts'), { recursive: true });
const testData = await mkdtemp(resolve('.artifacts', 'knowledge-regression-'));
process.env.DONGXIN_DATA_DIR = testData;
// Start from the prior release with an operator-edited entry. Migration must
// add new topics without overwriting the operator or re-adding them on restart.
const seed = await import('../repositories/knowledgeSeed.js');
await writeFile(resolve(testData, 'knowledge-seed-state.json'), JSON.stringify({ applied: true, curationVersion: 3 }));
await writeFile(resolve(testData, 'knowledge-documents.json'), JSON.stringify(seed.initialKnowledgeDocuments.filter((item) => !item.id.startsWith('dx-topic-'))
  .map((item) => item.id === 'dx-company-location' ? { ...item, content: '人工维护的公司地址测试记录。', updatedBy: 'operator-fixture' } : item)));
await writeFile(resolve(testData, 'knowledge-sources.json'), JSON.stringify(seed.initialKnowledgeSources.map((source) =>
  ['dx-company-publicity', 'dx-ip-list', 'dx-awards-list'].includes(source.id) ? { ...source, processingStatus: 'CATALOGUED', scope: 'REFERENCE' } : source)));
const service = await import('./knowledge.service.js');
const repository = await import('../repositories/system.repository.js');
const sourceService = await import('./knowledgeSource.service.js');
after(async () => { await rm(testData, { recursive: true, force: true }); });

const draftInput = { title: '测试知识问题', content: '这是回归测试资料，不是产品事实。', category: 'OTHER', tags: ['测试'],
  scope: 'GENERAL', sourceId: 'dx-company-new', sourceLocation: '测试章节' };
const patch = (document: { id: string; version?: number }, action: string, values = {}) =>
  service.updateKnowledgeDocument(document.id, { action, expectedVersion: document.version ?? 1, ...values }, 'test-editor');

test('curated seed is idempotent and excludes reference material from live answers', async () => {
  const first = await service.listKnowledgeDocuments();
  assert.equal(first.filter((item) => item.status === 'PUBLISHED').length, 50);
  assert.equal((await service.listKnowledgeDocuments()).length, first.length);
  assert.equal(first.find((item) => item.id === 'dx-company-location')?.content, '人工维护的公司地址测试记录。');
  assert.equal(JSON.parse(await readFile(resolve(testData, 'knowledge-seed-state.json'), 'utf8')).curationVersion, 4);
  assert.equal((await service.listKnowledgeSources()).find((source) => source.id === 'dx-ip-list')?.processingStatus, 'EXTRACTED');
  assert.equal((await service.listKnowledgeSources()).find((source) => source.id === 'dx-ip-list')?.scope, 'REFERENCE');
  assert.equal((await service.getVoiceKnowledge('介绍一下东信')).fastAnswer, first.find((item) => item.id === 'dx-company-about')?.content);
  assert.equal((await service.getVoiceKnowledge('MJYB03YL 常见故障排查参考', [], 'MJYB03YL')).hits.length, 0);
});

test('review lifecycle preserves active answer until replacement is approved and records history', async () => {
  const draft = await service.upsertKnowledgeDocument({ ...draftInput, status: 'PUBLISHED' }, 'test-editor');
  assert.equal(draft.status, 'DRAFT', 'a create request cannot publish');
  await assert.rejects(patch(draft, 'PUBLISH'), { code: 'INVALID_KNOWLEDGE_STATUS' });
  let review = await patch(draft, 'SUBMIT');
  await assert.rejects(patch(review, 'REJECT'), { code: 'REASON_REQUIRED' });
  const rejected = await patch(review, 'REJECT', { reason: '请核对依据' });
  assert.equal(rejected.status, 'DRAFT');
  review = await patch(rejected, 'SUBMIT');
  const published = await service.updateKnowledgeDocument(review.id, { action: 'PUBLISH', expectedVersion: review.version }, 'test-reviewer');
  const fork = await patch(published, 'SAVE', { content: '测试第二版答案。' });
  assert.notEqual(fork.id, published.id);
  assert.equal(fork.revision, 2);
  assert.equal((await service.getVoiceKnowledge(draftInput.title)).fastAnswer, draftInput.content);
  await assert.rejects(patch(published, 'SAVE'), { code: 'DRAFT_EXISTS' });
  const submitted = await patch(fork, 'SUBMIT');
  const replacement = await patch(submitted, 'PUBLISH');
  assert.equal((await service.getVoiceKnowledge(draftInput.title)).fastAnswer, replacement.content);
  const history = await service.getKnowledgeHistory(replacement.id);
  assert.equal(history.versions.filter((item) => item.status === 'PUBLISHED').length, 1);
  assert.equal(history.versions.find((item) => item.id === published.id)?.status, 'ARCHIVED');
  assert.ok(history.events.some((event) => event.actor === 'test-reviewer' && event.action === 'PUBLISH'));
  assert.ok(history.events.some((event) => event.reason === '请核对依据'));
  const archived = await patch(replacement, 'ARCHIVE');
  assert.equal((await service.getVoiceKnowledge(draftInput.title)).fastAnswer, null);
  const restored = await patch(archived, 'RESTORE');
  assert.equal(restored.status, 'DRAFT');
  assert.equal(restored.revision, 3);
  assert.equal((await service.getVoiceKnowledge(draftInput.title)).fastAnswer, null);
});

test('concurrent edits require version match and reject the losing write', async () => {
  const draft = await service.upsertKnowledgeDocument({ ...draftInput, title: '并发编辑测试' });
  const results = await Promise.allSettled([patch(draft, 'SAVE', { content: 'A' }), patch(draft, 'SAVE', { content: 'B' })]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  const failed = results.find((item) => item.status === 'rejected') as PromiseRejectedResult;
  assert.equal(failed.reason.code, 'KNOWLEDGE_CONFLICT');
});

test('reference, unparsed and model-only sources cannot become general published knowledge', async () => {
  for (const [sourceId, code] of [['mijia-s1-faults', 'REFERENCE_ONLY'], ['mijia-s1-manual', 'REFERENCE_ONLY']] as const) {
    const draft = await service.upsertKnowledgeDocument({ ...draftInput, sourceId });
    await assert.rejects(patch(draft, 'SUBMIT'), { code });
  }
  await assert.rejects(service.upsertKnowledgeDocument({ ...draftInput, scope: 'MODEL', modelIds: [] }), { code: 'MODEL_REQUIRED' });
  const source = await sourceService.uploadKnowledgeSource({ title: '测试型号来源', fileName: 'model.txt', scope: 'MODEL', base64: Buffer.from('仅测试型号 A 的资料').toString('base64') }, 'test-editor');
  const draft = await service.upsertKnowledgeDocument({ ...draftInput, sourceId: source.source.id });
  await assert.rejects(patch(draft, 'SUBMIT'), { code: 'MODEL_SCOPE_REQUIRED' });
  let modelDraft = await service.upsertKnowledgeDocument({ ...draftInput, title: '测试型号额定功率是多少', sourceId: source.source.id, scope: 'MODEL', modelIds: ['FIXTURE-A'] });
  modelDraft = await patch(modelDraft, 'SUBMIT');
  modelDraft = await patch(modelDraft, 'PUBLISH');
  assert.equal((await service.getVoiceKnowledge(modelDraft.title, [], 'FIXTURE-B')).fastAnswer, null);
  assert.equal((await service.getVoiceKnowledge(modelDraft.title, [], 'FIXTURE-A')).fastAnswer, modelDraft.content);
});

test('source ingest extracts original text, rejects duplicates and preserves source boundaries', async () => {
  const original = '资料上传回归测试：必须核对后发布。';
  const uploaded = await sourceService.uploadKnowledgeSource({ title: 'UTF8来源', fileName: 'fixture.md', scope: 'GENERAL', base64: Buffer.from(original).toString('base64') }, 'test-editor');
  assert.equal(uploaded.text, original);
  assert.equal((await sourceService.previewKnowledgeSource(uploaded.source.id)).text, original);
  assert.equal((await sourceService.getKnowledgeSourceFile(uploaded.source.id)).buffer.toString(), original);
  await assert.rejects(sourceService.uploadKnowledgeSource({ title: '重复', fileName: 'another.md', scope: 'GENERAL', base64: Buffer.from(original).toString('base64') }, 'test-editor'), { code: 'DUPLICATE_SOURCE' });
  await assert.rejects(sourceService.uploadKnowledgeSource({ title: '不支持', fileName: 'fixture.zip', scope: 'GENERAL', base64: 'YWJj' }, 'test-editor'), { code: 'UNSUPPORTED_SOURCE' });
  const xml = '<w:document><w:body><w:p><w:r><w:t>测试文档正文</w:t></w:r></w:p></w:body></w:document>';
  const docx = Buffer.from(zipSync({ 'word/document.xml': strToU8(xml), 'private.txt': strToU8('不应提取的内容') }));
  assert.equal(await sourceService.extractKnowledgeText(docx, '.docx'), '测试文档正文');
  const deck = Buffer.from(zipSync({ 'ppt/slides/slide2.xml': strToU8('<a:t>第二页</a:t>'), 'ppt/slides/slide1.xml': strToU8('<a:t>第一页</a:t>') }));
  assert.equal(await sourceService.extractKnowledgeText(deck, '.pptx'), '第 1 页\n第一页\n\n第 2 页\n第二页');
  await assert.rejects(sourceService.extractKnowledgeText(Buffer.from(zipSync({ 'word/document.xml': strToU8('<!DOCTYPE test><w:t>unsafe</w:t>') })), '.docx'), { code: 'INVALID_DOCUMENT' });
  const sources = await service.listKnowledgeSources();
  await repository.saveKnowledgeSources([...sources, { ...uploaded.source, id: 'invalid-path-fixture', storageKey: '../knowledge-documents.json' }]);
  await assert.rejects(sourceService.getKnowledgeSourceFile('invalid-path-fixture'), { code: 'INVALID_PATH' });
});

test('authenticated editors cannot publish and reviewers cannot edit content', async () => {
  const keys = ['OPS_AUTH_MODE', 'OPS_ADMIN_USERNAME', 'OPS_ADMIN_PASSWORD_HASH', 'OPS_AUTH_TOKEN_SECRET', 'OPS_CORS_ORIGINS', 'OPS_KNOWLEDGE_USERS'];
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const salt = Buffer.from('fixture-salt-at-least-16-bytes');
  const digest = pbkdf2Sync('test-password', salt, 210000, 32, 'sha256').toString('base64url');
  const hash = `pbkdf2$210000$${salt.toString('base64url')}$${digest}`;
  process.env.OPS_AUTH_MODE = 'enabled';
  process.env.OPS_ADMIN_USERNAME = 'admin';
  process.env.OPS_ADMIN_PASSWORD_HASH = hash;
  process.env.OPS_AUTH_TOKEN_SECRET = 'knowledge-regression-only-secret-32-chars';
  process.env.OPS_CORS_ORIGINS = 'http://127.0.0.1:3020';
  process.env.OPS_KNOWLEDGE_USERS = JSON.stringify(['EDITOR', 'REVIEWER'].map((role) => ({ username: role.toLowerCase(), displayName: role, role, passwordHash: hash })));
  const server = Fastify();
  try {
    const auth = await import('./operationsAuth.service.js');
    const { registerKnowledgeRoutes } = await import('../routes/knowledge.routes.js');
    server.addHook('onRequest', async (request) => { auth.authenticateOperationsRequest(request.headers.authorization); });
    server.setErrorHandler((error, _request, reply) => reply.code((error as { statusCode?: number }).statusCode ?? 500).send({ error: (error as Error).message }));
    await registerKnowledgeRoutes(server);
    const headers = (username: string) => ({ authorization: `Bearer ${auth.loginOperationsUser({ username, password: 'test-password' }).token}` });
    assert.equal((await server.inject({ method: 'GET', url: '/api/knowledge/entries' })).statusCode, 401);
    assert.equal((await server.inject({ method: 'POST', url: '/api/knowledge/sources/dx-company-new/import', headers: headers('reviewer'), payload: {} })).statusCode, 403);
    const created = await server.inject({ method: 'POST', url: '/api/knowledge/documents', headers: headers('editor'), payload: draftInput });
    assert.equal(created.statusCode, 200);
    const draft = created.json();
    assert.equal((await server.inject({ method: 'PATCH', url: `/api/knowledge/documents/${draft.id}`, headers: headers('reviewer'), payload: { action: 'SAVE', expectedVersion: draft.version, content: '不应修改' } })).statusCode, 403);
    const review = await server.inject({ method: 'PATCH', url: `/api/knowledge/documents/${draft.id}`, headers: headers('editor'), payload: { action: 'SUBMIT', expectedVersion: draft.version } });
    assert.equal(review.statusCode, 200);
    const publication = { action: 'PUBLISH', expectedVersion: review.json().version };
    assert.equal((await server.inject({ method: 'PATCH', url: `/api/knowledge/documents/${draft.id}`, headers: headers('editor'), payload: publication })).statusCode, 403);
    assert.equal((await server.inject({ method: 'PATCH', url: `/api/knowledge/documents/${draft.id}`, headers: headers('reviewer'), payload: publication })).statusCode, 200);
    const token = headers('editor').authorization;
    process.env.OPS_KNOWLEDGE_USERS = '[]';
    assert.throws(() => auth.authenticateOperationsRequest(token), { code: 'ACCOUNT_CHANGED' });
  } finally {
    await server.close();
    for (const key of keys) { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; }
  }
});

test('batch import stays draft, is idempotent after edits and archive, and rejects changed sources', async () => {
  const text = ['第一段批量导入测试资料，不是实际的产品知识。这段文字用于检查来源定位、重复导入和人工维护保护。',
    '第二段批量导入测试资料，不是实际的产品知识。这段文字用于检查多个章节能够一次导入而不会直接发布。'].join('\n\n');
  const preview = await sourceService.uploadKnowledgeSource({ title: '批量导入测试', fileName: 'batch.txt', scope: 'GENERAL', base64: Buffer.from(text).toString('base64') }, 'test-editor');
  assert.equal(preview.sections.length, 2);
  const input = { extractionHash: preview.extractionHash, sectionIds: preview.sections.map((section) => section.id) };
  await assert.rejects(sourceService.importKnowledgeSourceSections(preview.source.id, { ...input, extractionHash: 'a'.repeat(64) }, 'test-editor'), { code: 'SOURCE_CHANGED' });
  await assert.rejects(sourceService.importKnowledgeSourceSections(preview.source.id, { ...input, sectionIds: ['missing'] }, 'test-editor'), { code: 'INVALID_SECTIONS' });
  const imported = await sourceService.importKnowledgeSourceSections(preview.source.id, input, 'test-editor');
  assert.equal(imported.created, 2);
  const drafts = (await service.listKnowledgeDocuments()).filter((document) => imported.documentIds.includes(document.id));
  assert.ok(drafts.every((document) => document.status === 'DRAFT' && document.sourceId === preview.source.id && document.sourceSectionId && document.sourceLocation));
  await patch(drafts[0], 'SAVE', { content: '人工校对后的测试正文，应保留此修改。' });
  await patch(drafts[1], 'ARCHIVE');
  const repeated = await sourceService.importKnowledgeSourceSections(preview.source.id, input, 'test-editor');
  assert.equal(repeated.created, 0);
  assert.equal(repeated.skipped, 2);
  assert.equal((await service.listKnowledgeDocuments()).find((document) => document.id === drafts[0].id)?.content, '人工校对后的测试正文，应保留此修改。');
  assert.ok((await service.getKnowledgeHistory(drafts[0].id)).events.some((event) => event.action === 'IMPORT' && event.actor === 'test-editor'));
  assert.equal((await service.getVoiceKnowledge(drafts[0].title)).fastAnswer, null);
});

test('batch import enforces model assignment and never exposes reference text', async () => {
  const text = '这一段为参考资料隔离测试的固定内容，不可当作真实产品事实，也不能在未经审核时直接用于回答用户问题。';
  const model = await sourceService.uploadKnowledgeSource({ title: '型号批量来源', fileName: 'model-batch.txt', scope: 'MODEL', base64: Buffer.from(text).toString('base64') }, 'test-editor');
  const input = { extractionHash: model.extractionHash, sectionIds: model.sections.map((section) => section.id) };
  await assert.rejects(sourceService.importKnowledgeSourceSections(model.source.id, input, 'test-editor'), { code: 'MODEL_REQUIRED' });
  const imported = await sourceService.importKnowledgeSourceSections(model.source.id, { ...input, modelIds: ['TEST-MODEL'] }, 'test-editor');
  const draft = (await service.listKnowledgeDocuments()).find((document) => document.id === imported.documentIds[0])!;
  assert.deepEqual(draft.modelIds, ['TEST-MODEL']);
  const reference = await sourceService.uploadKnowledgeSource({ title: '仅参考批量来源', fileName: 'reference-batch.txt', scope: 'REFERENCE', base64: Buffer.from(`${text}内部专用。`).toString('base64') }, 'test-editor');
  const refImport = await sourceService.importKnowledgeSourceSections(reference.source.id, { extractionHash: reference.extractionHash, sectionIds: reference.sections.map((section) => section.id) }, 'test-editor');
  const refDraft = (await service.listKnowledgeDocuments()).find((document) => document.id === refImport.documentIds[0])!;
  assert.equal(refDraft.scope, 'REFERENCE');
  await assert.rejects(patch(refDraft, 'SUBMIT'), { code: 'REFERENCE_ONLY' });
  assert.equal((await service.getVoiceKnowledge(refDraft.title)).fastAnswer, null);
});
