import assert from "node:assert/strict";
import { test } from "node:test";
import { convertWavToPcm16Mono } from "./deviceAudioAsset.service.js";

function pcmWav(samples: number[]): Buffer {
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) => wav.writeInt16LE(sample, 44 + index * 2));
  return wav;
}

test("converts a standard PCM WAV", () => {
  const pcm = convertWavToPcm16Mono(pcmWav([1000, -1000]), 16000, 1);
  assert.equal(pcm.readInt16LE(640 * 2), 1000);
  assert.equal(pcm.readInt16LE(641 * 2), -1000);
});

test("accepts DashScope's streaming WAV length placeholders", () => {
  const wav = pcmWav([1000, -1000]);
  wav.writeUInt32LE(2147483583, 4);
  wav.writeUInt32LE(2147483547, 40);
  const pcm = convertWavToPcm16Mono(wav, 16000, 1);
  assert.equal(pcm.readInt16LE(640 * 2), 1000);
  assert.equal(pcm.readInt16LE(641 * 2), -1000);
});

test("rejects truncated finite-length WAV data", () => {
  const wav = pcmWav([1000, -1000]);
  wav.writeUInt32LE(6, 40);
  assert.throws(() => convertWavToPcm16Mono(wav, 16000, 1), /数据块不完整/);
});

test("rejects an incomplete streaming PCM frame", () => {
  const wav = pcmWav([1000, -1000]).subarray(0, 47);
  wav.writeUInt32LE(2147483583, 4);
  wav.writeUInt32LE(2147483547, 40);
  assert.throws(() => convertWavToPcm16Mono(wav, 16000, 1), /数据块不完整/);
});
