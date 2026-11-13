#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile, chown } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const API_PLACEHOLDER = 'cloud-pilot-unpaired';
const MQTT_PLACEHOLDER = 'DX-MQTT-PILOT-001';

function onePlaceholderCredential(text, key, allowedId) {
  const value = parse(text)[key];
  if (!value) throw new Error(`${key} is missing`);
  let credentials;
  try { credentials = JSON.parse(value); }
  catch { throw new Error(`${key} is not valid JSON`); }
  if (!credentials || Array.isArray(credentials) || typeof credentials !== 'object' ||
      Object.keys(credentials).length !== 1 || !Object.hasOwn(credentials, allowedId) ||
      typeof credentials[allowedId] !== 'string') {
    throw new Error(`${key} is not the unpaired pilot placeholder; review existing devices manually`);
  }
}

function setEnvLine(text, key, value) {
  const expression = new RegExp(`^${key}=.*$`, 'gm');
  if ([...text.matchAll(expression)].length !== 1) throw new Error(`Expected exactly one ${key} line`);
  return text.replace(expression, `${key}='${JSON.stringify(value)}'`);
}

function setLiteralEnvLine(text, key, value) {
  const expression = new RegExp(`^${key}=.*$`, 'gm');
  if ([...text.matchAll(expression)].length !== 1) throw new Error(`Expected exactly one ${key} line`);
  return text.replace(expression, `${key}=${value}`);
}

async function readPrivateConfig(path) {
  const info = await lstat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0) {
    throw new Error(`${path} must be a regular private file (mode 0600)`);
  }
  return { text: await readFile(path, 'utf8'), uid: info.uid, gid: info.gid };
}

async function writePrivateTemp(path, contents, owner) {
  await writeFile(path, contents, { flag: 'wx', mode: 0o600 });
  const current = await lstat(path);
  if (current.uid !== owner.uid || current.gid !== owner.gid) {
    await chown(path, owner.uid, owner.gid);
  }
}

export async function provisionPublicPilot({ deviceId, model, secretOut, apiPath, mqttPath, backupDir }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(deviceId) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(model) ||
      [API_PLACEHOLDER, MQTT_PLACEHOLDER].includes(deviceId)) {
    throw new Error('Device ID or model has invalid characters');
  }
  if (!isAbsolute(secretOut) || [apiPath, mqttPath, backupDir].some((path) => secretOut === path || secretOut.startsWith(`${path}/`))) {
    throw new Error('Secret output must be an absolute private path outside runtime configuration and backups');
  }
  const [api, mqtt] = await Promise.all([readPrivateConfig(apiPath), readPrivateConfig(mqttPath)]);
  if (parse(api.text).DONGXIN_PILOT_JSON_MODE !== 'acknowledge-local-json-limits' ||
      parse(api.text).DEVICE_AUTH_BACKEND !== 'json' ||
      parse(mqtt.text).MQTT_DEVICE_AUTH_BACKEND !== 'json' ||
      parse(mqtt.text).MQTT_BROKER_MODE !== 'production') {
    throw new Error('This tool is only for the single-device JSON pilot');
  }
  onePlaceholderCredential(api.text, 'DEVICE_HTTP_CREDENTIALS', API_PLACEHOLDER);
  onePlaceholderCredential(mqtt.text, 'MQTT_DEVICE_CREDENTIALS', MQTT_PLACEHOLDER);

  const httpSecret = randomBytes(32).toString('hex');
  const mqttSecret = randomBytes(32).toString('hex');
  let newApi = setEnvLine(api.text, 'DEVICE_HTTP_CREDENTIALS', { [deviceId]: httpSecret });
  newApi = setLiteralEnvLine(newApi, 'OPS_CORS_ORIGINS', 'https://ops.zjdongxin.net');
  newApi = setLiteralEnvLine(newApi, 'VOICE_TASK_TIMEOUT_MS', '35000');
  newApi = setLiteralEnvLine(newApi, 'AI_STAGE_TIMEOUT_MS', '25000');
  const newMqtt = setEnvLine(mqtt.text, 'MQTT_DEVICE_CREDENTIALS', { [deviceId]: mqttSecret });
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '')}-${randomBytes(4).toString('hex')}`;
  const apiTemp = join(dirname(apiPath), `.api-public-pilot-${stamp}`);
  const mqttTemp = join(dirname(mqttPath), `.mqtt-public-pilot-${stamp}`);
  const apiBackup = join(backupDir, `api-before-public-pilot-${stamp}.env`);
  const mqttBackup = join(backupDir, `mqtt-before-public-pilot-${stamp}.env`);
  let wroteSecret = false;
  let switchedApi = false;
  let switchedMqtt = false;
  try {
    await writeFile(secretOut, `${JSON.stringify({ deviceId, model, httpSecret, mqttSecret })}\n`, { flag: 'wx', mode: 0o600 });
    wroteSecret = true;
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    const backupInfo = await lstat(backupDir);
    if (!backupInfo.isDirectory() || (backupInfo.mode & 0o077) !== 0 ||
        backupInfo.uid !== process.getuid?.()) {
      throw new Error('Backup directory must be private and owned by the invoking account (mode 0700)');
    }
    await writePrivateTemp(apiTemp, newApi, api);
    await writePrivateTemp(mqttTemp, newMqtt, mqtt);
    await writeFile(apiBackup, api.text, { flag: 'wx', mode: 0o600 });
    await writeFile(mqttBackup, mqtt.text, { flag: 'wx', mode: 0o600 });
    await rename(apiTemp, apiPath);
    switchedApi = true;
    await rename(mqttTemp, mqttPath);
    switchedMqtt = true;
    return { apiBackup, mqttBackup, secretOut, deviceId };
  } catch (error) {
    if (switchedApi && !switchedMqtt) {
      await writePrivateTemp(apiTemp, api.text, api);
      await rename(apiTemp, apiPath);
    }
    if (wroteSecret && !switchedMqtt) await unlink(secretOut).catch(() => {});
    throw error;
  } finally {
    await Promise.all([unlink(apiTemp).catch(() => {}), unlink(mqttTemp).catch(() => {})]);
  }
}

async function main(args) {
  if (process.getuid?.() !== 0 || args.length !== 6 || args[0] !== '--device-id' ||
      args[2] !== '--model' || args[4] !== '--secret-out') {
    throw new Error('Usage as root: provision-public-pilot.mjs --device-id ID --model MODEL --secret-out /root/private.json');
  }
  const result = await provisionPublicPilot({
    deviceId: args[1], model: args[3], secretOut: args[5],
    apiPath: '/etc/dongxin/api.env', mqttPath: '/etc/dongxin/mqtt.env',
    backupDir: '/var/backups/dongxin',
  });
  console.log(`Provisioned ${result.deviceId}. Private transfer file: ${result.secretOut}`);
  console.log(`Rollback copies: ${result.apiBackup} and ${result.mqttBackup}`);
  console.log('Neither service was restarted; transfer secrets securely before enabling public device access.');
}

if (process.argv[1] && await realpath(fileURLToPath(import.meta.url)) === await realpath(process.argv[1])) {
  await main(process.argv.slice(2));
}
