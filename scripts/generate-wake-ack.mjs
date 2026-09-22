import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const env = parseEnv(await readFile(resolve(projectRoot, "apps/api/.env"), "utf8"));
const apiKey = env.DASHSCOPE_API_KEY;
if (!apiKey) throw new Error("DASHSCOPE_API_KEY is not configured");

const response = await fetch(
  "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "cosyvoice-v3-flash",
      input: { text: "我在", voice: "longxiaochun_v3", format: "wav" },
    }),
  },
);
if (!response.ok) throw new Error(`TTS request failed: HTTP ${response.status}`);
const payload = await response.json();
const audioData = payload?.output?.audio?.data;
const audioUrl = payload?.output?.audio?.url;
let wav;
if (typeof audioData === "string" && audioData.length > 0) {
  wav = Buffer.from(audioData, "base64");
} else if (typeof audioUrl === "string" && audioUrl.length > 0) {
  const audioResponse = await fetch(audioUrl);
  if (!audioResponse.ok) throw new Error(`TTS audio download failed: HTTP ${audioResponse.status}`);
  wav = Buffer.from(await audioResponse.arrayBuffer());
} else {
  throw new Error("TTS response did not contain audio data");
}

const decoded = decodePcmWav(wav);
const resampled = resampleMono16(decoded.samples, decoded.sampleRate, 16000);
const padding = new Int16Array(640);
const output = new Int16Array(padding.length + resampled.length + padding.length);
output.set(padding, 0);
for (let index = 0; index < resampled.length; index += 1) {
  output[padding.length + index] = Math.round(resampled[index] * 0.28);
}
output.set(padding, padding.length + resampled.length);

const outputDirectory = resolve(projectRoot, "firmware/main/assets");
const outputPath = resolve(outputDirectory, "wake_ack_16k_mono.pcm");
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, Buffer.from(output.buffer));
console.log(`[wake-ack] source ${decoded.sampleRate} Hz, ${decoded.samples.length} samples`);
console.log(`[wake-ack] output 16000 Hz, ${output.length} samples, ${output.byteLength} bytes`);

function parseEnv(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function decodePcmWav(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("TTS did not return a PCM WAV file");
  }
  let offset = 12;
  let format = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      format = {
        encoding: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      };
    } else if (id === "data") {
      data = buffer.subarray(start, start + size);
    }
    offset = start + size + (size % 2);
  }
  if (!format || !data || format.encoding !== 1 || format.bitsPerSample !== 16) {
    throw new Error("Only 16-bit PCM WAV is supported");
  }
  const frames = Math.floor(data.length / (2 * format.channels));
  const samples = new Int16Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel += 1) {
      sum += data.readInt16LE((frame * format.channels + channel) * 2);
    }
    samples[frame] = Math.round(sum / format.channels);
  }
  return { samples, sampleRate: format.sampleRate };
}

function resampleMono16(input, inputRate, outputRate) {
  if (inputRate === outputRate) return input;
  const outputLength = Math.max(1, Math.round((input.length * outputRate) / inputRate));
  const output = new Int16Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const position = (index * inputRate) / outputRate;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const fraction = position - left;
    output[index] = Math.round(input[left] * (1 - fraction) + input[right] * fraction);
  }
  return output;
}
