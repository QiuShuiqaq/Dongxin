import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicErrorBody } from './apiError.js';

test('unexpected server errors never return internal exception details', () => {
  const secret = 'provider-secret-and-internal-path';
  const body = publicErrorBody(500, 'INTERNAL_ERROR', secret);
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  assert.equal(body.error.message, '服务暂时不可用，请稍后重试');
  assert.equal(JSON.stringify(body).includes(secret), false);
});

test('safe client errors preserve their actionable message', () => {
  assert.equal(publicErrorBody(422, 'VALIDATION_ERROR', '参数不正确').error.message, '参数不正确');
});
