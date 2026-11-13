#!/usr/bin/env node
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../firmware/main/device_provisioning.h', import.meta.url));

export function cString(value) {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('Invalid C string value');
  return `"${[...Buffer.from(value, 'utf8')].map((byte) =>
    byte === 0x22 ? '\\"' : byte === 0x5c ? '\\\\' :
      byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : `\\${byte.toString(8).padStart(3, '0')}`
  ).join('')}"`;
}

export function deviceHeader(pilot, ssid, password, setupPassword, setupOnly = false) {
  if (!pilot || typeof pilot !== 'object' || Array.isArray(pilot) ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(pilot.deviceId) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(pilot.model) ||
      !/^[a-f0-9]{64}$/.test(pilot.httpSecret) ||
      !/^[a-f0-9]{64}$/.test(pilot.mqttSecret) ||
      pilot.httpSecret === pilot.mqttSecret) {
    throw new Error('Invalid or non-independent pilot credentials');
  }
  if (typeof ssid !== 'string' || typeof password !== 'string') throw new Error('Wi-Fi settings are missing');
  const ssidBytes = Buffer.byteLength(ssid, 'utf8');
  const passwordBytes = Buffer.byteLength(password, 'utf8');
  if ((setupOnly && (ssid !== '' || password !== '' || setupPassword === undefined)) ||
      (!setupOnly && ssidBytes < 1) || ssidBytes > 32 || ssid.includes('\0') ||
      password.includes('\0') ||
      (passwordBytes === 0 && !setupOnly && ssid !== 'TP-LINK_3DB722') ||
      !(passwordBytes === 0 || (passwordBytes >= 8 && passwordBytes <= 63))) {
    throw new Error('Invalid Wi-Fi SSID or WPA password length');
  }
  if (setupPassword !== undefined &&
      (typeof setupPassword !== 'string' || !/^[\x21-\x7e]{12,63}$/.test(setupPassword) ||
       setupPassword === password || setupPassword === pilot.httpSecret ||
       setupPassword === pilot.mqttSecret)) {
    throw new Error('Invalid or reused per-device Wi-Fi setup password');
  }
  return [
    '#ifndef DX_DEVICE_PROVISIONING_H',
    '#define DX_DEVICE_PROVISIONING_H',
    '/* Private, single-device cloud pilot values. Never commit this file. */',
    `#define DX_DEVICE_ID ${cString(pilot.deviceId)}`,
    `#define DX_DEVICE_MODEL ${cString(pilot.model)}`,
    `#define DX_WIFI_SSID ${cString(ssid)}`,
    `#define DX_WIFI_PASSWORD ${cString(password)}`,
    ...(setupPassword === undefined ? [] : [`#define DX_WIFI_SETUP_PASSWORD ${cString(setupPassword)}`]),
    '#define DX_GATEWAY_BASE_URL "https://api.zjdongxin.net"',
    '#define DX_MQTT_BROKER_URI "mqtts://api.zjdongxin.net:8883"',
    `#define DX_MQTT_DEVICE_SECRET ${cString(pilot.mqttSecret)}`,
    `#define DX_DEVICE_HTTP_SECRET ${cString(pilot.httpSecret)}`,
    '#endif',
    '',
  ].join('\n');
}

async function main(args) {
  const setupOnly = process.env.DX_PILOT_WIFI_SETUP_ONLY === '1';
  const openWifi = process.env.DX_PILOT_WIFI_OPEN === '1';
  const hasSsid = Object.hasOwn(process.env, 'DX_PILOT_WIFI_SSID');
  const hasPassword = Object.hasOwn(process.env, 'DX_PILOT_WIFI_PASSWORD');
  if (args.length !== 2 || args[0] !== '--secret-file' || !isAbsolute(args[1]) ||
      (process.env.DX_PILOT_WIFI_SETUP_ONLY !== undefined && !setupOnly) ||
      (setupOnly
        ? hasSsid || hasPassword || process.env.DX_PILOT_WIFI_OPEN !== undefined ||
          !Object.hasOwn(process.env, 'DX_PILOT_SETUP_PASSWORD')
        : !hasSsid || openWifi === hasPassword ||
          (process.env.DX_PILOT_WIFI_OPEN !== undefined && !openWifi))) {
    throw new Error('Usage: set DX_PILOT_WIFI_SETUP_ONLY=1 and DX_PILOT_SETUP_PASSWORD for first-time setup, or set DX_PILOT_WIFI_SSID and either DX_PILOT_WIFI_PASSWORD or DX_PILOT_WIFI_OPEN=1; then write-device-provisioning.mjs --secret-file ABSOLUTE_PRIVATE_JSON');
  }
  const info = await lstat(args[1]);
  if (!info.isFile() || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) {
    throw new Error('Pilot JSON must be a private regular file (mode 0600 on Linux)');
  }
  const pilot = JSON.parse(await readFile(args[1], 'utf8'));
  const header = deviceHeader(pilot, setupOnly ? '' : process.env.DX_PILOT_WIFI_SSID,
    setupOnly || openWifi ? '' : process.env.DX_PILOT_WIFI_PASSWORD,
    process.env.DX_PILOT_SETUP_PASSWORD, setupOnly);
  await writeFile(output, header, { flag: 'wx', mode: 0o600 });
  console.log('Created ignored firmware/main/device_provisioning.h; no credentials were printed.');
}

if (process.argv[1] && await realpath(fileURLToPath(import.meta.url)) === await realpath(process.argv[1])) {
  await main(process.argv.slice(2));
}
