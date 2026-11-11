#!/usr/bin/env node
// Run as the dongxin account on the ECS; never print credentials.
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import mqtt from 'mqtt';

const env = parse(readFileSync('/etc/dongxin/mqtt.env', 'utf8'));
const credentials = JSON.parse(env.MQTT_DEVICE_CREDENTIALS || '{}');
const deviceId = 'DX-MQTT-PILOT-001';
const secret = credentials[deviceId];
if (!secret || env.MQTT_HOST !== '127.0.0.1' || env.MQTT_PORT !== '8883') {
  throw new Error('Loopback pilot configuration is missing or not loopback-only');
}

function makeClient(password) {
  return mqtt.connect('mqtts://127.0.0.1:8883', {
    clientId: deviceId,
    username: deviceId,
    password,
    ca: readFileSync('/etc/dongxin/mqtt/ca.pem'),
    servername: 'api.zjdongxin.net',
    rejectUnauthorized: true,
    reconnectPeriod: 0,
    connectTimeout: 3000,
  });
}

function connect(client) {
  return new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('error', reject);
  });
}

function subscribe(client, topic) {
  return new Promise((resolve) => {
    client.subscribe(topic, { qos: 1 }, (error, granted) => {
      resolve(!error && granted?.length === 1 && granted[0].qos === 1);
    });
  });
}

const valid = makeClient(secret);
try {
  await connect(valid);
  if (!await subscribe(valid, `dongxin/v1/devices/${deviceId}/down/command`)) {
    throw new Error('Own downlink subscription was rejected');
  }
  if (await subscribe(valid, 'dongxin/v1/devices/OTHER-DEVICE/down/command')) {
    throw new Error('Cross-device subscription was accepted');
  }
} finally {
  valid.end(true);
}

const invalid = makeClient(`${secret}bad`);
try {
  await connect(invalid);
  throw new Error('Wrong password was accepted');
} catch (error) {
  if (!/connection refused|bad username|not authorized/i.test(String(error))) throw error;
} finally {
  invalid.end(true);
}

console.log('MQTTS loopback: TLS, own-topic ACL and wrong-password rejection passed');
