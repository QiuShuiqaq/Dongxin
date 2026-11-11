import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { PDFParse } from 'pdf-parse';
import { ApiError } from '../http/apiError.js';

export type KnowledgeSection = { id: string; title: string; location: string; text: string };
const MAX_CHARACTERS = 300_000;
const MAX_SECTIONS = 1000;
const normalParser = new XMLParser({ ignoreAttributes: false, processEntities: false, parseTagValue: false });
const orderedParser = new XMLParser({ ignoreAttributes: false, preserveOrder: true, processEntities: false, parseTagValue: false });
const array = (value: any): any[] => Array.isArray(value) ? value : value == null ? [] : [value];
const valueOf = (value: any): string => String(typeof value === 'object' ? value?.['#text'] ?? '' : value ?? '');
const clean = (text: string) => text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/[ \t]+/g, ' ').trim();

function parse(xml: string, ordered = false): any {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ApiError(422, 'INVALID_DOCUMENT', '文档包含不支持的 XML 声明');
  return (ordered ? orderedParser : normalParser).parse(xml);
}
function officeText(value: any, key = ''): string {
  if (key === 'a:t' || key === 'w:t') {
    if (Array.isArray(value)) return value.map((item) => officeText(item, key)).join(' ');
    // preserveOrder puts text in [{ '#text': ... }]. xml:space may wrap it.
    if (value && typeof value === 'object') return '#text' in value ? valueOf(value) : Object.entries(value).map(([name, item]) => officeText(item, name)).join('');
    return String(value ?? '');
  }
  if (key === '#text') return valueOf(value);
  if (Array.isArray(value)) return value.map((item) => officeText(item, key)).filter(Boolean).join(' ');
  if (value && typeof value === 'object') return Object.entries(value).filter(([name]) => name !== ':@' && !name.startsWith('@_')).map(([name, item]) => officeText(item, name)).filter(Boolean).join(' ');
  return '';
}
function section(location: string, text: string, title?: string): KnowledgeSection {
  const content = clean(text);
  return { id: createHash('sha256').update(`${location}\0${content}`).digest('hex').slice(0, 24), location,
    title: title || content.slice(0, 65), text: content };
}
function officeFiles(buffer: Buffer, extension: string) {
  let expanded = 0;
  return unzipSync(buffer, { filter: (file) => {
    const selected = extension === '.docx' ? file.name === 'word/document.xml'
      : extension === '.pptx' ? /^ppt\/slides\/slide\d+\.xml$/.test(file.name)
        : /^xl\/(sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml)$/.test(file.name);
    if (!selected) return false;
    expanded += file.originalSize;
    if (expanded > 12 * 1024 * 1024) throw new ApiError(422, 'DOCUMENT_TOO_LARGE', '文档解压后的正文过大，请分拆上传');
    return true;
  } });
}
function wordSections(xml: string): KnowledgeSection[] {
  const root = array(parse(xml, true));
  const document = root.find((node) => node['w:document'])?.['w:document'];
  const body = array(document).find((node) => node['w:body'])?.['w:body'];
  const output: KnowledgeSection[] = [];
  let paragraph = 0, table = 0, heading = '';
  for (const node of array(body)) {
    if (node['w:p']) {
      paragraph++;
      const text = clean(officeText(node['w:p']));
      if (!text) continue;
      if (text.length <= 35 && !/[。；;]$/.test(text)) {
        heading = text;
        output.push(section(`段落 ${paragraph}`, text));
      } else output.push(section(`段落 ${paragraph}${heading ? ` · ${heading.slice(0, 70)}` : ''}`, text, heading ? `${heading}：${text.slice(0, 40)}` : undefined));
    } else if (node['w:tbl']) {
      table++;
      const rows = array(node['w:tbl']).filter((item) => item['w:tr']).map((item) =>
        array(item['w:tr']).filter((cell) => cell['w:tc']).map((cell) => clean(officeText(cell['w:tc']))));
      const headers = rows[0]?.join(' | ') ?? '';
      rows.forEach((cells, index) => {
        if (index === 0 || !cells.some((cell) => cell.length > 3)) return;
        const text = cells.join(' | ');
        if (text.replace(/[\d\s|]/g, '').length < 8) return;
        output.push(section(`表格 ${table} · 第 ${index + 1} 行`, `${headers}\n${text}`, `${heading || '表格'}：${cells.find((cell) => cell.length > 3)?.slice(0, 55)}`));
      });
    }
  }
  return output;
}
function spreadsheetSections(files: Record<string, Uint8Array>): KnowledgeSection[] {
  const strings = files['xl/sharedStrings.xml'] ? array(parse(strFromU8(files['xl/sharedStrings.xml'])).sst?.si)
    .map((item) => item.t != null ? valueOf(item.t) : array(item.r).map((run) => valueOf(run.t)).join('')) : [];
  const relations = files['xl/_rels/workbook.xml.rels'] ? array(parse(strFromU8(files['xl/_rels/workbook.xml.rels'])).Relationships?.Relationship) : [];
  const sheets = files['xl/workbook.xml'] ? array(parse(strFromU8(files['xl/workbook.xml'])).workbook?.sheets?.sheet) : [];
  const sheetNames = new Map<string, string>();
  for (const sheet of sheets) {
    const target = relations.find((relation) => relation['@_Id'] === sheet['@_r:id'])?.['@_Target'];
    if (target) sheetNames.set(target.startsWith('/') ? target.slice(1) : posix.normalize(`xl/${target}`), sheet['@_name']);
  }
  const output: KnowledgeSection[] = [];
  for (const name of Object.keys(files).filter((name) => /worksheets/.test(name)).sort()) {
    const rows = array(parse(strFromU8(files[name])).worksheet?.sheetData?.row);
    let headers = new Map<string, string>();
    for (const row of rows) {
      const cells = array(row.c).map((cell) => ({ column: String(cell['@_r']).replace(/\d+$/, ''),
        value: clean(cell['@_t'] === 's' ? strings[Number(cell.v)] ?? '' : cell.is ? valueOf(cell.is.t) || array(cell.is.r).map((run) => valueOf(run.t)).join('') : valueOf(cell.v)) })).filter((cell) => cell.value);
      if (cells.some((cell) => ['序号', '专利名称', '名称', '商标名称', '登记号'].includes(cell.value))) {
        headers = new Map(cells.map((cell) => [cell.column, cell.value])); continue;
      }
      if (!headers.size || !cells.some((cell) => cell.column !== 'A' && cell.value.length >= 3)) continue;
      const sheet = sheetNames.get(name) || name.split('/').pop()!;
      const content = cells.map((cell) => `${headers.get(cell.column) || cell.column}：${cell.value}`).join('；');
      const titleCell = cells.find((cell) => /名称/.test(headers.get(cell.column) || ''));
      output.push(section(`工作表“${sheet}” · 第 ${row['@_r']} 行`, content, `${sheet}：${titleCell?.value || cells[1]?.value || content.slice(0, 40)}`));
    }
  }
  return output;
}

