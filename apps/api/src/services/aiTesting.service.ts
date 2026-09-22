import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import type {
  AsrDataset,
  BatchTestItem,
  BatchTestKind,
  BatchTestRun,
  BatchTestSummary,
  ModelProvider,
  ProviderDiagnosticResult,
  ProviderServiceType,
  TestCase,
} from "@dongxin/shared";
import { BatchTestRunSchema } from "@dongxin/shared";
import { z } from "zod";
import { ApiError } from "../http/apiError.js";
import * as repository from "../repositories/aiTesting.repository.js";
import { getDeviceState } from "./deviceRegistry.service.js";
import { listPrompts, findPrompt } from "./prompt.service.js";
import {
  findProvider,
  findProviderForService,
  listProviderSecretStatuses,
  listProviders,
} from "./provider.service.js";
import { synthesizeSpeech, transcribeAudio } from "./speech.service.js";
import { getTestSet } from "./testSet.service.js";
import { runLlmModuleTest } from "./voicePipeline.service.js";

const ServiceTypeSchema = z.enum(["LLM", "ASR", "TTS"]);
const SaveDefaultSchema = z.object({ providerId: z.string().min(1) });
const DiagnosticSchema = z.object({ providerId: z.string().min(1) });
const CreateDatasetSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(""),
});
const AddAudioItemSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  expectedText: z.string().trim().min(1).max(500),
  mimeType: z.string().trim().min(1).max(100),
  audioBase64: z.string().min(1),
});
const StartBatchSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(["ASR", "LLM", "TTS"]),
  providerId: z.string().min(1),
  deviceId: z.string().min(1).optional(),
  testSetId: z.string().min(1).optional(),
  asrDatasetId: z.string().uuid().optional(),
  caseIds: z.array(z.string().min(1)).max(200).default([]),
  repeatCount: z.number().int().min(1).max(3).default(1),
  maxCases: z.number().int().min(1).max(200).default(50),
});

const activeRuns = new Map<string, { cancelled: boolean }>();

export async function getAiServiceConfiguration() {
  const [providers, secrets, defaults] = await Promise.all([
    listProviders(),
    listProviderSecretStatuses(),
    repository.getAiServiceDefaults(),
  ]);
  return {
    storage: {
      driver: "LOCAL_FILE" as const,
      label: "本地研发文件存储",
      detail: "运行记录和研发音频保存在 D:\\workspace\\Dongxin\\data；生产部署前迁移到 PostgreSQL/RDS 和对象存储。",
    },
    defaults,
    providers,
    secrets,
  };
}

export async function setDefaultProvider(serviceType: unknown, requestBody: unknown) {
  const type = ServiceTypeSchema.parse(serviceType);
  const body = SaveDefaultSchema.parse(requestBody);
  const provider = findProviderForService(await listProviders(), body.providerId, type);
  if (!provider.enabled) {
    throw new ApiError(422, "PROVIDER_DISABLED", "请先启用该服务配置");
  }
  return repository.saveDefaultProvider(type, provider.id);
}

export async function diagnoseProvider(requestBody: unknown): Promise<ProviderDiagnosticResult> {
  const body = DiagnosticSchema.parse(requestBody);
  const provider = findProvider(await listProviders(), body.providerId);
  const started = performance.now();
  let result = "";
  let costCny = 0;
  let error: string | null = null;

  try {
    if (provider.serviceType === "LLM") {
      const deviceId = await resolveDiagnosticDeviceId();
      const response = await runLlmModuleTest({
        deviceId,
        providerId: provider.id,
        text: "打开照明",
      });
      if (response.error) throw new Error(response.error);
      result = response.aiResult.speak || response.aiResult.resultType;
      costCny = response.usage.costCny ?? 0;
    } else if (provider.serviceType === "TTS") {
      const response = await synthesizeSpeech({
        text: "东信语音服务连通测试",
        providerId: provider.id,
        audioFormat: "wav",
      });
      if (response.status !== "COMPLETED" || !response.audioBase64) {
        throw new Error(response.error || "TTS 未返回音频");
      }
      result = `已生成 ${Buffer.from(response.audioBase64, "base64").length} 字节 WAV（未播放）`;
      costCny = response.costCny;
    } else {
      const wav = await buildDiagnosticAsrWav();
      const response = await transcribeAudio({
        audioBase64: wav.toString("base64"),
        mimeType: "audio/wav",
        providerId: provider.id,
      });
      if (response.status !== "COMPLETED") {
        throw new Error(response.error || "ASR 未返回识别结果");
      }
      result = response.text || "请求成功，但诊断音频未识别出文字";
      costCny = response.costCny;
    }
  } catch (caught) {
    error = errorMessage(caught);
  }

  return {
    providerId: provider.id,
    serviceType: provider.serviceType,
    status: error ? "FAILED" : "PASSED",
    latencyMs: Math.round(performance.now() - started),
    result: error ? "连通测试失败" : result,
    costCny,
    testedAt: new Date().toISOString(),
    error,
  };
}

