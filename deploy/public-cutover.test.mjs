import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { renderPublicNginx } from './render-public-nginx.mjs';
import { provisionPublicPilot } from './provision-public-pilot.mjs';
import { cString, deviceHeader } from './write-device-provisioning.mjs';
import { loopbackLookup } from './verify-public-pilot.mjs';

test('HTTPS loopback lookup supports Node single-address and all-address callbacks', () => {
  loopbackLookup('api.zjdongxin.net', { all: false }, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, '127.0.0.1');
    assert.equal(family, 4);
  });
  loopbackLookup('api.zjdongxin.net', { all: true }, (error, addresses) => {
    assert.equal(error, null);
    assert.deepEqual(addresses, [{ address: '127.0.0.1', family: 4 }]);
  });
});

test('public Nginx rendering binds operations access to one verified IPv4', () => {
  const template = 'allow __DONGXIN_OFFICE_CIDR__;';
  assert.equal(renderPublicNginx(template, '115.230.134.188'), 'allow 115.230.134.188/32;');
  for (const address of ['0.0.0.0', '127.0.0.1', '192.168.1.2', '172.16.0.1', '100.64.1.1',
    '115.230.134.188/24', 'bad']) {
    assert.throws(() => renderPublicNginx(template, address));
  }
  assert.throws(() => renderPublicNginx('allow none;', '115.230.134.188'));
});

