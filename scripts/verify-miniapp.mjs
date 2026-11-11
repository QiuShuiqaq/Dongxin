import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const api = require('../apps/miniapp/utils/api.js');
const config = { apiBaseUrl: '', deviceId: 'test-device' };
globalThis.getApp = () => ({ globalData: config });

test('missing API URL fails without a simulated response', async () => {
  let called = false;
  globalThis.wx = { request: () => { called = true; } };
  await assert.rejects(api.getDeviceOverview(), /API 地址/);
  assert.equal(called, false);
});

test('network and HTTP errors are returned to the caller', async () => {
  config.apiBaseUrl = 'https://api.example.test';
  globalThis.wx = { request: ({ fail }) => fail({ errMsg: 'network unavailable' }) };
  await assert.rejects(api.sendDeviceCommand('LIGHT_ON'), /network unavailable/);

  globalThis.wx = {
    request: ({ success }) => success({ statusCode: 503, data: { error: { message: 'service unavailable' } } })
  };
  await assert.rejects(api.queryKnowledge('如何清洁'), /service unavailable/);
});

test('device overview requests only device profile and state', async () => {
  const paths = [];
  globalThis.wx = {
    request: ({ url, success }) => {
      paths.push(new URL(url).pathname);
      success({ statusCode: 200, data: url.endsWith('/state') ? { isOnline: true } : { id: 'test-device' } });
    }
  };
  const overview = await api.getDeviceOverview();
  assert.deepEqual(paths, ['/api/devices/test-device', '/api/devices/test-device/state']);
  assert.equal(overview.device.id, 'test-device');
  assert.equal(overview.state.isOnline, true);
});

test('queued command remains queued and is not reported as applied', async () => {
  globalThis.wx = {
    request: ({ success }) => success({
      statusCode: 200,
      data: { command: { status: 'QUEUED' }, delivery: 'QUEUED_FOR_DEVICE' }
    })
  };
  const result = await api.sendDeviceCommand('LIGHT_ON');
  assert.equal(result.command.status, 'QUEUED');
  assert.equal(result.delivery, 'QUEUED_FOR_DEVICE');
});