export async function listAsrDatasets(): Promise<AsrDataset[]> {
  return (await repository.listAsrDatasets()).sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export async function createAsrDataset(requestBody: unknown): Promise<AsrDataset> {
  const body = CreateDatasetSchema.parse(requestBody);
  const now = new Date().toISOString();
  const dataset: AsrDataset = {
    id: randomUUID(),
    name: body.name,
    description: body.description,
    createdAt: now,
    updatedAt: now,
    items: [],
  };
  const datasets = await repository.listAsrDatasets();
  await repository.saveAsrDatasets([...datasets, dataset]);
  return dataset;
}

export async function deleteAsrDataset(datasetId: string): Promise<void> {
  const id = z.string().uuid().parse(datasetId);
  if (!(await repository.deleteAsrDataset(id))) {
    throw new ApiError(404, "ASR_DATASET_NOT_FOUND", "ASR 测试集不存在");
  }
}

export async function addAsrDatasetItem(
  datasetId: string,
  requestBody: unknown,
): Promise<AsrDataset> {
  const body = AddAudioItemSchema.parse(requestBody);
  const audio = Buffer.from(body.audioBase64, "base64");
  if (!audio.length || audio.length > 8 * 1024 * 1024) {
    throw new ApiError(422, "INVALID_AUDIO_SIZE", "单个音频必须大于 0 且不超过 8 MB");
  }
  const datasets = await repository.listAsrDatasets();
  const index = datasets.findIndex((item) => item.id === datasetId);
  if (index < 0) throw new ApiError(404, "ASR_DATASET_NOT_FOUND", "ASR 测试集不存在");
  const itemId = repository.createArtifactId();
  const path = await repository.writeAsrAudioAsset({
    datasetId,
    itemId,
    fileName: body.fileName,
    data: audio,
  });
  const now = new Date().toISOString();
  const dataset: AsrDataset = {
    ...datasets[index],
    updatedAt: now,
    items: [
      ...datasets[index].items,
      {
        id: itemId,
        fileName: body.fileName,
        expectedText: body.expectedText,
        mimeType: body.mimeType,
        byteLength: audio.length,
        audioUrl: `/api/development/test-artifacts/${encodeArtifactPath(path)}`,
        createdAt: now,
      },
    ],
  };
  const next = [...datasets];
  next[index] = dataset;
  await repository.saveAsrDatasets(next);
  return dataset;
}

export async function getTestArtifact(encodedPath: string): Promise<{ data: Buffer; mimeType: string }> {
  const path = decodeArtifactPath(encodedPath);
  return { data: await repository.readArtifact(path), mimeType: mimeTypeForPath(path) };
}

export async function listBatchTestRuns(): Promise<BatchTestRun[]> {
  return (await repository.listBatchRuns())
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 50);
}

export async function getBatchTestRun(runId: string): Promise<BatchTestRun> {
  const id = z.string().uuid().parse(runId);
  const run = (await repository.listBatchRuns()).find((item) => item.id === id);
  if (!run) throw new ApiError(404, "BATCH_RUN_NOT_FOUND", "批量测试任务不存在");
  return run;
}

