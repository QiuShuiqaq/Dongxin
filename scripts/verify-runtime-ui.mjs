import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Serve the built console and intercept every API request. This check cannot
// contact the live API, MQTT broker, hardware agent or a paid AI provider.
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'apps/operations-console/dist');
const artifact = resolve(root, '.artifacts');
const queue = (concurrency, maxWaiting) => ({ active: 1, waiting: 2, completed: 8, failed: 1, rejected: 2, expired: 1, cancelled: 1, limits: { concurrency, maxWaiting, maxWaitMs: 2000 } });
const fixture = {
  environment: 'LOCAL_PREPRODUCTION', devices: [], recentCommands: [], recentEvents: [], alerts: [], auditLogs: [], products: [], knowledgeDocuments: [], providers: [],
  knowledgeStats: { published: 0, review: 0, drafts: 0, archived: 0 }, logCount: 0, proactiveSettings: {},
  metrics: { totalDevices: 0, onlineDevices: 0, faultDevices: 0, openAlerts: 0, completedCommands: 0, commandSuccessRate: 0 },
  productionReadiness: { database: 'LOCAL_JSON', mqtt: 'LOCAL', authentication: 'DISABLED', deployment: 'LOCAL' },
  mqtt: { enabled: true, connected: false, brokerUrl: 'mqtt://fixture.invalid', upstream: queue(4, 256), replay: { reused: 7 } },
  runtime: {
    at: new Date().toISOString(), mode: 'SINGLE_PROCESS', storage: { voiceHistory: 'postgres' }, voice: queue(8, 24), stages: { ASR: queue(4, 16), LLM: queue(4, 16), TTS: queue(4, 16) },
    usage: { date: '2026-10-28', ASR: 12, LLM: 5, TTS: 9, failed: 1, estimatedCostCny: 0.0234, budgetCny: 0, dailyLimits: { ASR: 0, LLM: 0, TTS: 0 } },
    ttsCache: { entries: 2, bytes: 100000, maxBytes: 8388608, hits: 3 }, requestReplay: { entries: 2, bytes: 1000, reused: 4, ttlMs: 60000 },
    retention: { lastRunAt: null, removedRecords: 0, error: null, policy: { textDays: 90, historySessions: 1000, historyTurns: 200, testSessions: 100, testTurns: 100, events: 500, commands: 500, logs: 1000 } },
  },
};
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  const target = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!target.startsWith(`${dist}${sep}`)) { res.writeHead(403).end(); return; }
  try {
    const content = await readFile(target);
    res.writeHead(200, { 'Content-Type': mime[extname(target)] ?? 'application/octet-stream' }).end(content);
  } catch { res.writeHead(404).end(); }
});
let browser;
try {
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
  await mkdir(artifact, { recursive: true });
  for (const [name, width, height] of [['desktop', 1440, 1080], ['mobile', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, locale: 'zh-CN' });
    const errors = [];
    let systemRequests = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } }); return; }
      const path = new URL(req.url()).pathname;
      let json;
      if (req.method() === 'GET' && path === '/api/auth/session') json = { mode: 'DISABLED', user: { username: 'local-development', displayName: '界面验证', role: 'ADMIN' } };
      else if (req.method() === 'GET' && path === '/api/operations/console') { systemRequests++; json = fixture; }
      else { errors.push(`Unexpected API request: ${req.method()} ${path}`); await route.abort(); return; }
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(json) });
    });
    await page.goto(`http://127.0.0.1:${port}/#system`, { waitUntil: 'networkidle' });
    const panel = page.getByRole('region', { name: '语音调度与调用量' });
    await panel.getByRole('heading', { name: '语音调度与调用量' }).waitFor();
    assert.equal(await panel.locator('tbody tr.ant-table-row').count(), 5, 'voice, three AI stages and MQTT must appear');
    assert.ok((await panel.innerText()).includes('¥0.0234'));
    const retention = page.getByRole('region', { name: '缓存与数据保留' });
    assert.ok((await retention.innerText()).includes('90 天'));
    fixture.runtime.retention.error = '运行数据维护失败，请检查服务器日志';
    await page.getByRole('button', { name: '刷新' }).click();
    await retention.getByRole('alert').waitFor();
    assert.ok(systemRequests >= 2, 'refresh must refetch runtime data');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 2, `${name} page overflow: ${overflow}px`);
    assert.deepEqual(errors, [], 'no browser errors or unexpected API calls');
    await page.screenshot({ path: resolve(artifact, `runtime-status-${name}.png`), fullPage: true });
    fixture.runtime.retention.error = null;
    await page.close();
    console.log(`[runtime-ui] ${name}: panel, refresh, maintenance error and page width passed (fixture data)`);
  }
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
