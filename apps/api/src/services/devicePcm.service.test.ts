import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEVICE_PCM_MAX_BYTES, wrapDevicePcmAsWav } from './devicePcm.service.js';

test('C3 PCM is wrapped without dropping samples or changing the declared format', () => {
  const pcm = Buffer.from([0, 0, 255, 127]);
  const wav = wrapDevicePcmAsWav(pcm);
  assert.equal(wav.length, 48);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(4), 40);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.deepEqual(wav.subarray(44), pcm);
});

test('empty, incomplete and overlong PCM are rejected before ASR', () => {
  for (const pcm of [Buffer.alloc(0), Buffer.alloc(3)]) {
    assert.throws(() => wrapDevicePcmAsWav(pcm), (error: unknown) =>
      (error as { statusCode?: number }).statusCode === 422);
  }
  assert.equal(wrapDevicePcmAsWav(Buffer.alloc(DEVICE_PCM_MAX_BYTES)).length,
    DEVICE_PCM_MAX_BYTES + 44);
  assert.throws(() => wrapDevicePcmAsWav(Buffer.alloc(DEVICE_PCM_MAX_BYTES + 2)),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 413);
});