export async function deleteBatchTestRun(runId: string): Promise<void> {
  const run = await getBatchTestRun(runId);
  if (["QUEUED", "RUNNING"].includes(run.status)) {
    throw new ApiError(409, "BATCH_RUN_ACTIVE", "请先停止正在运行的批量任务");
  }
  if (!(await repository.deleteBatchRun(run.id))) {
    throw new ApiError(404, "BATCH_RUN_NOT_FOUND", "批量测试任务不存在");
  }
}

export async function startBatchTest(requestBody: unknown): Promise<BatchTestRun> {
  const body = StartBatchSchema.parse(requestBody);
  const providers = await listProviders();
  const provider = findProviderForService(providers, body.providerId, body.kind);
  if (!provider.enabled) throw new ApiError(422, "PROVIDER_DISABLED", "所选服务当前未启用");
  const source = await resolveBatchSource(body.kind, body.testSetId, body.asrDatasetId, body.caseIds, body.maxCases);
  if (!source.count) throw new ApiError(422, "BATCH_SOURCE_EMPTY", "所选测试数据为空");

  const now = new Date().toISOString();
  const run: BatchTestRun = BatchTestRunSchema.parse({
    id: randomUUID(),
    name: body.name,
    kind: body.kind,
    status: "QUEUED",
    providerId: provider.id,
    providerName: provider.name,
    deviceId: body.deviceId ?? null,
    testSetId: source.testSet?.id ?? null,
    testSetName: source.testSet?.name ?? null,
    asrDatasetId: source.dataset?.id ?? null,
    asrDatasetName: source.dataset?.name ?? null,
    repeatCount: body.repeatCount,
    maxCases: body.maxCases,
    caseIds: body.caseIds,
    summary: emptySummary(source.count * body.repeatCount),
    items: [],
    createdAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
    error: null,
  });
  await repository.saveBatchRun(run);
  activeRuns.set(run.id, { cancelled: false });
  void executeBatchRun(run, provider, source.cases, source.dataset).catch(() => undefined);
  return run;
}

export async function cancelBatchTest(runId: string): Promise<BatchTestRun> {
  const run = await getBatchTestRun(runId);
  if (["COMPLETED", "CANCELLED", "FAILED"].includes(run.status)) return run;
  const active = activeRuns.get(run.id);
  if (active) active.cancelled = true;
  return persistRun({
    ...run,
    status: "CANCELLED",
    completedAt: new Date().toISOString(),
    error: null,
  });
}

export async function retryFailedBatchTest(runId: string): Promise<BatchTestRun> {
  const previous = await getBatchTestRun(runId);
  const failedIds = [...new Set(previous.items.filter((item) => !item.passed && item.testCaseId).map((item) => item.testCaseId!))];
  if (!failedIds.length && previous.kind !== "ASR") {
    throw new ApiError(422, "NO_FAILED_ITEMS", "当前任务没有可重试的失败项");
  }
  return startBatchTest({
    name: `${previous.name} - 失败重试`,
    kind: previous.kind,
    providerId: previous.providerId,
    deviceId: previous.deviceId ?? undefined,
    testSetId: previous.testSetId ?? undefined,
    asrDatasetId: previous.asrDatasetId ?? undefined,
    caseIds: previous.kind === "ASR" ? [] : failedIds,
    repeatCount: 1,
    maxCases: Math.max(failedIds.length, 1),
  });
}

export async function exportBatchTestRun(runId: string, format: string) {
  const run = await getBatchTestRun(runId);
  const normalized = z.enum(["json", "csv", "html"]).parse(format.toLowerCase());
  if (normalized === "json") {
    return {
      contentType: "application/json; charset=utf-8",
      fileName: `${safeFileName(run.name)}-${run.id.slice(0, 8)}.json`,
      body: JSON.stringify(run, null, 2),
    };
  }
  if (normalized === "csv") {
    const header = ["序号", "类型", "输入/文件", "期望文本", "实际文本", "期望意图", "实际意图", "通过", "CER", "耗时ms", "费用元", "错误"];
    const rows = run.items.map((item) => [
      item.sequence,
      run.kind,
      item.inputText,
      item.expectedText ?? "",
      item.actualText ?? "",
      item.expectedIntent ?? "",
      item.actualIntent ?? "",
      item.passed ? "是" : "否",
      item.characterErrorRate ?? "",
      item.latencyMs,
      item.costCny,
      item.error ?? "",
    ]);
    return {
      contentType: "text/csv; charset=utf-8",
      fileName: `${safeFileName(run.name)}-${run.id.slice(0, 8)}.csv`,
      body: `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`,
    };
  }
  return {
    contentType: "text/html; charset=utf-8",
    fileName: `${safeFileName(run.name)}-${run.id.slice(0, 8)}.html`,
    body: buildHtmlReport(run),
  };
}

