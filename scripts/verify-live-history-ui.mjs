import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
});
await mkdir('.artifacts', { recursive: true });
const errors = [];
const now = new Date().toISOString();
const history = [{
  id: 'history-fixture-1', deviceId: 'fixture-board', channel: 'llm-test',
  createdAt: now, updatedAt: now,
  turns: [
    { id: 'turn-1', at: now, text: '我叫小林', reply: '你好，小林。', route: 'LLM', error: null, latencyMs: 120, costCny: 0.001 },
    { id: 'turn-2', at: now, text: '我叫什么', reply: '你叫小林。', route: 'LLM', error: null, latencyMs: 100, costCny: 0.001 },
  ],
}];

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'zh-CN' });
    await context.route('**/api/**', (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === 'GET' && path === '/api/development/voice-history') return route.fulfill({ json: history });
      if (!['GET', 'OPTIONS'].includes(request.method())) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      HTMLMediaElement.prototype.play = function () { throw new Error('Unexpected playback'); };
    });
    await page.goto('http://127.0.0.1:3010/#voice', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '历史记录' }).click();
    await page.getByRole('dialog', { name: '历史记录' }).waitFor();
    await page.getByText('我叫什么', { exact: true }).first().waitFor();
    assert.equal(await page.locator('.voice-history-turn').count(), 2);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '历史记录' }).click();
    await page.getByRole('dialog', { name: '历史记录' }).waitFor();
    await page.locator('.voice-history-turn .assistant').filter({ hasText: '你叫小林。' }).waitFor();
    await assertNoOverflow(page, width, 'history');
    await page.screenshot({ path: `.artifacts/voice-history-${width}.png`, fullPage: true, animations: 'disabled' });

    await page.getByRole('dialog', { name: '历史记录' }).locator('button.ant-drawer-close').click();
    await page.getByRole('dialog', { name: '历史记录' }).waitFor({ state: 'hidden' });
    await page.locator('.nav-group button').filter({ hasText: '控制台' }).click();
    await page.getByRole('heading', { name: '测试事件' }).waitFor();
    await page.getByText(/每 5 秒轮询/).waitFor();
    await assertNoOverflow(page, width, 'console');
    await page.screenshot({ path: `.artifacts/live-console-${width}.png`, fullPage: true, animations: 'disabled' });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('History and live console UI passed at desktop and mobile widths; no device actions or playback were sent.');
} finally {
  await browser.close();
}

async function assertNoOverflow(page, width, label) {
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(dimensions.scroll <= dimensions.viewport + 1, `${label} at ${width}px overflows by ${dimensions.scroll - dimensions.viewport}px`);
}
