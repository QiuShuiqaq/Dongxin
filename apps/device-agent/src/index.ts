import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { SerialPort } from "serialport";
import { StringDecoder } from "node:string_decoder";
import { CiV1FrameProbe } from "./ciSerial.ts";

const host = "127.0.0.1";
const port = Number(process.env.DX_DEVICE_AGENT_PORT || 3066);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const flashScript = resolve(projectRoot, "firmware/build-and-flash.ps1");
const ciRecordsDirectory = resolve(projectRoot, ".artifacts/ci1302-monitor");
const configuredOrigins = (process.env.DX_DEVICE_AGENT_ORIGINS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const allowedOrigins = new Set([
  "http://127.0.0.1:3010",
  "http://localhost:3010",
  ...configuredOrigins,
]);

type BoardId = "lichuang-c3-audio" | "esp32-c3-supermini" | "ci1302";
type JobAction = "BUILD" | "FLASH" | "BUILD_FLASH" | "MONITOR" | "CI_MONITOR";
type CiMonitorMode = "UART1_PROTOCOL" | "UART0_LOG";
type JobStatus = "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
type LogStream = "SYSTEM" | "STDOUT" | "STDERR" | "SERIAL";

interface AgentJob {
  id: string;
  action: JobAction;
  boardId: BoardId;
  port: string | null;
  monitorMode: CiMonitorMode | null;
  receivedBytes: number;
  validFrames: number;
  status: JobStatus;
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  logs: Array<{ at: string; stream: LogStream; text: string }>;
}

let activeJob: AgentJob | null = null;
let childProcess: ChildProcessWithoutNullStreams | null = null;
let serialMonitor: SerialPort | null = null;
const savedCiRecords = new WeakSet<AgentJob>();

class InputError extends Error {}

const server = createServer(async (request, response) => {
  try {
    if (!applyCors(request, response)) return;
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }

    const url = new URL(request.url || "/", `http://${host}:${port}`);
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        status: "READY",
        version: "0.1.0",
        host,
        projectRoot,
        activeJobId: activeJob?.status === "RUNNING" ? activeJob.id : null,
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/ports") {
      const ports = (await SerialPort.list())
        .map((item) => ({
          path: item.path,
          manufacturer: item.manufacturer || null,
          serialNumber: item.serialNumber || null,
          vendorId: item.vendorId || null,
          productId: item.productId || null,
        }))
        .sort((left, right) => left.path.localeCompare(right.path));
      sendJson(response, 200, ports);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/jobs/current") {
      sendJson(response, 200, activeJob);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/ci1302/records") {
      sendJson(response, 200, await listCiRecords());
      return;
    }
    const recordMatch = url.pathname.match(/^\/api\/ci1302\/records\/([0-9a-f-]{36})$/i);
    if (request.method === "GET" && recordMatch) {
      const record = await readCiRecord(recordMatch[1]!);
      if (!record) {
        sendJson(response, 404, { message: "监听记录不存在" });
        return;
      }
      sendJson(response, 200, record);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/jobs") {
      if (activeJob?.status === "RUNNING" || serialMonitor !== null) {
        sendJson(response, 409, { message: "已有本机任务正在执行，请先停止或等待完成" });
        return;
      }
      const body = await readJsonBody(request);
      const action = parseAction(body.action);
      const boardId = parseBoard(body.boardId);
      if ((action === "CI_MONITOR") !== (boardId === "ci1302")) {
        sendJson(response, 400, { message: "CI1302 只允许只读监听，C3 烧录任务不能使用 CI1302 板型" });
        return;
      }
      const monitorMode = action === "CI_MONITOR" ? parseCiMonitorMode(body.monitorMode) : null;
      const serialPath = action === "BUILD" ? null : parsePort(body.port);
      if (serialPath && !(await portExists(serialPath))) {
        sendJson(response, 400, { message: `串口 ${serialPath} 不存在，请重新检测设备` });
        return;
      }
      const job: AgentJob = {
        id: randomUUID(),
        action,
        boardId,
        port: serialPath,
        monitorMode,
        receivedBytes: 0,
        validFrames: 0,
        status: "RUNNING",
        startedAt: new Date().toISOString(),
        completedAt: null,
        exitCode: null,
        logs: [],
      };
      activeJob = job;
      appendLog(job, "SYSTEM", `${boardLabel(boardId)} / ${actionLabel(action)} 已启动`);
      if (action === "MONITOR" || action === "CI_MONITOR") void startSerialMonitor(job, serialPath!);
      else void startFirmwareJob(job);
      sendJson(response, 202, job);
      return;
    }

    const stopMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/stop$/i);
    if (request.method === "POST" && stopMatch) {
      if (!activeJob || activeJob.id !== stopMatch[1]) {
        sendJson(response, 404, { message: "本机任务不存在" });
        return;
      }
      stopActiveJob(activeJob);
      sendJson(response, 200, activeJob);
      return;
    }

    sendJson(response, 404, { message: "Not found" });
  } catch (error) {
    sendJson(response, error instanceof InputError ? 400 : 500, {
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, host, () => {
  console.log(`[device-agent] ready at http://${host}:${port}`);
  console.log(`[device-agent] project ${projectRoot}`);
});

async function startFirmwareJob(job: AgentJob): Promise<void> {
  if (job.action === "MONITOR" || job.action === "CI_MONITOR") {
    finishJob(job, "FAILED", null, "串口监视任务不能进入固件脚本");
    return;
  }
  const action = firmwareAction(job.boardId, job.action);
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    flashScript,
    "-Action",
    action,
  ];
  if (job.port) args.push("-Port", job.port);

  const child = spawn("powershell.exe", args, {
    cwd: resolve(projectRoot, "firmware"),
    env: process.env,
    windowsHide: true,
  });
  childProcess = child;
  appendLog(job, "SYSTEM", `执行预设动作：${action}${job.port ? ` / ${job.port}` : ""}`);
  pipeOutput(child.stdout, job, "STDOUT");
  pipeOutput(child.stderr, job, "STDERR");
  child.on("error", (error) => finishJob(job, "FAILED", null, error.message));
  child.on("close", (exitCode) => {
    childProcess = null;
    if (job.status !== "RUNNING") return;
    finishJob(
      job,
      exitCode === 0 ? "SUCCEEDED" : "FAILED",
      exitCode,
      exitCode === 0 ? "任务执行完成" : `任务失败，退出码 ${exitCode ?? "未知"}`,
    );
  });
}

async function startSerialMonitor(job: AgentJob, serialPath: string): Promise<void> {
  const baudRate = job.monitorMode === "UART1_PROTOCOL" ? 9600
    : job.monitorMode === "UART0_LOG" ? 921600 : 115200;
  const monitor = new SerialPort({
    path: serialPath, baudRate, dataBits: 8, parity: "none", stopBits: 1,
    rtscts: false, autoOpen: false,
  });
  serialMonitor = monitor;
  const probe = job.monitorMode === "UART1_PROTOCOL" ? new CiV1FrameProbe() : null;
  const decoder = job.monitorMode === "UART0_LOG" ? new StringDecoder("utf8") : null;
  let lineBuffer = "";
  monitor.on("data", (chunk: Buffer) => {
    if (job.status !== "RUNNING") return;
    job.receivedBytes += chunk.length;
    if (probe) {
      appendLog(job, "SERIAL", chunk.toString("hex").toUpperCase().replace(/../g, "$& ").trim());
      for (const frame of probe.feed(chunk)) {
        job.validFrames += 1;
        appendLog(job, "SERIAL", `V1 候选帧 · 命令 0x${frame.command.toString(16).toUpperCase().padStart(2, "0")} · 语义 ID ${frame.semanticId} · ${frame.hex}`);
      }
    } else if (decoder) {
      lineBuffer += decoder.write(chunk);
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) if (line) appendLog(job, "SERIAL", line);
      if (lineBuffer.length > 2000) {
        appendLog(job, "SERIAL", lineBuffer.slice(0, 2000));
        lineBuffer = lineBuffer.slice(2000);
      }
    } else {
      appendChunk(job, "SERIAL", chunk.toString("utf8"));
    }
  });
  monitor.on("error", (error) => {
    if (job.status === "RUNNING") finishJob(job, "FAILED", null, error.message);
    if (monitor.isOpen) monitor.close();
    else {
      if (serialMonitor === monitor) serialMonitor = null;
      if (job.action === "CI_MONITOR") void persistCiRecord(job);
    }
  });
  monitor.on("close", () => {
    if (lineBuffer) appendLog(job, "SERIAL", lineBuffer);
    if (serialMonitor === monitor) serialMonitor = null;
    if (job.status === "RUNNING") finishJob(job, "SUCCEEDED", 0, "串口监视已关闭");
    if (job.action === "CI_MONITOR") void persistCiRecord(job);
  });
  monitor.open((error) => {
    if (error) {
      if (serialMonitor === monitor) serialMonitor = null;
      if (job.status === "RUNNING") finishJob(job, "FAILED", null, `无法打开 ${serialPath}：${error.message}`);
      if (job.action === "CI_MONITOR") void persistCiRecord(job);
      return;
    }
    if (job.status !== "RUNNING") {
      monitor.close();
      return;
    }
    monitor.set({ dtr: false, rts: false }, (setError) => {
      if (setError && job.status === "RUNNING") {
        finishJob(job, "FAILED", null, `无法关闭 DTR/RTS：${setError.message}`);
        monitor.close();
      }
    });
    appendLog(job, "SYSTEM", `${serialPath} 已打开，${baudRate}/8N1；只接收，不发送串口数据`);
  });
}