async function executeBatchRun(
  initial: BatchTestRun,
  provider: ModelProvider,
  cases: TestCase[],
  dataset: AsrDataset | null,
): Promise<void> {
  let run = await persistRun({ ...initial, status: "RUNNING", startedAt: new Date().toISOString() });
  try {
    const sourceItems = dataset?.items ?? cases;
    let sequence = 0;
    for (let repeat = 0; repeat < run.repeatCount; repeat += 1) {
      for (const sourceItem of sourceItems.slice(0, run.maxCases)) {
        if (activeRuns.get(run.id)?.cancelled) return;
        sequence += 1;
        const item = await executeBatchItem(run, provider, sourceItem, sequence);
        run = await persistRun({ ...run, items: [...run.items, item] });
      }
    }
    run = await persistRun({
      ...run,
      status: "COMPLETED",
      completedAt: new Date().toISOString(),
    });
  } catch (caught) {
    await persistRun({
      ...run,
      status: "FAILED",
      completedAt: new Date().toISOString(),
      error: errorMessage(caught),
    });
  } finally {
    activeRuns.delete(run.id);
  }
}

async function executeBatchItem(
  run: BatchTestRun,
  provider: ModelProvider,
  source: TestCase | AsrDataset["items"][number],
  sequence: number,
): Promise<BatchTestItem> {
  const createdAt = new Date().toISOString();
  const started = performance.now();
  const base = {
    id: randomUUID(),
    sequence,
    testCaseId: "inputText" in source ? source.id : null,
    datasetItemId: "expectedText" in source ? source.id : null,
    inputText: "inputText" in source ? source.inputText : source.fileName,
    expectedText: "expectedText" in source ? source.expectedText : null,
    actualText: null,
    expectedIntent: "expectedIntent" in source ? source.expectedIntent : null,
    actualIntent: null,
    passed: false,
    latencyMs: 0,
    costCny: 0,
    characterErrorRate: null,
    wakeWordExpected: "expectedText" in source && normalizeText(source.expectedText).includes("小东小东"),
    wakeWordDetected: false,
    audioUrl: null,
    error: null,
    createdAt,
  } satisfies BatchTestItem;
  try {
    if (run.kind === "LLM" && "inputText" in source) {
      const response = await runLlmModuleTest({
        deviceId: run.deviceId || (await resolveDiagnosticDeviceId()),
        text: source.inputText,
        providerId: provider.id,
      });
      if (response.error) throw new Error(response.error);
      return {
        ...base,
        actualText: response.aiResult.speak,
        actualIntent: response.aiResult.intent,
        passed: source.expectedIntent === response.aiResult.intent,
        latencyMs: response.latencyMs,
        costCny: response.usage.costCny ?? 0,
      };
    }
    if (run.kind === "TTS" && "inputText" in source) {
      const response = await synthesizeSpeech({
        text: source.inputText,
        providerId: provider.id,
        audioFormat: "wav",
      });
      if (response.status !== "COMPLETED" || !response.audioBase64) {
        throw new Error(response.error || "TTS 未返回音频");
      }
      const itemId = base.id;
      const path = await repository.writeTtsArtifact({
        runId: run.id,
        itemId,
        extension: "wav",
        data: Buffer.from(response.audioBase64, "base64"),
      });
      return {
        ...base,
        actualText: "语音生成成功",
        passed: true,
        latencyMs: response.latencyMs,
        costCny: response.costCny,
        audioUrl: `/api/development/test-artifacts/${encodeArtifactPath(path)}`,
      };
    }
    if (run.kind === "ASR" && "expectedText" in source) {
      const path = decodeArtifactUrl(source.audioUrl);
      const audio = await repository.readArtifact(path);
      const response = await transcribeAudio({
        audioBase64: audio.toString("base64"),
        mimeType: source.mimeType,
        providerId: provider.id,
      });
      if (response.status !== "COMPLETED" || !response.text) {
        throw new Error(response.error || "ASR 未返回识别文本");
      }
      const cer = characterErrorRate(source.expectedText, response.text);
      const wakeDetected = normalizeText(response.text).includes("小东小东");
      return {
        ...base,
        actualText: response.text,
        passed: cer <= 0.2 && (!base.wakeWordExpected || wakeDetected),
        latencyMs: response.latencyMs,
        costCny: response.costCny,
        characterErrorRate: cer,
        wakeWordDetected: wakeDetected,
        audioUrl: source.audioUrl,
      };
    }
    throw new Error("批量测试数据类型与任务不匹配");
  } catch (caught) {
    return {
      ...base,
      latencyMs: Math.round(performance.now() - started),
      error: errorMessage(caught),
    };
  }
}

