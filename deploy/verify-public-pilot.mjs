#!/usr/bin/env node
// Read-only loopback probes of the public TLS virtual host and one MQTT identity.
import { timingSafeEqual } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { request } from 'node:https';
import { isAbsolute } from 'node:path';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mqtt from 'mqtt';

const DEVICE_HOST = 'api.zjdongxin.net';

export function loopbackLookup(_hostname, options, callback) {
  if (options.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
  else callback(null, '127.0.0.1', 4);
}

function httpsProbe(path, deviceId, secret) {
  return new Promise((resolve, reject) => {
    const headers = secret ? { 'X-Device-Id': deviceId, Authorization: `Bearer ${secret}` } : {};
    const req = request({
      hostname: DEVICE_HOST, port: 443, path, method: 'GET', headers,
      lookup: loopbackLookup,
      timeout: 5000,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 65536) response.destroy(new Error('HTTPS probe response is too large'));
      });
      response.on('error', reject);
      response.on('end', () => {
        let errorCode;
        try { errorCode = JSON.parse(body).error?.code; } catch { /* Nginx 404 is not JSON. */ }
        resolve({ status: response.statusCode, errorCode });
      });
    });
    req.on('timeout', () => req.destroy(new Error('HTTPS probe timed out')));
    req.on('error', reject);
    req.end();
  });
}

function connectMqtt(deviceId, secret) {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect('mqtts://127.0.0.1:8883', {
      clientId: deviceId, username: deviceId, password: secret,
      servername: DEVICE_HOST, rejectUnauthorized: true,
      reconnectPeriod: 0, connectTimeout: 5000,
    });
    client.once('connect', () => resolve(client));
    client.once('error', (error) => { client.end(true); reject(error); });
    client.once('close', () => reject(new Error('MQTT connection closed before authentication')));
  });
}

async function expectMqttAuthRejection(deviceId, secret) {
  try {
    const client = await connectMqtt(deviceId, secret);
    client.end(true);
    throw new Error('MQTT accepted an unprovisioned identity or wrong password');
  } catch (error) {
    if (error.message === 'MQTT accepted an unprovisioned identity or wrong password') throw error;
    if (![4, 5, 134, 135].includes(error.code) &&
        !/connection refused: (bad username or password|not authorized)/i.test(error.message)) {
      throw new Error(`MQTT negative probe failed for a reason other than authentication: ${error.message}`);
    }
  }
}

function subscribe(client, topic) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000);
    client.subscribe(topic, { qos: 1 }, (error, granted) => {
      clearTimeout(timer);
      resolve(!error && granted?.length === 1 && granted[0].qos === 1);
    });
  });
}

async function main(args) {
  if (args.length !== 2 || args[0] !== '--secret-file' || !isAbsolute(args[1])) {
    throw new Error('Usage: verify-public-pilot.mjs --secret-file /root/private.json');
  }
  const info = await lstat(args[1]);
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error('Secret file must be private (mode 0600)');
  const { deviceId, httpSecret, mqttSecret } = JSON.parse(await readFile(args[1], 'utf8'));
  if (typeof deviceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(deviceId) ||
      !/^[a-f0-9]{64}$/.test(httpSecret) ||
      !/^[a-f0-9]{64}$/.test(mqttSecret) ||
      timingSafeEqual(Buffer.from(httpSecret, 'hex'), Buffer.from(mqttSecret, 'hex'))) {
    throw new Error('Invalid or non-independent pilot credentials');
  }
  const path = `/api/device/v1/config?deviceId=${encodeURIComponent(deviceId)}`;
  if ((await httpsProbe(path, deviceId)).status !== 401) throw new Error('Device HTTPS allowed an unauthenticated request');
  if ((await httpsProbe(path, deviceId, `${httpSecret}wrong`)).status !== 401) throw new Error('Device HTTPS allowed a wrong password');
  if ((await httpsProbe(path, 'NOT-PROVISIONED', httpSecret)).status !== 401) throw new Error('Device HTTPS allowed an unknown identity');
  const valid = await httpsProbe(path, deviceId, httpSecret);
  if (valid.status === 200) {
    throw new Error('Device is already registered; this pre-flash MQTT probe could disconnect a live device');
  }
  if (valid.status !== 404 || valid.errorCode !== 'DEVICE_NOT_FOUND') {
    throw new Error(`Device HTTPS rejected the provisioned identity: HTTP ${valid.status} ${valid.errorCode ?? ''}`);
  }
  if ((await httpsProbe('/', deviceId, httpSecret)).status !== 404) throw new Error('Device hostname exposed a non-device route');

  await expectMqttAuthRejection('NOT-PROVISIONED', mqttSecret);
  await expectMqttAuthRejection(deviceId, `${mqttSecret}wrong`);
  const client = await connectMqtt(deviceId, mqttSecret);
  try {
    if (!await subscribe(client, `dongxin/v1/devices/${deviceId}/down/command`)) {
      throw new Error('MQTT rejected own downlink subscription');
    }
    if (await subscribe(client, 'dongxin/v1/devices/OTHER-DEVICE/down/command')) {
      throw new Error('MQTT allowed cross-device subscription');
    }
  } finally {
    await new Promise((resolve) => client.end(true, {}, resolve));
  }
  console.log(`Pre-flash public pilot TLS, device authentication and MQTT topic isolation passed for ${deviceId}.`);
}

if (process.argv[1] && await realpath(fileURLToPath(import.meta.url)) === await realpath(process.argv[1])) {
  await main(process.argv.slice(2));
}