function stopActiveJob(job: AgentJob): void {
  if (job.status !== "RUNNING") return;
  appendLog(job, "SYSTEM", "用户请求停止任务");
  job.status = "CANCELLED";
  job.completedAt = new Date().toISOString();
  if (serialMonitor?.isOpen) serialMonitor.close();
  // If opening is still pending, its open callback closes the port and saves the record.
  else if (!serialMonitor && job.action === "CI_MONITOR") void persistCiRecord(job);
  if (childProcess) childProcess.kill();
  childProcess = null;
}

function finishJob(
  job: AgentJob,
  status: Exclude<JobStatus, "RUNNING">,
  exitCode: number | null,
  message: string,
): void {
  if (job.status !== "RUNNING") return;
  job.status = status;
  job.exitCode = exitCode;
  job.completedAt = new Date().toISOString();
  appendLog(job, status === "FAILED" ? "STDERR" : "SYSTEM", message);
}

function pipeOutput(
  stream: NodeJS.ReadableStream,
  job: AgentJob,
  kind: Extract<LogStream, "STDOUT" | "STDERR">,
): void {
  stream.on("data", (chunk: Buffer) => appendChunk(job, kind, chunk.toString("utf8")));
}

function appendChunk(job: AgentJob, stream: LogStream, chunk: string): void {
  for (const line of chunk.replace(/\r/g, "").split("\n")) {
    if (line) appendLog(job, stream, line);
  }
}