async function persistRun(input: BatchTestRun): Promise<BatchTestRun> {
  const run = BatchTestRunSchema.parse({
    ...input,
    summary: summarize(input.items, input.summary.total),
    updatedAt: new Date().toISOString(),
  });
  return repository.saveBatchRun(run);
}

async function resolveBatchSource(
  kind: BatchTestKind,
  testSetId: string | undefined,
  datasetId: string | undefined,
  caseIds: string[],
  maxCases: number,
) {
  if (kind === "ASR") {
    if (!datasetId) throw new ApiError(422, "ASR_DATASET_REQUIRED", "ASR 批量测试必须选择音频测试集");
    const dataset = (await repository.listAsrDatasets()).find((item) => item.id === datasetId);
    if (!dataset) throw new ApiError(404, "ASR_DATASET_NOT_FOUND", "ASR 测试集不存在");
    return { dataset, testSet: null, cases: [], count: Math.min(dataset.items.length, maxCases) };
  }
  if (!testSetId) throw new ApiError(422, "TEST_SET_REQUIRED", "LLM/TTS 批量测试必须选择文本测试集");
  const testSet = await getTestSet(testSetId);
  const selected = caseIds.length
    ? testSet.cases.filter((item) => caseIds.includes(item.id))
    : testSet.cases;
  return { dataset: null, testSet, cases: selected.slice(0, maxCases), count: Math.min(selected.length, maxCases) };
}

async function resolveDiagnosticDeviceId(): Promise<string> {
  const preferred = "DX-C3-LICHUANG-AUDIO-001";
  try {
    await getDeviceState(preferred);
    return preferred;
  } catch {
    return "demo-bath-heater-001";
  }
}

async function buildDiagnosticAsrWav(): Promise<Buffer> {
  try {
    const pcm = await readFile(new URL("../../../../firmware/main/assets/wake_ack_16k_mono.pcm", import.meta.url));
    return wrapPcmAsWav(pcm, 16_000);
  } catch {
    return buildToneDiagnosticWav();
  }
}

function buildToneDiagnosticWav(): Buffer {
  const sampleRate = 16_000;
  const durationSeconds = 0.35;
  const samples = Math.round(sampleRate * durationSeconds);
  const pcm = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const envelope = Math.sin(Math.PI * (index / samples));
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 900 * envelope);
    pcm.writeInt16LE(sample, index * 2);
  }
  return wrapPcmAsWav(pcm, sampleRate);
}

function wrapPcmAsWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function summarize(items: BatchTestItem[], total: number): BatchTestSummary {
  const completed = items.length;
  const passed = items.filter((item) => item.passed).length;
  const latencies = items.map((item) => item.latencyMs).sort((a, b) => a - b);
  const cerItems = items.filter((item) => item.characterErrorRate !== null);
  const wakeItems = items.filter((item) => item.wakeWordExpected);
  return {
    total,
    completed,
    passed,
    failed: completed - passed,
    passRate: completed ? passed / completed : 0,
    averageLatencyMs: completed ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / completed) : 0,
    p95LatencyMs: latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] : 0,
    totalCostCny: items.reduce((sum, item) => sum + item.costCny, 0),
    averageCharacterErrorRate: cerItems.length
      ? cerItems.reduce((sum, item) => sum + (item.characterErrorRate ?? 0), 0) / cerItems.length
      : null,
    wakeWordAccuracy: wakeItems.length
      ? wakeItems.filter((item) => item.wakeWordDetected).length / wakeItems.length
      : null,
  };
}

function emptySummary(total: number): BatchTestSummary {
  return summarize([], total);
}

function characterErrorRate(expected: string, actual: string): number {
  const left = [...normalizeText(expected)];
  const right = [...normalizeText(actual)];
  if (!left.length) return right.length ? 1 : 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] / left.length;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[\s，。！？、,.!?;；:“”"'‘’（）()\-]/g, "");
}

function encodeArtifactPath(path: string): string {
  return Buffer.from(path, "utf8").toString("base64url");
}

function decodeArtifactPath(value: string): string {
  const path = Buffer.from(value, "base64url").toString("utf8");
  if (!/^(asr|tts)\/[a-zA-Z0-9-]+\/[a-zA-Z0-9.-]+$/.test(path)) {
    throw new ApiError(422, "INVALID_ARTIFACT_PATH", "测试产物路径无效");
  }
  return path;
}

function decodeArtifactUrl(url: string): string {
  const encoded = url.split("/").pop();
  if (!encoded) throw new ApiError(422, "INVALID_ARTIFACT_URL", "测试音频地址无效");
  return decodeArtifactPath(encoded);
}

function mimeTypeForPath(path: string): string {
  if (path.endsWith(".wav")) return "audio/wav";
  if (path.endsWith(".mp3")) return "audio/mpeg";
  if (path.endsWith(".webm")) return "audio/webm";
  if (path.endsWith(".ogg")) return "audio/ogg";
  if (path.endsWith(".m4a")) return "audio/mp4";
  return "application/octet-stream";
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").slice(0, 80) || "batch-test";
}

function buildHtmlReport(run: BatchTestRun): string {
  const rows = run.items.map((item) => `<tr><td>${item.sequence}</td><td>${escapeHtml(item.inputText)}</td><td>${escapeHtml(item.expectedText ?? item.expectedIntent ?? "-")}</td><td>${escapeHtml(item.actualText ?? item.actualIntent ?? "-")}</td><td>${item.passed ? "通过" : "失败"}</td><td>${item.latencyMs}</td><td>${item.costCny.toFixed(6)}</td><td>${escapeHtml(item.error ?? "")}</td></tr>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(run.name)}</title><style>body{font-family:Arial,"Microsoft YaHei",sans-serif;margin:32px;color:#24342f}h1{font-size:24px}section{display:flex;gap:28px;margin:20px 0;padding:16px;background:#f3f7f5}strong{display:block;font-size:20px;color:#176b55}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:8px;border:1px solid #dce5e1;text-align:left;vertical-align:top}th{background:#edf4f1}@media print{body{margin:12mm}}</style></head><body><h1>东信 AI 浴霸研发测试报告</h1><p>${escapeHtml(run.name)} · ${run.kind} · ${escapeHtml(run.providerName)}</p><p>任务编号：${run.id}<br>创建时间：${run.createdAt}<br>完成时间：${run.completedAt ?? "未完成"}</p><section><div>样本<strong>${run.summary.completed}/${run.summary.total}</strong></div><div>通过率<strong>${(run.summary.passRate * 100).toFixed(1)}%</strong></div><div>平均耗时<strong>${run.summary.averageLatencyMs} ms</strong></div><div>总费用<strong>¥${run.summary.totalCostCny.toFixed(6)}</strong></div></section><table><thead><tr><th>#</th><th>输入/文件</th><th>期望</th><th>实际</th><th>结论</th><th>耗时ms</th><th>费用元</th><th>错误</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
