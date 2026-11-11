import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// The UI is served by the local Vite dev server, while every API call is
// redirected to a disposable server. Never writes live knowledge or controls
// devices. No real model calls, microphone capture, TTS or playback.
await mkdir(resolve('.artifacts'), { recursive: true });
const dataDir = await mkdtemp(resolve('.artifacts', 'knowledge-ui-'));
let startupOutput = '';
const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
  "const {createServer}=await import('./apps/api/src/server.ts'); const app=await createServer(); await app.listen({host:'127.0.0.1',port:0}); console.log('KNOWLEDGE_UI_READY:'+app.server.address().port);"], {
  cwd: process.cwd(), env: { ...process.env, DONGXIN_DATA_DIR: dataDir, MQTT_ENABLED: 'false', OPS_AUTH_MODE: 'disabled' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (data) => { startupOutput = (startupOutput + data).slice(-8000); });
child.stderr.on('data', (data) => { startupOutput = (startupOutput + data).slice(-8000); });
let browser;
let page;
const errors = [];
try {
  let ready = false;
  let apiOrigin;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(startupOutput);
    const match = startupOutput.match(/KNOWLEDGE_UI_READY:(\d+)/);
    if (match) {
      apiOrigin = `http://127.0.0.1:${match[1]}`;
      try { ready = (await fetch(`${apiOrigin}/api/health`)).ok; } catch { /* starting */ }
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, startupOutput);
  browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  await context.route('http://127.0.0.1:3077/**', async (route) => {
    const response = await route.fetch({ url: route.request().url().replace('http://127.0.0.1:3077', apiOrigin) });
    await route.fulfill({ response });
  });
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', async (response) => { if (response.status() >= 500) errors.push(`${response.status()} ${response.url()} ${(await response.text()).slice(0, 1200)}`); });
  await page.goto('http://127.0.0.1:3020/#knowledge', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '知识库', exact: true }).waitFor();
  await page.getByText(/已发布 50 条知识 · 覆盖 \d+ 种问法/).waitFor();
  await page.screenshot({ path: '.artifacts/operations-knowledge-desktop.png', fullPage: true });
  await noOverflow(page);

  // Import a real UTF-8 file through FileReader and the actual upload endpoint.
  await page.getByRole('tab', { name: '资料来源', exact: true }).click();
  await page.getByRole('button', { name: '上传资料', exact: true }).click();
  await page.getByLabel('选择资料文件').setInputFiles({ name: 'fixture.md', mimeType: 'text/markdown', buffer: Buffer.from([
    '批量页面测试第一段资料。这一段是页面回归测试内容，仅用于临时测试，不是正式的企业或者产品事实。',
    '批量页面测试第二段资料。这一段用于验证多条草稿的批量送审发布、来源位置和重复导入保护，不能作为产品事实。',
  ].join('\n\n')) });
  await page.getByLabel('上传资料范围').click();
  await page.locator('.ant-select-dropdown:visible').getByText('浴霸通用知识', { exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /确.*定/ }).click();
  await page.getByRole('button', { name: '整理为草稿', exact: true }).waitFor();
  await page.getByRole('tab', { name: '可整理章节 · 2', exact: true }).waitFor();
  await page.getByRole('tab', { name: '提取全文', exact: true }).click();
  assert.ok((await page.locator('.kb-source-text:visible').innerText()).includes('页面回归测试内容'));
  await page.getByRole('button', { name: '整理为草稿', exact: true }).click();
  await page.getByLabel('问题 / 知识标题').fill('页面回归知识问题');
  await page.getByLabel('经核对的正文 / 答案').fill('页面回归测试回答，不能作为产品事实。');
  const scope = page.getByLabel('适用范围', { exact: true });
  await scope.click();
  await page.locator('.ant-select-dropdown:visible').getByText('浴霸通用知识', { exact: true }).click();
  await page.getByLabel('来源位置（页码 / 章节，送审前必填）').fill('第 1 段');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await page.getByRole('tab', { name: '知识条目', exact: true }).click();
  const search = page.getByLabel('搜索知识');
  await search.fill('页面回归知识问题');
  let row = page.locator('tr', { hasText: '页面回归知识问题' });
  await row.getByRole('button', { name: /^送\s*审$/ }).click();
  await page.getByRole('tab', { name: /待审核/ }).click();
  row = page.locator('tr', { hasText: '页面回归知识问题' });
  await row.getByRole('button', { name: '审核发布', exact: true }).click();
  await page.locator('.ant-popconfirm').getByRole('button', { name: /确.*定/ }).click();
  await page.getByText('审核发布完成', { exact: true }).waitFor();

  await page.getByRole('tab', { name: '问答测试', exact: true }).click();
  await page.getByLabel('知识问答问题').fill('页面回归知识问题');
  await page.getByRole('button', { name: '测试问答', exact: true }).click();
  await page.getByText('已发布问答直接回答', { exact: true }).waitFor();
  assert.ok((await page.locator('.kb-answer').innerText()).includes('页面回归测试回答'));
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出本次结果', exact: true }).click();
  assert.ok((await download).suggestedFilename().endsWith('.json'));
  await page.getByLabel('知识问答问题').fill('东信浴霸免费保修多少年');
  await page.getByRole('button', { name: '测试问答', exact: true }).click();
  await page.getByText('资料不足 / 保守答复', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.ant-message-notice'));
  await page.screenshot({ path: '.artifacts/operations-knowledge-query.png', fullPage: true });

  await page.getByRole('tab', { name: '知识条目', exact: true }).click();
  row = page.locator('tr', { hasText: '页面回归知识问题' });
  await row.getByRole('button', { name: '版本记录', exact: true }).click();
  await page.getByText('版本与操作记录 · 页面回归知识问题', { exact: true }).waitFor();
  await page.locator('.kb-history-event').nth(2).waitFor();
  assert.ok((await page.locator('.kb-history-event').count()) >= 3);
  await page.locator('.ant-drawer-close').click();
  await row.getByRole('button', { name: /^停\s*用$/ }).click();
  await page.locator('.ant-popconfirm').getByRole('button', { name: /确.*定/ }).click();
  await row.getByRole('button', { name: '恢复草稿', exact: true }).waitFor();

  // Import the same original file by chapter, then exercise bulk review and
  // idempotent re-import through the UI, without publishing other seed drafts.
  await page.getByRole('tab', { name: '资料来源', exact: true }).click();
  const sourceRow = page.locator('tr', { hasText: 'fixture.md' });
  await sourceRow.getByRole('button', { name: '查看原文', exact: true }).click();
  await page.getByRole('button', { name: '批量整理为草稿（2）', exact: true }).click();
  await page.getByText('新增 2 条草稿，跳过 0 条已整理内容', { exact: true }).waitFor();
  await search.fill('批量页面测试');
  await page.locator('.kb-panel tbody tr').filter({ hasText: '批量页面测试' }).nth(1).waitFor();
  await page.locator('.kb-panel thead').getByRole('checkbox').check();
  await page.getByRole('button', { name: '批量送审（2）', exact: true }).click();
  await page.getByText('提交审核完成 2 条', { exact: true }).waitFor();
  await page.getByRole('tab', { name: /待审核/ }).click();
  await page.locator('.kb-panel tbody tr').filter({ hasText: '批量页面测试' }).nth(1).waitFor();
  await page.locator('.kb-panel thead').getByRole('checkbox').check();
  await page.getByRole('button', { name: '批量发布（2）', exact: true }).click();
  await page.locator('.ant-popconfirm').getByRole('button', { name: /确.*定/ }).click();
  await page.getByText('审核发布完成 2 条', { exact: true }).waitFor();
  await page.getByRole('tab', { name: '资料来源', exact: true }).click();
  await sourceRow.getByRole('button', { name: '查看原文', exact: true }).click();
  await page.getByRole('button', { name: '批量整理为草稿（2）', exact: true }).click();
  await page.getByText('新增 0 条草稿，跳过 2 条已整理内容', { exact: true }).waitFor();

  // Navigate every operations page; no device or AI setting buttons are invoked.
  for (const title of ['运营总览', '设备管理', '告警与日志', 'AI 运营', '系统状态', '知识库']) {
    await page.locator('.ops-nav-group button', { hasText: title }).click();
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
    await page.locator('.ops-content .ant-skeleton').waitFor({ state: 'hidden' });
    await noOverflow(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ['知识条目', '资料来源', '问答测试']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await noOverflow(page);
  }
  await page.waitForFunction(() => !document.querySelector('.ant-message-notice'));
  await page.screenshot({ path: '.artifacts/operations-knowledge-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('[knowledge-ui] source upload / chapter import / duplicate protection / bulk review / publish / query / export / history / archive / navigation / mobile passed (isolated data, no hardware or paid calls)');
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: '.artifacts/knowledge-ui-failure.png', fullPage: true }).catch(() => {});
    console.error('[knowledge-ui] page state', await page.locator('body').innerText().catch(() => 'unavailable'));
    console.error('[knowledge-ui] buttons', await page.getByRole('button').allTextContents().catch(() => []));
  }
  console.error('[knowledge-ui] browser errors', errors);
  throw error;
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }
  await rm(dataDir, { recursive: true, force: true });
}

async function noOverflow(page) {
  const size = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(size.scroll <= size.viewport + 1, `页面溢出：${JSON.stringify(size)}`);
}
