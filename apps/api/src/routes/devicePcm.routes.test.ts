import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEVICE_PCM_MAX_BYTES } from '../services/devicePcm.service.js';
import { createServer } from '../server.js';

test('device PCM endpoint rejects malformed audio before voice processing', async () => {
  const previousMqtt = process.env.MQTT_ENABLED;
  process.env.MQTT_ENABLED = 'false';
  const server = await createServer();
  try {
    const url = '/api/device/v1/voice-pcm?deviceId=DX-TEST';
    for (const [payload, expected] of [
      [Buffer.alloc(0), 422],
      [Buffer.alloc(3), 422],
      [Buffer.alloc(DEVICE_PCM_MAX_BYTES + 2), 413],
    ] as const) {
      const response = await server.inject({ method: 'POST', url,
        headers: { 'content-type': 'application/octet-stream' }, payload });
      assert.equal(response.statusCode, expected, response.body);
    }
    const wrongFormat = await server.inject({ method: 'POST',
      url: `${url}&sampleRate=48000`,
      headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(4) });
    assert.equal(wrongFormat.statusCode, 422, wrongFormat.body);
  } finally {
    await server.close();
    if (previousMqtt === undefined) delete process.env.MQTT_ENABLED;
    else process.env.MQTT_ENABLED = previousMqtt;
  }
});
