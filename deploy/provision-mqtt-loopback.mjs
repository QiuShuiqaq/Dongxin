#!/usr/bin/env node
// Run as root after activating the release. This prepares only a loopback pilot.
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chownSync, chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync,
  renameSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from 'dotenv';

if (process.getuid?.() !== 0) throw new Error('Run as root');

const apiPath = '/etc/dongxin/api.env';
const mqttPath = '/etc/dongxin/mqtt.env';
const certDir = '/etc/dongxin/mqtt';
const servicePath = '/etc/systemd/system/dongxin-mqtt.service';
const serviceSource = new URL('./dongxin-mqtt.service', import.meta.url);
const apiText = readFileSync(apiPath, 'utf8');
const api = parse(apiText);
if (api.MQTT_ENABLED !== 'false') throw new Error('Expected MQTT_ENABLED=false before provisioning');
if (existsSync(mqttPath) || existsSync(certDir) || existsSync(servicePath)) {
  throw new Error('MQTT pilot configuration already exists; inspect it before changing anything');
}
for (const key of ['MQTT_ENABLED', 'MQTT_URL', 'MQTT_CA_FILE', 'MQTT_TLS_SERVERNAME',
  'MQTT_GATEWAY_USERNAME', 'MQTT_GATEWAY_PASSWORD']) {
  if ((apiText.match(new RegExp(`^${key}=`, 'gm')) || []).length > 1) {
    throw new Error(`Duplicate ${key} in API environment`);
  }
}

const serviceUser = spawnSync('id', ['-u', 'dongxin'], { encoding: 'utf8' });
const serviceGroup = spawnSync('id', ['-g', 'dongxin'], { encoding: 'utf8' });
if (serviceUser.status !== 0 || serviceGroup.status !== 0) throw new Error('Missing dongxin service account');
const uid = Number(serviceUser.stdout.trim());
const gid = Number(serviceGroup.stdout.trim());
const backupDir = '/var/backups/dongxin';
mkdirSync(backupDir, { recursive: true, mode: 0o700 });
const backup = join(backupDir, `api-before-mqtt-${new Date().toISOString().replace(/[:.]/g, '')}.env`);
copyFileSync(apiPath, backup);
chmodSync(backup, 0o600);

mkdirSync(certDir, { mode: 0o700 });
const certPath = join(certDir, 'fullchain.pem');
const keyPath = join(certDir, 'privkey.pem');
const cert = spawnSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:3072', '-sha256', '-nodes', '-days', '30',
  '-subj', '/CN=api.zjdongxin.net', '-addext', 'subjectAltName=DNS:api.zjdongxin.net',
  '-addext', 'extendedKeyUsage=serverAuth', '-keyout', keyPath, '-out', certPath,
], { stdio: 'ignore' });
if (cert.status !== 0) throw new Error('OpenSSL failed to generate the loopback certificate');
copyFileSync(certPath, join(certDir, 'ca.pem'));
for (const file of [certPath, keyPath, join(certDir, 'ca.pem')]) {
  chownSync(file, uid, gid);
  chmodSync(file, 0o600);
}
chownSync(certDir, uid, gid);

const gatewayPassword = randomBytes(32).toString('hex');
const deviceSecret = randomBytes(32).toString('hex');
const mqttText = [
  'NODE_ENV=production',
  'MQTT_BROKER_MODE=production',
  'MQTT_HOST=127.0.0.1',
  'MQTT_PORT=8883',
  'MQTT_DEVICE_AUTH_BACKEND=json',
  'MQTT_GATEWAY_USERNAME=gateway',
  `MQTT_GATEWAY_PASSWORD=${gatewayPassword}`,
  `MQTT_DEVICE_CREDENTIALS='${JSON.stringify({ 'DX-MQTT-PILOT-001': deviceSecret })}'`,
  `MQTT_TLS_CERT_FILE=${certPath}`,
  `MQTT_TLS_KEY_FILE=${keyPath}`,
  '',
].join('\n');
writeFileSync(mqttPath, mqttText, { flag: 'wx', mode: 0o600 });
chownSync(mqttPath, uid, gid);

const updates = {
  MQTT_ENABLED: 'true',
  MQTT_URL: 'mqtts://127.0.0.1:8883',
  MQTT_CA_FILE: join(certDir, 'ca.pem'),
  MQTT_TLS_SERVERNAME: 'api.zjdongxin.net',
  MQTT_GATEWAY_USERNAME: 'gateway',
  MQTT_GATEWAY_PASSWORD: gatewayPassword,
};
let nextApi = apiText;
for (const [key, value] of Object.entries(updates)) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  nextApi = pattern.test(nextApi) ? nextApi.replace(pattern, line) : `${nextApi.trimEnd()}\n${line}\n`;
}
const previous = statSync(apiPath);
const temporary = join(dirname(apiPath), `.api.env.mqtt-${process.pid}`);
writeFileSync(temporary, nextApi, { flag: 'wx', mode: 0o600 });
chownSync(temporary, previous.uid, previous.gid);
renameSync(temporary, apiPath);

copyFileSync(serviceSource, servicePath);
chmodSync(servicePath, 0o644);
console.log(`Loopback MQTT configuration prepared. API backup: ${backup}`);
console.log('Next: systemctl daemon-reload; start broker; verify 127.0.0.1:8883; restart API.');
