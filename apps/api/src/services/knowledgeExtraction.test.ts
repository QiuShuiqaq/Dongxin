import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { candidateKnowledgeSections, extractKnowledgeSections } from './knowledgeExtraction.js';

const archive = (files: Record<string, string>) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([name, xml]) => [name, strToU8(xml)]))));

test('PPT extraction retains real page numbers, text runs and leading zeroes while ignoring embedded files', async () => {
  const sections = await extractKnowledgeSections(archive({
    'ppt/slides/slide12.xml': '<p:sld><a:p><a:r><a:t xml:space="preserve"> 00123 </a:t></a:r><a:r><a:t>检测记录 &amp; 说明</a:t></a:r></a:p></p:sld>',
    'ppt/slides/slide2.xml': '<p:sld><a:t>前页正文</a:t></p:sld>',
    'ppt/notesSlides/notesSlide1.xml': '<a:t>演讲者私有备注</a:t>',
  }), '.pptx');
  assert.deepEqual(sections.map((section) => section.location), ['第 2 页', '第 12 页']);
  assert.equal(sections[1].text, '00123 检测记录 & 说明');
  assert.ok(!JSON.stringify(sections).includes('私有备注'));
});

test('DOCX extraction preserves paragraph/table order, column headings and source row', async () => {
  const paragraph = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const row = (cells: string[]) => `<w:tr>${cells.map((text) => `<w:tc>${paragraph(text)}</w:tc>`).join('')}</w:tr>`;
  const sections = await extractKnowledgeSections(archive({ 'word/document.xml': `<w:document><w:body>${paragraph('故障资料')}
    <w:tbl>${row(['现象', '原因及说明'])}${row(['整机无反应', '测试故障的说明文字，仅作为提取回归测试使用'])}</w:tbl>
    ${paragraph('表格后的一段文字，这一段用于验证原文的先后顺序能够得到保留。')}</w:body></w:document>` }), '.docx');
  assert.equal(sections[0].text, '故障资料');
  assert.equal(sections[1].location, '表格 1 · 第 2 行');
  assert.ok(sections[1].text.startsWith('现象 | 原因及说明\n整机无反应'));
  assert.ok(sections[2].text.startsWith('表格后的一段'));
});

test('XLSX extraction retains worksheet name, identifiers and expiry/abandonment notes', async () => {
  const sections = await extractKnowledgeSections(archive({
    'xl/workbook.xml': '<workbook><sheets><sheet name="知识产权" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>序号</t></si><si><t>专利名称</t></si><si><t>登记号</t></si><si><t>备注</t></si><si><r><t>示例</t></r><r><t>专利名称</t></r></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="s"><v>1</v></c><c r="C2" t="s"><v>2</v></c><c r="D2" t="s"><v>3</v></c></row>' +
      '<row r="7"><c r="A7"><v>1</v></c><c r="B7" t="s"><v>4</v></c><c r="C7" t="inlineStr"><is><t>001234</t></is></c><c r="D7" t="inlineStr"><is><t>2026年已弃，不能宣称有效</t></is></c></row></sheetData></worksheet>',
  }), '.xlsx');
  assert.equal(sections.length, 1);
  assert.equal(sections[0].location, '工作表“知识产权” · 第 7 行');
  assert.ok(sections[0].text.includes('专利名称：示例专利名称'));
  assert.ok(sections[0].text.includes('登记号：001234'));
  assert.ok(sections[0].text.includes('已弃，不能宣称有效'));
});

test('candidate selection rejects empty, placeholder and duplicate text without inflating counts', async () => {
  const paragraph = '这一段是足够长的测试资料正文，用于说明相同正文不会因为重复分页而被统计成多份不同知识。';
  const all = await extractKnowledgeSections(Buffer.from(`${paragraph}\n\n${paragraph}\n\n标题\n\n单击此处添加占位文字${paragraph}`), '.md');
  assert.equal(all.length, 4);
  const candidates = candidateKnowledgeSections(all);
  assert.equal(candidates.length, 1);
  const again = await extractKnowledgeSections(Buffer.from(`${paragraph}\n\n${paragraph}`), '.txt');
  assert.equal(again[0].id, all[0].id);
  assert.notEqual(again[0].id, again[1].id, 'source location remains part of section identity');
});

test('long text is bounded and invalid encoding cannot silently corrupt knowledge', async () => {
  const sections = await extractKnowledgeSections(Buffer.from('测试'.repeat(160000)), '.txt');
  assert.equal(sections.reduce((sum, section) => sum + section.text.length, 0), 300000);
  assert.ok(sections.every((section) => section.text.length <= 12000));
  await assert.rejects(extractKnowledgeSections(Buffer.from([0xff]), '.txt'), { code: 'INVALID_TEXT' });
});
