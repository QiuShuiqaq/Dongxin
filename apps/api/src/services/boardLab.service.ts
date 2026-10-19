import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '../http/apiError.js';
import { getDevice } from './deviceRegistry.service.js';
import { publishBoardTestControl } from './mqttGateway.service.js';

const BoardLabActionSchema = z.enum(['snapshot', 'display_pattern', 'display_power']);
const BoardLabRequestSchema = z.object({
  action: BoardLabActionSchema,
  params: z.record(z.string(), z.unknown()).default({})
});
const BoardLabResultSchema = z.object({
  deviceId: z.string().min(1),
  requestId: z.string().uuid(),
  action: BoardLabActionSchema,
  status: z.enum(['COMPLETED', 'FAILED']),
  message: z.string().default(''),
  result: z.record(z.string(), z.unknown()).optional()
});

export type BoardLabAction = z.infer<typeof BoardLabActionSchema>;
export type BoardLabRequestStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface BoardLabRequestRecord {
  requestId: string;
  deviceId: string;
  action: BoardLabAction;
  params: Record<string, unknown>;
  status: BoardLabRequestStatus;
  message: string;
  result: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

const requests = new Map<string, BoardLabRequestRecord>();
const latestByDevice = new Map<string, string>();
const RESPONSE_TIMEOUT_MS = 15_000;

export async function startBoardLabAction(
  deviceId: string,
  requestBody: unknown
): Promise<BoardLabRequestRecord> {
  const device = await getDevice(deviceId);
  if (device.status !== 'ONLINE' || device.capabilities?.boardLab !== true) {
    throw new ApiError(
      409,
      'BOARD_LAB_DEVICE_UNAVAILABLE',
      '设备未在线或当前固件未上报 boardLab 能力'
    );
  }
  const input = BoardLabRequestSchema.parse(requestBody);
  const params = normalizeParams(input.action, input.params);
  const now = new Date().toISOString();
  const record: BoardLabRequestRecord = {
    requestId: randomUUID(),
    deviceId,
    action: input.action,
    params,
    status: 'PENDING',
    message: '命令已发送，等待开发板回执',
    result: null,
    createdAt: now,
    updatedAt: now
  };
  pruneRequests();
  requests.set(record.requestId, record);
  latestByDevice.set(deviceId, record.requestId);
  try {
    await publishBoardTestControl(record);
  } catch {
    patchRequest(record.requestId, {
      status: 'FAILED',
      message: 'MQTT 下发失败，请检查本地服务和设备连接'
    });
    throw new ApiError(503, 'BOARD_LAB_DELIVERY_FAILED', '无法向开发板发送板卡测试命令');
  }
  return getBoardLabRequest(record.requestId);
}

export function getBoardLabRequest(requestId: string): BoardLabRequestRecord {
  expireRequests();
  const record = requests.get(z.string().uuid().parse(requestId));
  if (!record) {
    throw new ApiError(404, 'BOARD_LAB_REQUEST_NOT_FOUND', '板卡测试请求不存在或已过期');
  }
  return record;
}

export async function getBoardLabDeviceState(deviceId: string) {
  const device = await getDevice(deviceId);
  const latestId = latestByDevice.get(deviceId);
  const latest = latestId ? getBoardLabRequest(latestId) : null;
  return {
    deviceId,
    online: device.status === 'ONLINE',
    supported: device.capabilities?.boardLab === true,
    capabilities: {
      displayControl: device.capabilities?.displayControl === true,
      sensorTelemetry: device.capabilities?.sensorTelemetry === true,
      touchTelemetry: device.capabilities?.touchTelemetry === true,
      audioPlayback: device.capabilities?.audioPlayback === true,
      bleExperiment: false,
      destructiveFlashOperations: false
    },
    latest
  };
}

export function handleBoardLabDeviceResult(requestBody: unknown): BoardLabRequestRecord | null {
  const body = BoardLabResultSchema.parse(requestBody);
  const record = requests.get(body.requestId);
  if (!record || record.deviceId !== body.deviceId || record.action !== body.action) {
    return record ?? null;
  }
  patchRequest(body.requestId, {
    status: body.status,
    message: body.message || (body.status === 'COMPLETED' ? '开发板执行完成' : '开发板执行失败'),
    result: body.result ?? null
  });
  return getBoardLabRequest(body.requestId);
}

function normalizeParams(
  action: BoardLabAction,
  params: Record<string, unknown>
): Record<string, unknown> {
  if (action === 'snapshot') return {};
  if (action === 'display_pattern') {
    return z.object({
      pattern: z.enum(['BLACK', 'WHITE', 'RED', 'GREEN', 'BLUE', 'CHECKERBOARD', 'COLOR_BARS']),
      brightnessPercent: z.number().int().min(5).max(80).default(20)
    }).parse(params);
  }
  return z.object({
    enabled: z.boolean(),
    brightnessPercent: z.number().int().min(5).max(80).default(20)
  }).parse(params);
}

function patchRequest(
  requestId: string,
  patch: Partial<Pick<BoardLabRequestRecord, 'status' | 'message' | 'result'>>
): void {
  const current = requests.get(requestId);
  if (!current) return;
  requests.set(requestId, { ...current, ...patch, updatedAt: new Date().toISOString() });
}

function expireRequests(): void {
  const now = Date.now();
  for (const record of requests.values()) {
    if (
      record.status === 'PENDING' &&
      now - new Date(record.updatedAt).getTime() > RESPONSE_TIMEOUT_MS
    ) {
      patchRequest(record.requestId, {
        status: 'FAILED',
        message: '开发板未在 15 秒内响应，请确认固件版本和 MQTT 连接'
      });
    }
  }
}

function pruneRequests(): void {
  expireRequests();
  if (requests.size < 50) return;
  const oldest = [...requests.values()]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(0, requests.size - 49);
  for (const record of oldest) {
    requests.delete(record.requestId);
    if (latestByDevice.get(record.deviceId) === record.requestId) {
      latestByDevice.delete(record.deviceId);
    }
  }
}
