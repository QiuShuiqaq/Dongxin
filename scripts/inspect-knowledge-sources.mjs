// Local corpus inspection only. No model, audio, MQTT or hardware calls.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { PDFParse } from 'pdf-parse';

const root = resolve(process.argv[2] || '../ziliao');
const output = resolve('.artifacts/knowledge-corpus');
await mkdir(output, { recursive: true });
const parser = new XMLParser({ ignoreAttributes: false, processEntities: false });
const array = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
const valueOf = (value) => typeof value === 'object' ? value?.['#text'] ?? '' : value ?? '';
function textOf(value, key = '') {
  if ((key === 'a:t' || key === 'w:t') && value && typeof value === 'object' && '#text' in value) return String(valueOf(value));
  if (typeof value === 'string' || typeof value === 'number') return ['a:t', 'w:t'].includes(key) ? String(value) : '';
  if (Array.isArray(value)) return value.map((item) => textOf(item, key)).filter(Boolean).join(' ');
  if (value && typeof value === 'object') return Object.entries(value).map(([name, item]) => textOf(item, name)).filter(Boolean).join(' ');
  return '';
}
const records = [];
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) { await walk(path); continue; }
    if (item.name.startsWith('~$') || !['.pptx', '.docx', '.xlsx', '.pdf'].includes(extname(item.name))) continue;
    const buffer = await readFile(path);
    const record = { path, sections: [] };
    if (/\.(pptx|docx|xlsx)$/.test(path)) {
      const files = unzipSync(buffer, { filter: (entry) => entry.name === 'word/document.xml' || /^ppt\/slides\/slide\d+\.xml$/.test(entry.name)
        || /^xl\/(sharedStrings.xml|worksheets\/sheet\d+.xml)$/.test(entry.name) });
      const strings = files['xl/sharedStrings.xml'] ? array(parser.parse(strFromU8(files['xl/sharedStrings.xml'])).sst.si)
        .map((item) => item.t != null ? valueOf(item.t) : array(item.r).map((run) => valueOf(run.t)).join('')) : [];
      for (const name of Object.keys(files).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
        const document = parser.parse(strFromU8(files[name]));
        if (/worksheets/.test(name)) {
          for (const row of array(document.worksheet?.sheetData?.row)) {
            const cells = array(row.c).map((cell) => `${cell['@_r']}: ${cell['@_t'] === 's' ? strings[Number(cell.v)] : cell.is?.t ?? cell.v ?? ''}`);
            record.sections.push({ location: `${name}:${row['@_r']}`, text: cells.join(' | ') });
          }
        } else if (!/sharedStrings/.test(name)) record.sections.push({ location: name, text: textOf(document) });
      }
    } else {
      const pdf = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        record.sections = (await pdf.getText()).pages.map((page) => ({ location: `第 ${page.num} 页`, text: page.text }));
        if (!record.sections.some((page) => page.text.trim()) && /MJYB03YL/.test(item.name)) {
          const screenshot = await pdf.getScreenshot({ desiredWidth: 3000, imageDataUrl: false });
          await writeFile(join(output, 'reference-manual.png'), screenshot.pages[0].data);
        }
      } finally { await pdf.destroy(); }
    }
    records.push(record);
  }
}
await walk(root);
await writeFile(join(output, 'extracted.json'), JSON.stringify(records, null, 2));
console.log(JSON.stringify(records.map((record) => ({ file: record.path, sections: record.sections.length,
  characters: record.sections.reduce((sum, section) => sum + section.text.trim().length, 0) })), null, 2));