test('operations virtual host exposes only staff APIs and blocks legacy device control', async () => {
  const template = await readFile(new URL('./nginx-public.conf.template', import.meta.url), 'utf8');
  const operationsHost = template.split('server_name ops.zjdongxin.net;')[1]
    ?.split('server_name api.zjdongxin.net;')[0];
  assert.ok(operationsHost);
  for (const path of ['/api/operations/', '/api/knowledge/', '/api/providers/', '/api/test-sets/']) {
    assert.match(operationsHost, new RegExp(`location \\^~ ${path.replaceAll('/', '\\/')}`));
  }
  assert.match(operationsHost, /location \/api\/ \{\s*return 404;/);
  assert.doesNotMatch(operationsHost, /location \/api\/ \{\s*include/);
});

test('single pilot replaces only placeholders with independent private credentials',
  { skip: process.platform === 'win32' }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dongxin-public-pilot-'));
    try {
      const apiPath = join(directory, 'api.env');
      const mqttPath = join(directory, 'mqtt.env');
      const backupDir = join(directory, 'backups');
      const secretOut = join(directory, 'device-private.json');
      const apiOriginal = 'DONGXIN_PILOT_JSON_MODE=acknowledge-local-json-limits\nDEVICE_AUTH_BACKEND=json\nDEVICE_HTTP_CREDENTIALS={"cloud-pilot-unpaired":"placeholder-long-enough"}\nOPS_CORS_ORIGINS=http://127.0.0.1:8080\nVOICE_TASK_TIMEOUT_MS=10000\nAI_STAGE_TIMEOUT_MS=10000\n';
      const mqttOriginal = 'MQTT_BROKER_MODE=production\nMQTT_DEVICE_AUTH_BACKEND=json\nMQTT_DEVICE_CREDENTIALS={"DX-MQTT-PILOT-001":"placeholder-long-enough"}\n';
      await writeFile(apiPath, apiOriginal, { mode: 0o600 });
      await writeFile(mqttPath, mqttOriginal, { mode: 0o600 });
      const result = await provisionPublicPilot({
        deviceId: 'DX-PILOT-001', model: 'DX-AI-BATH-C3-LICHUANG-AUDIO',
        secretOut, apiPath, mqttPath, backupDir,
      });
      const output = JSON.parse(await readFile(secretOut, 'utf8'));
      assert.match(output.httpSecret, /^[a-f0-9]{64}$/);
      assert.match(output.mqttSecret, /^[a-f0-9]{64}$/);
      assert.notEqual(output.httpSecret, output.mqttSecret);
      const nextApi = parse(await readFile(apiPath, 'utf8'));
      assert.deepEqual(JSON.parse(nextApi.DEVICE_HTTP_CREDENTIALS), {
        'DX-PILOT-001': output.httpSecret,
      });
      assert.equal(nextApi.OPS_CORS_ORIGINS, 'https://ops.zjdongxin.net');
      assert.equal(nextApi.VOICE_TASK_TIMEOUT_MS, '35000');
      assert.equal(nextApi.AI_STAGE_TIMEOUT_MS, '25000');
      assert.deepEqual(JSON.parse(parse(await readFile(mqttPath, 'utf8')).MQTT_DEVICE_CREDENTIALS), {
        'DX-PILOT-001': output.mqttSecret,
      });
      assert.equal(await readFile(result.apiBackup, 'utf8'), apiOriginal);
      assert.equal(await readFile(result.mqttBackup, 'utf8'), mqttOriginal);
      assert.equal((await stat(secretOut)).mode & 0o077, 0);
      await assert.rejects(() => provisionPublicPilot({
        deviceId: 'DX-PILOT-002', model: 'DX-AI-BATH-C3-LICHUANG-AUDIO',
        secretOut: join(directory, 'other-private.json'), apiPath, mqttPath, backupDir,
      }), /not the unpaired pilot placeholder/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

test('release preparation checks the API listener independently of the retired loopback Nginx port', async () => {
  const script = await readFile(new URL('./prepare-release.sh', import.meta.url), 'utf8');
  assert.match(script, /curl --fail --silent --max-time 10 http:\/\/127\.0\.0\.1:3077\/api\/health/);
  assert.doesNotMatch(script, /127\.0\.0\.1:8080\/api\/health/);
});

test('deploy CLIs run through a current-release directory symlink',
  { skip: process.platform === 'win32' }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dongxin-release-link-'));
    try {
      const linkedRelease = join(directory, 'current');
      await symlink(fileURLToPath(new URL('../', import.meta.url)), linkedRelease, 'dir');
      const linkedDeploy = join(linkedRelease, 'deploy');

      const output = join(directory, 'candidate.conf');
      const rendered = spawnSync(process.execPath, [join(linkedDeploy, 'render-public-nginx.mjs'),
        '--office-ip', '115.230.134.188', '--output', output], { encoding: 'utf8' });
      assert.equal(rendered.status, 0, rendered.stderr);
      assert.match(await readFile(output, 'utf8'), /allow 115\.230\.134\.188\/32;/);

      for (const script of ['provision-public-pilot.mjs', 'write-device-provisioning.mjs']) {
        const invoked = spawnSync(process.execPath, [join(linkedDeploy, script)], { encoding: 'utf8' });
        assert.notEqual(invoked.status, 0, `${script} silently skipped its CLI entry point`);
        assert.match(invoked.stderr, /Usage(?: as root)?:/);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

test('private firmware header escapes Wi-Fi values and keeps independent TLS credentials', () => {
  const pilot = {
    deviceId: 'DX-PILOT-001', model: 'DX-AI-BATH-C3-LICHUANG-AUDIO',
    httpSecret: 'a'.repeat(64), mqttSecret: 'b'.repeat(64),
  };
  const header = deviceHeader(pilot, 'Dongxin "test"', 'safe\\pass123');
  assert.match(header, /#define DX_WIFI_SSID "Dongxin \\"test\\""/);
  assert.match(header, /#define DX_WIFI_PASSWORD "safe\\\\pass123"/);
  assert.match(header, /#define DX_DEVICE_HTTP_SECRET "a{64}"/);
  assert.match(header, /#define DX_MQTT_DEVICE_SECRET "b{64}"/);
  assert.equal(cString('浴霸'), '"\\346\\265\\264\\351\\234\\270"');
  assert.throws(() => deviceHeader(pilot, '', ''), /Invalid Wi-Fi/);
  assert.throws(() => deviceHeader(pilot, 'ssid', 'short'), /Invalid Wi-Fi/);
  assert.throws(() => deviceHeader(pilot, 'unknown-open-network', ''), /Invalid Wi-Fi/);
  assert.match(deviceHeader(pilot, 'TP-LINK_3DB722', ''), /#define DX_WIFI_PASSWORD ""/);
  assert.throws(() => deviceHeader({ ...pilot, mqttSecret: pilot.httpSecret }, 'ssid', ''), /non-independent/);
  assert.match(deviceHeader(pilot, 'ssid', 'wifi-pass123', 'unique-setup-123'),
    /#define DX_WIFI_SETUP_PASSWORD "unique-setup-123"/);
  const setupOnly = deviceHeader(pilot, '', '', 'unique-setup-123', true);
  assert.match(setupOnly, /#define DX_WIFI_SSID ""/);
  assert.match(setupOnly, /#define DX_WIFI_PASSWORD ""/);
  assert.match(setupOnly, /#define DX_WIFI_SETUP_PASSWORD "unique-setup-123"/);
  assert.throws(() => deviceHeader(pilot, '', '', undefined, true), /Invalid Wi-Fi/);
  assert.throws(() => deviceHeader(pilot, 'ssid', 'wifi-pass123', 'unique-setup-123', true), /Invalid Wi-Fi/);
  assert.throws(() => deviceHeader(pilot, 'ssid', 'a'.repeat(64)), /Invalid Wi-Fi/);
  assert.throws(() => deviceHeader(pilot, 'ssid', 'wifi-pass123', 'wifi-pass123'), /reused/);
  assert.throws(() => deviceHeader(pilot, 'ssid', 'wifi-pass123', 'short'), /setup password/);
});
