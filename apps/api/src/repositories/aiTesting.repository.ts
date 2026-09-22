import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type {
  AiServiceDefaults,
  AsrDataset,
  BatchTestRun,
  ProviderServiceType,
} from "@dongxin/shared";
import {
  AiServiceDefaultsSchema,
  AsrDatasetSchema,
  BatchTestRunSchema,
} from "@dongxin/shared";
import { z } from "zod";
import { getDataPath, readJsonFile, writeJsonFile } from "../storage.js";

const SETTINGS_FILE = "ai-service-settings.json";
const ASR_DATASETS_FILE = "asr-test-datasets.json";
const BATCH_RUNS_FILE = "batch-test-runs.json";
const artifactsRoot = resolve(getDataPath("test-artifacts"));
let mutationQueue: Promise<unknown> = Promise.resolve();

export async function getAiServiceDefaults(): Promise<AiServiceDefaults> {
  return AiServiceDefaultsSchema.parse(
    await readJsonFile(SETTINGS_FILE, {
      LLM: "aliyun-qwen3-7-flash",
      ASR: "aliyun-qwen3-asr-flash",
      TTS: "aliyun-cosyvoice-v3-flash",
      updatedAt: new Date().toISOString(),
    }),
  );
}

export async function saveDefaultProvider(
  serviceType: ProviderServiceType,
  providerId: string,
): Promise<AiServiceDefaults> {
  return mutate(async () => {
    const current = await getAiServiceDefaults();
    const next = AiServiceDefaultsSchema.parse({
      ...current,
      [serviceType]: providerId,
      updatedAt: new Date().toISOString(),
    });
    await writeJsonFile(SETTINGS_FILE, next);
    return next;
  });
}

export async function listAsrDatasets(): Promise<AsrDataset[]> {
  return z.array(AsrDatasetSchema).parse(
    await readJsonFile<AsrDataset[]>(ASR_DATASETS_FILE, []),
  );
}

export async function saveAsrDatasets(datasets: AsrDataset[]): Promise<void> {
  await mutate(async () => {
    await writeJsonFile(ASR_DATASETS_FILE, z.array(AsrDatasetSchema).parse(datasets));
  });
}

export async function deleteAsrDataset(datasetId: string): Promise<boolean> {
  return mutate(async () => {
    const datasets = await listAsrDatasets();
    const next = datasets.filter((item) => item.id !== datasetId);
    if (next.length === datasets.length) return false;
    await writeJsonFile(ASR_DATASETS_FILE, next);
    const directory = resolve(artifactsRoot, "asr", datasetId);
    assertInsideArtifacts(resolve(directory, "item"));
    await rm(directory, { recursive: true, force: true });
    return true;
  });
}

export async function writeAsrAudioAsset(input: {
  datasetId: string;
  itemId: string;
  fileName: string;
  data: Buffer;
}): Promise<string> {
  const extension = safeAudioExtension(input.fileName);
  const relativePath = `asr/${input.datasetId}/${input.itemId}${extension}`;
  const absolutePath = resolve(artifactsRoot, relativePath);
  assertInsideArtifacts(absolutePath);
  await mkdir(resolve(artifactsRoot, "asr", input.datasetId), { recursive: true });
  await writeFile(absolutePath, input.data);
  return relativePath.replace(/\\/g, "/");
}

export async function readArtifact(relativePath: string): Promise<Buffer> {
  const absolutePath = resolve(artifactsRoot, relativePath);
  assertInsideArtifacts(absolutePath);
  return readFile(absolutePath);
}

export async function writeTtsArtifact(input: {
  runId: string;
  itemId: string;
  extension: string;
  data: Buffer;
}): Promise<string> {
  const extension = safeAudioExtension(`audio.${input.extension}`);
  const relativePath = `tts/${input.runId}/${input.itemId}${extension}`;
  const directory = resolve(artifactsRoot, "tts", input.runId);
  const absolutePath = resolve(artifactsRoot, relativePath);
  assertInsideArtifacts(absolutePath);
  await mkdir(directory, { recursive: true });
  await writeFile(absolutePath, input.data);
  return relativePath.replace(/\\/g, "/");
}

export async function listBatchRuns(): Promise<BatchTestRun[]> {
  return z.array(BatchTestRunSchema).parse(
    await readJsonFile<BatchTestRun[]>(BATCH_RUNS_FILE, []),
  );
}

export async function saveBatchRun(run: BatchTestRun): Promise<BatchTestRun> {
  return mutate(async () => {
    const runs = await listBatchRuns();
    const index = runs.findIndex((item) => item.id === run.id);
    const next = [...runs];
    if (index >= 0) next[index] = BatchTestRunSchema.parse(run);
    else next.push(BatchTestRunSchema.parse(run));
    await writeJsonFile(BATCH_RUNS_FILE, next.slice(-100));
    return run;
  });
}

export async function deleteBatchRun(runId: string): Promise<boolean> {
  return mutate(async () => {
    const runs = await listBatchRuns();
    const next = runs.filter((item) => item.id !== runId);
    if (next.length === runs.length) return false;
    await writeJsonFile(BATCH_RUNS_FILE, next);
    const directory = resolve(artifactsRoot, "tts", runId);
    assertInsideArtifacts(resolve(directory, "item"));
    await rm(directory, { recursive: true, force: true });
    return true;
  });
}

export function createArtifactId(): string {
  return randomUUID();
}

function safeAudioExtension(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  return [".wav", ".mp3", ".m4a", ".webm", ".ogg", ".pcm"].includes(extension)
    ? extension
    : ".bin";
}

function assertInsideArtifacts(path: string): void {
  const root = `${artifactsRoot.toLowerCase()}\\`;
  if (!path.toLowerCase().startsWith(root)) {
    throw new Error("Artifact path escaped the test artifact directory");
  }
}

function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const next = mutationQueue.then(operation);
  mutationQueue = next.catch(() => undefined);
  return next;
}
