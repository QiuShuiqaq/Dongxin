import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FRAME_LENGTH = 32;
const FRAME_MASK = FRAME_LENGTH - 1;
const RX_HEAD_HIGH = 0x02;
const RX_HEAD_LOW = 0xcf;
const PRODUCT_TYPE = 0x07;
const RX_END_HIGH = 0x0f;
const RX_END_LOW = 0x04;

function createFrame(command, value, beepCount = 0) {
  const frame = new Uint8Array(FRAME_LENGTH);
  frame[0] = RX_HEAD_HIGH;
  frame[1] = RX_HEAD_LOW;
  frame[2] = PRODUCT_TYPE;
  frame[3] = command;
  frame[4] = value;
  frame[5] = beepCount;
  frame[30] = RX_END_HIGH;
  frame[31] = RX_END_LOW;

  for (let index = 2; index < 29; index += 1) {
    frame[29] ^= frame[index];
  }

  return frame;
}

function placeInRing(frame, start) {
  const ring = new Uint8Array(FRAME_LENGTH);
  for (let index = 0; index < FRAME_LENGTH; index += 1) {
    ring[(start + index) & FRAME_MASK] = frame[index];
  }
  return ring;
}

function parseRing(ring) {
  let start = -1;
  for (let index = 0; index < FRAME_LENGTH; index += 1) {
    if (
      ring[index] === RX_HEAD_HIGH &&
      ring[(index + 1) & FRAME_MASK] === RX_HEAD_LOW
    ) {
      start = index;
      break;
    }
  }

  if (start < 0) return null;

  const frame = Uint8Array.from(
    { length: FRAME_LENGTH },
    (_, index) => ring[(start + index) & FRAME_MASK],
  );
  if (
    frame[2] !== PRODUCT_TYPE ||
    frame[30] !== RX_END_HIGH ||
    frame[31] !== RX_END_LOW
  ) {
    return null;
  }

  let checksum = 0;
  for (let index = 2; index < 29; index += 1) checksum ^= frame[index];
  if (checksum !== frame[29]) return null;

  return { command: frame[3], value: frame[4], beepCount: frame[5] };
}

const strongHeatFrame = createFrame(0x04, 0x02, 1);
for (let start = 0; start < FRAME_LENGTH; start += 1) {
  assert.deepEqual(parseRing(placeInRing(strongHeatFrame, start)), {
    command: 0x04,
    value: 0x02,
    beepCount: 1,
  });
}

const badChecksum = strongHeatFrame.slice();
badChecksum[29] ^= 0xff;
assert.equal(parseRing(placeInRing(badChecksum, 31)), null);

const badTail = strongHeatFrame.slice();
badTail[31] = 0;
assert.equal(parseRing(placeInRing(badTail, 31)), null);
assert.equal(parseRing(new Uint8Array(FRAME_LENGTH)), null);

const sourcePath = fileURLToPath(
  new URL("../stm32-firmware/axent-controller/USER/BLE_COMM.C", import.meta.url),
);
const source = readFileSync(sourcePath, "utf8");
assert.equal((source.match(/reg\[\(n\+1\)&0x1f\]/g) ?? []).length, 3);
assert.equal(source.includes("reg[n+1]"), false);
assert.match(source, /void Check_RS485_Uart3[\s\S]*Res3\[i\] = 0x00;[\s\S]*Pro_Control\(3,/);
assert.equal((source.match(/volatile uint8_t Res[123]\[32\]/g) ?? []).length, 3);
assert.equal((source.match(/volatile uint8_t rec[123]_[nF]/g) ?? []).length, 6);

console.log("STM32 protocol checks passed: 32 ring offsets and source invariants.");