function appendLog(job: AgentJob, stream: LogStream, text: string): void {
  job.logs.push({ at: new Date().toISOString(), stream, text: text.slice(0, 2000) });
  if (job.logs.length > 1200) job.logs.splice(0, job.logs.length - 1200);
}

async function persistCiRecord(job: AgentJob): Promise<void> {
  if (savedCiRecords.has(job)) return;
  savedCiRecords.add(job);
  try {
    await mkdir(ciRecordsDirectory, { recursive: true });
    const destination = resolve(ciRecordsDirectory, `${job.id}.json`);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(job, null, 2), "utf8");
    await rename(temporary, destination);
  } catch (error) {
    savedCiRecords.delete(job);
    console.error("[device-agent] CI1302 record could not be saved:", error);
  }
}

async function listCiRecords(): Promise<Array<Pick<AgentJob,
  "id" | "port" | "monitorMode" | "startedAt" | "completedAt" | "status" | "receivedBytes" | "validFrames">>> {
  await mkdir(ciRecordsDirectory, { recursive: true });
  const names = (await readdir(ciRecordsDirectory)).filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name));
  const dated = await Promise.all(names.map(async (name) => ({
    name, modifiedAt: (await stat(resolve(ciRecordsDirectory, name))).mtimeMs,
  })));
  dated.sort((left, right) => right.modifiedAt - left.modifiedAt);
  const records = await Promise.all(dated.slice(0, 30).map(async ({ name }) => {
    const record = JSON.parse(await readFile(resolve(ciRecordsDirectory, name), "utf8")) as AgentJob;
    return {
      id: record.id, port: record.port, monitorMode: record.monitorMode,
      startedAt: record.startedAt, completedAt: record.completedAt,
      status: record.status, receivedBytes: record.receivedBytes, validFrames: record.validFrames,
    };
  }));
  return records;
}

