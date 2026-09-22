import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { SerialPort } from "serialport";

const host = "127.0.0.1";
const port = Number(process.env.DX_DEVICE_AGENT_PORT || 3066);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const flashScript = resolve(projectRoot, "firmware/build-and-flash.ps1");
const configuredOrigins = (process.env.DX_DEVICE_AGENT_ORIGINS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const allowedOrigins = new Set([
  "http://127.0.0.1:3010",
  "http://localhost:3010",
  ...configuredOrigins,
]);

type BoardId = "lichuang-c3-audio" | "esp32-c3-supermini";
type JobAction = "BUILD" | "FLASH" | "BUILD_FLASH" | "MONITOR";
type JobStatus = "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
type LogStream = "SYSTEM" | "STDOUT" | "STDERR" | "SERIAL";

interface AgentJob {
  id: string;
  action: JobAction;
  boardId: BoardId;
  port: string | null;
  status: JobStatus;
  startedAt: string;
  completedAt: string | null;
  exitCode: number | null;
  logs: Array<{ at: string; stream: LogStream; text: string }>;
}

let activeJob: AgentJob | null = null;
let childProcess: ChildProcessWithoutNullStreams | null = null;
let serialMonitor: SerialPort | null = null;

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
    if (request.method === "POST" && url.pathname === "/api/jobs") {
      if (activeJob?.status === "RUNNING") {
        sendJson(response, 409, { message: "已有本机任务正在执行，请先停止或等待完成" });
        return;
      }
      const body = await readJsonBody(request);
      const action = parseAction(body.action);
      const boardId = parseBoard(body.boardId);
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
        status: "RUNNING",
        startedAt: new Date().toISOString(),
        completedAt: null,
        exitCode: null,
        logs: [],
      };
      activeJob = job;
      appendLog(job, "SYSTEM", `${boardLabel(boardId)} / ${actionLabel(action)} 已启动`);
      if (action === "MONITOR") void startSerialMonitor(job, serialPath!);
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
    sendJson(response, 500, {
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, host, () => {
  console.log(`[device-agent] ready at http://${host}:${port}`);
  console.log(`[device-agent] project ${projectRoot}`);
});

async function startFirmwareJob(job: AgentJob): Promise<void> {
  if (job.action === "MONITOR") {
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
  const monitor = new SerialPort({ path: serialPath, baudRate: 115200, autoOpen: false });
  serialMonitor = monitor;
  monitor.on("data", (chunk: Buffer) => appendChunk(job, "SERIAL", chunk.toString("utf8")));
  monitor.on("error", (error) => {
    if (job.status === "RUNNING") finishJob(job, "FAILED", null, error.message);
  });
  monitor.on("close", () => {
    serialMonitor = null;
    if (job.status === "RUNNING") finishJob(job, "SUCCEEDED", 0, "串口监视已关闭");
  });
  monitor.open((error) => {
    if (error) {
      finishJob(job, "FAILED", null, `无法打开 ${serialPath}：${error.message}`);
      return;
    }
    appendLog(job, "SYSTEM", `${serialPath} 已打开，115200 baud`);
  });
}

function stopActiveJob(job: AgentJob): void {
  if (job.status !== "RUNNING") return;
  appendLog(job, "SYSTEM", "用户请求停止任务");
  job.status = "CANCELLED";
  job.completedAt = new Date().toISOString();
  if (serialMonitor?.isOpen) serialMonitor.close();
  serialMonitor = null;
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

function firmwareAction(boardId: BoardId, action: Exclude<JobAction, "MONITOR">): string {
  const prefix = boardId === "lichuang-c3-audio" ? "lichuang-" : "";
  const suffix = action === "BUILD" ? "build" : action === "FLASH" ? "flash" : "build-flash";
  return `${prefix}${suffix}`;
}

function parseBoard(value: unknown): BoardId {
  if (value === "lichuang-c3-audio" || value === "esp32-c3-supermini") return value;
  throw new Error("不支持的板型");
}

function parseAction(value: unknown): JobAction {
  if (value === "BUILD" || value === "FLASH" || value === "BUILD_FLASH" || value === "MONITOR") return value;
  throw new Error("不支持的任务动作");
}

function parsePort(value: unknown): string {
  if (typeof value === "string" && /^COM[1-9]\d{0,2}$/i.test(value)) return value.toUpperCase();
  throw new Error("请选择有效的 COM 串口");
}

async function portExists(serialPath: string): Promise<boolean> {
  return (await SerialPort.list()).some((item) => item.path.toUpperCase() === serialPath.toUpperCase());
}

function boardLabel(boardId: BoardId): string {
  return boardId === "lichuang-c3-audio" ? "立创 ESP32-C3 音频板" : "ESP32-C3 SuperMini";
}

function actionLabel(action: JobAction): string {
  return ({ BUILD: "构建", FLASH: "烧录", BUILD_FLASH: "构建并烧录", MONITOR: "串口监视" } as const)[action];
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