export async function extractKnowledgeSections(buffer: Buffer, extension: string): Promise<KnowledgeSection[]> {
  let sections: KnowledgeSection[] = [];
  if (extension === '.txt' || extension === '.md') {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch { throw new ApiError(422, 'INVALID_TEXT', '请上传 UTF-8 文本文件'); }
    if (text.includes('\0')) throw new ApiError(422, 'INVALID_TEXT', '请上传 UTF-8 文本文件');
    sections = text.slice(0, MAX_CHARACTERS).split(/\n\s*\n/).map((text, index) => section(`段落 ${index + 1}`, text));
  } else if (['.docx', '.pptx', '.xlsx'].includes(extension)) {
    const files = officeFiles(buffer, extension);
    if (extension === '.docx') sections = wordSections(strFromU8(files['word/document.xml'] ?? new Uint8Array()));
    else if (extension === '.xlsx') sections = spreadsheetSections(files);
    else sections = Object.keys(files).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((name) => section(`第 ${name.match(/slide(\d+)/)?.[1]} 页`, officeText(parse(strFromU8(files[name])))));
  } else if (extension === '.pdf') {
    const pdf = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      if ((await pdf.getInfo()).total > 200) throw new ApiError(422, 'TOO_MANY_PAGES', 'PDF 最多 200 页，请按章节分拆上传');
      sections = (await pdf.getText()).pages.map((page) => section(`第 ${page.num} 页`, page.text));
    } finally { await pdf.destroy(); }
  }
  // Bound each candidate to an editable document. Splitting never creates published knowledge.
  const output: KnowledgeSection[] = [];
  let characters = 0;
  for (const item of sections) {
    for (let offset = 0; offset < item.text.length; offset += 12000) {
      const text = item.text.slice(offset, Math.min(offset + 12000, offset + MAX_CHARACTERS - characters));
      if (!text.trim()) continue;
      output.push(section(`${item.location}${item.text.length > 12000 ? ` · 分段 ${Math.floor(offset / 12000) + 1}` : ''}`, text, item.title));
      characters += text.length;
      if (characters >= MAX_CHARACTERS || output.length >= MAX_SECTIONS) return output;
    }
  }
  return output;
}

export function candidateKnowledgeSections(sections: KnowledgeSection[]): KnowledgeSection[] {
  const seen = new Set<string>();
  return sections.filter((section) => {
    const normalized = section.text.replace(/\s|\d+\s*\/\s*\d+/g, '');
    if (normalized.length < 35 || seen.has(normalized)) return false;
    if (/单击此处添加|点击此处添加/.test(section.text)) return false;
    seen.add(normalized);
    return true;
  });
}