async function readCiRecord(id: string): Promise<AgentJob | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  try {
    return JSON.parse(await readFile(resolve(ciRecordsDirectory, `${id}.json`), "utf8")) as AgentJob;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function firmwareAction(boardId: BoardId, action: Exclude<JobAction, "MONITOR" | "CI_MONITOR">): string {
  if (boardId === "ci1302") throw new Error("CI1302 不能使用 C3 固件脚本");
  const prefix = boardId === "lichuang-c3-audio" ? "lichuang-" : "";
  const suffix = action === "BUILD" ? "build" : action === "FLASH" ? "flash" : "build-flash";
  return `${prefix}${suffix}`;
}

function parseBoard(value: unknown): BoardId {
  if (value === "lichuang-c3-audio" || value === "esp32-c3-supermini" || value === "ci1302") return value;
  throw new InputError("不支持的板型");
}

function parseAction(value: unknown): JobAction {
  if (value === "BUILD" || value === "FLASH" || value === "BUILD_FLASH" || value === "MONITOR" || value === "CI_MONITOR") return value;
  throw new InputError("不支持的任务动作");
}

function parseCiMonitorMode(value: unknown): CiMonitorMode {
  if (value === "UART1_PROTOCOL" || value === "UART0_LOG") return value;
  throw new InputError("请选择 CI1302 监听模式");
}

function parsePort(value: unknown): string {
  if (typeof value === "string" && /^COM[1-9]\d{0,2}$/i.test(value)) return value.toUpperCase();
  throw new InputError("请选择有效的 COM 串口");
}

async function portExists(serialPath: string): Promise<boolean> {
  return (await SerialPort.list()).some((item) => item.path.toUpperCase() === serialPath.toUpperCase());
}

function boardLabel(boardId: BoardId): string {
  return boardId === "lichuang-c3-audio" ? "立创 ESP32-C3 音频板"
    : boardId === "ci1302" ? "CI1302 独立开发板" : "ESP32-C3 SuperMini";
}

function actionLabel(action: JobAction): string {
  return ({ BUILD: "构建", FLASH: "烧录", BUILD_FLASH: "构建并烧录", MONITOR: "串口监视", CI_MONITOR: "CI1302 只读监听" } as const)[action];
}

function applyCors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    sendJson(response, 403, { message: "此网页来源未获本机烧录助手授权" });
    return false;
  }
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
  response.setHeader("Cache-Control", "no-store");
  return true;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 16 * 1024) throw new Error("请求体过大");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  if (response.headersSent) return;
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
