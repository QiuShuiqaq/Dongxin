import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
});
const failures = [];
await mkdir('.artifacts', { recursive: true });

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, locale: 'zh-CN' });
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('requestfailed', (request) => {
      if (request.failure()?.errorText !== 'net::ERR_ABORTED') failures.push(`${request.url()}: ${request.failure()?.errorText}`);
    });
    await page.goto('http://127.0.0.1:3020/lab.html#scenarios', { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '场景模拟', exact: true }).waitFor();
    await page.getByText('长按进入配网').waitFor();
    await page.getByRole('button', { name: '运行模拟' }).click();
    await page.getByText('未发送 MQTT').waitFor();
    await assertNoOverflow(page, viewport.width, failures, '场景模拟');
    await page.screenshot({ path: `.artifacts/lab-${viewport.width}-scenarios.png`, fullPage: true });

    await page.locator('.lab-sidebar nav button', { hasText: '对话验证' }).click();
    await page.getByLabel('单条测试语料').waitFor();
    if (await page.getByRole('button', { name: '运行验证' }).isEnabled()) failures.push('空语料可触发付费验证');
    await assertNoOverflow(page, viewport.width, failures, '对话验证');

    await page.locator('.lab-sidebar nav button', { hasText: '语音模块' }).click();
    await page.getByLabel('ASR 测试音频').waitFor();
    await page.getByLabel('TTS 合成文本').waitFor();
    await assertNoOverflow(page, viewport.width, failures, '语音模块');

    await page.locator('.lab-sidebar nav button', { hasText: '测试集' }).click();
    await page.getByRole('button', { name: '新建测试集' }).waitFor();
    await assertNoOverflow(page, viewport.width, failures, '测试集');
    await page.close();
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Cloud lab desktop/mobile smoke passed; no paid calls or device commands sent.');
}

async function assertNoOverflow(page, viewport, errors, section) {
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
  if (scroll > viewport + 1) errors.push(`${viewport}px ${section}: horizontal overflow ${scroll - viewport}px`);
}
