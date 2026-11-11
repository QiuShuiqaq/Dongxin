import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { KnowledgeScopeSchema, type KnowledgeSource } from '@dongxin/shared';
import { ApiError } from '../http/apiError.js';
import { getDataPath } from '../storage.js';
import { listKnowledgeSources, saveKnowledgeSources } from '../repositories/system.repository.js';
import { createKnowledgeSourceDrafts, serializeKnowledgeMutation } from './knowledge.service.js';
import { candidateKnowledgeSections, extractKnowledgeSections } from './knowledgeExtraction.js';

const MAX_FILE_BYTES = 6 * 1024 * 1024;
const UploadSchema = z.object({
  title: z.string().trim().min(1).max(200),
  fileName: z.string().min(1).max(200),
  base64: z.string().min(1).max(Math.ceil(MAX_FILE_BYTES * 4 / 3) + 4),
  scope: KnowledgeScopeSchema,
  note: z.string().max(1000).default(''),
});
const allowedExtensions = ['.txt', '.md', '.docx', '.pptx', '.xlsx', '.pdf'];
export async function extractKnowledgeText(buffer: Buffer, extension: string): Promise<string> {
  const sections = await extractKnowledgeSections(buffer, extension);
  return sections.map((section) => `${['.pptx', '.xlsx', '.pdf'].includes(extension) ? `${section.location}\n` : ''}${section.text}`).join('\n\n');
}
function within(root: string, candidate: string) {
  const path = relative(root, candidate);
  if (isAbsolute(path) || path === '..' || path.startsWith('..\\') || path.startsWith('../')) throw new ApiError(422, 'INVALID_PATH', '资料路径无效');
  return candidate;
}
export async function getKnowledgeSourceFile(id: string): Promise<{ source: KnowledgeSource; buffer: Buffer }> {
  const source = (await listKnowledgeSources()).find((item) => item.id === id);
  if (!source) throw new ApiError(404, 'SOURCE_NOT_FOUND', '资料来源不存在');
  if (source.kind === 'MEDIA_GROUP' || source.kind === 'ARCHIVE') throw new ApiError(422, 'SOURCE_GROUP', '该项为素材分组或重复压缩包，请查看原始资料目录');
  const storedRoot = getDataPath('knowledge-files');
  const originalRoot = resolve(process.env.KNOWLEDGE_SOURCE_ROOT || fileURLToPath(new URL('../../../../../ziliao/', import.meta.url)));
  const path = source.storageKey ? within(storedRoot, resolve(storedRoot, source.storageKey)) : within(originalRoot, resolve(originalRoot, source.relativePath));
  try { return { source, buffer: await readFile(path) }; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ApiError(404, 'SOURCE_FILE_MISSING', '原始资料文件未找到，请在服务器配置资料目录或重新上传');
    throw error;
  }
}
export async function previewKnowledgeSource(id: string) {
  const { source, buffer } = await getKnowledgeSourceFile(id);
  const extension = extname(source.fileName).toLowerCase();
  if (!allowedExtensions.includes(extension)) return { source, text: '', sections: [], extractionHash: '', note: '该格式暂不支持文字预览，请下载原文件核对。' };
  const all = await extractKnowledgeSections(buffer, extension);
  const sections = candidateKnowledgeSections(all);
  const text = all.map((section) => `${all.length > 1 ? `${section.location}\n` : ''}${section.text}`).join('\n\n');
  return { source, text, sections, extractionHash: createHash('sha256').update(buffer).digest('hex'),
    note: text ? `已提取 ${all.length} 段正文，可批量整理 ${sections.length} 段。机器提取内容仍需核对；草稿不参与回答。` : '未提取到可用正文，需要 OCR 和人工校对。' };
}
export async function importKnowledgeSourceSections(id: string, input: unknown, actor: string) {
  const body = z.object({ extractionHash: z.string().regex(/^[a-f\d]{64}$/), sectionIds: z.array(z.string().min(1)).min(1).max(200),
    modelIds: z.array(z.string().trim().min(1).max(100)).max(20).default([]) }).parse(input);
  const preview = await previewKnowledgeSource(id);
  if (preview.extractionHash !== body.extractionHash) throw new ApiError(409, 'SOURCE_CHANGED', '来源文件已变化，请重新预览后导入');
  const wanted = new Set(body.sectionIds);
  const selected = preview.sections.filter((section) => wanted.has(section.id));
  if (selected.length !== wanted.size) throw new ApiError(422, 'INVALID_SECTIONS', '选择的章节无效，请重新预览');
  return createKnowledgeSourceDrafts(preview.source, selected, body.modelIds, actor);
}
export async function uploadKnowledgeSource(input: unknown, actor: string) {
  const body = UploadSchema.parse(input);
  const name = basename(body.fileName.replace(/\\/g, '/'));
  const extension = extname(name).toLowerCase();
  if (!allowedExtensions.includes(extension)) throw new ApiError(422, 'UNSUPPORTED_SOURCE', '支持 TXT、Markdown、DOCX、PPTX、XLSX 和 PDF；旧 DOC 请先另存为 DOCX');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64)) throw new ApiError(422, 'INVALID_FILE', '文件编码无效');
  const buffer = Buffer.from(body.base64, 'base64');
  if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw new ApiError(422, 'FILE_TOO_LARGE', '单个文件最多 6 MB');
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  let text: string;
  try { text = await extractKnowledgeText(buffer, extension); }
  catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, 'SOURCE_PARSE_FAILED', '无法解析该文件，请确认文件未加密且格式正确');
  }
  const usefulText = text.replace(/--\s*\d+\s*of\s*\d+\s*--/g, '').trim();
  return serializeKnowledgeMutation(async () => {
    const sources = await listKnowledgeSources();
    if (sources.some((item) => item.sha256 === sha256)) throw new ApiError(409, 'DUPLICATE_SOURCE', '相同文件已在资料库中，无需重复上传');
    const id = randomUUID();
    const storageKey = `${id}${extension}`;
    const source: KnowledgeSource = { id, title: body.title, fileName: name, relativePath: name, storageKey,
      kind: extension === '.pptx' ? 'PRESENTATION' : extension === '.pdf' ? 'MANUAL' : extension === '.xlsx' ? 'SPREADSHEET' : 'DOCUMENT',
      processingStatus: usefulText ? 'EXTRACTED' : 'NEEDS_OCR', scope: body.scope, note: body.note,
      sha256, sizeBytes: buffer.length, createdAt: new Date().toISOString(), createdBy: actor };
    await mkdir(getDataPath('knowledge-files'), { recursive: true });
    await writeFile(getDataPath(`knowledge-files/${storageKey}`), buffer, { flag: 'wx' });
    await saveKnowledgeSources([...sources, source]);
    const sections = candidateKnowledgeSections(await extractKnowledgeSections(buffer, extension));
    return { source, text: usefulText, sections, extractionHash: sha256,
      note: usefulText ? `已提取文字，可批量整理 ${sections.length} 段草稿，经审核后发布。` : '未提取到正文；待 OCR 和人工核对后再整理为知识。' };
  });
}
