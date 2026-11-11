import { readFile } from 'node:fs/promises';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:8080/');
const credentialsPath = process.argv[3];
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
    base.pathname !== '/' || base.search || base.hash || base.username || base.password) {
  throw new Error('Only a loopback HTTP base URL is allowed');
}

async function get(path, token) {
  const response = await fetch(new URL(path, base), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

const health = await get('/api/health');
if (health.ok !== true) throw new Error('Health check did not report ok');

const auth = await get('/api/auth/status');
let token;
if (auth.mode === 'ENABLED') {
  if (!credentialsPath) throw new Error('Pass the local credentials file path as the second argument');
  const unauthenticated = await fetch(new URL('/api/operations/console', base), {
    signal: AbortSignal.timeout(8000),
  });
  if (unauthenticated.status !== 401) throw new Error('Operations API did not reject an unauthenticated request');
  const credentials = await readFile(credentialsPath, 'utf8');
  const password = credentials.match(/^Password: (.+)$/m)?.[1]?.trim();
  if (!password) throw new Error('Credentials file has no Password line');
  const response = await fetch(new URL('/api/auth/login', base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Login failed: HTTP ${response.status}`);
  token = (await response.json()).token;
  if (typeof token !== 'string' || !token) throw new Error('Login did not return a session token');
} else if (auth.mode !== 'DISABLED') {
  throw new Error(`Unknown auth mode: ${auth.mode}`);
}

const session = await get('/api/auth/session', token);
if (!session.user) throw new Error('Session has no user');
const sections = ['overview', 'devices', 'knowledge', 'ai', 'records', 'system'];
for (const section of sections) {
  const data = await get(`/api/operations/console?section=${section}`, token);
  if (!data.metrics || typeof data.metrics !== 'object') {
    throw new Error(`${section}: missing metrics`);
  }
}
const devices = await get('/api/operations/devices?page=1&pageSize=1', token);
if (!Array.isArray(devices.items) || typeof devices.total !== 'number') {
  throw new Error('Device list response is malformed');
}
const runtime = await get('/api/operations/runtime', token);
if (!runtime || typeof runtime !== 'object') throw new Error('Runtime response is malformed');
const aiServices = await get('/api/operations/ai-services', token);
if (!aiServices.defaults || !Array.isArray(aiServices.providers) || !Array.isArray(aiServices.secrets)) {
  throw new Error('AI service configuration response is malformed');
}
if (aiServices.providers.some((provider) => 'apiKey' in provider || 'requestBody' in provider)) {
  throw new Error('AI service configuration exposed provider credentials or adapter internals');
}
const voiceHistory = await get('/api/operations/voice-history?page=1&pageSize=1', token);
if (!Array.isArray(voiceHistory.items) || typeof voiceHistory.total !== 'number') {
  throw new Error('Voice history response is malformed');
}

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  target: base.origin,
  health: 'ok',
  auth: auth.mode,
  sectionsChecked: sections.length,
  deviceList: 'ok',
  runtime: 'ok',
  aiServices: 'ok',
  voiceHistory: 'ok',
}, null, 2));
