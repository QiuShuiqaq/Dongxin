import assert from 'node:assert/strict';
import test from 'node:test';
import { CiV1FrameProbe } from './ciSerial.ts';

test('recognizes a fragmented V1 frame and keeps its semantic ID', () => {
  const probe = new CiV1FrameProbe();
  assert.deepEqual(probe.feed(Buffer.from([0x00, 0xa5, 0xfa, 0x00])), []);
  assert.deepEqual(probe.feed(Buffer.from([0x81, 0x01, 0x00, 0x21, 0xfb])), [
    { hex: 'A5 FA 00 81 01 00 21 FB', command: 0x81, semanticId: 1 },
  ]);
});

test('rejects bad checksums and resynchronizes on the next valid frame', () => {
  const probe = new CiV1FrameProbe();
  const result = probe.feed(Buffer.from([
    0xa5, 0xfa, 0x00, 0x81, 0x01, 0x00, 0x22, 0xfb,
    0x13, 0xa5, 0xfa, 0x00, 0x81, 0x02, 0x00, 0x22, 0xfb,
  ]));
  assert.equal(result.length, 1);
  assert.equal(result[0]?.semanticId, 2);
});
