# QiuAI AI Gateway 第一阶段接口说明

本文记录当前代码已经落地的第一阶段接口，方便企业后台、语音模块、小程序和后续真实设备联调时对接。

## 运行

```bash
npm run dev
```

- Web 后台：`http://127.0.0.1:5173/`
- API 服务：`http://127.0.0.1:3077`
- 健康检查：`GET /api/health`

## 基础测试台

保留原有测试接口：

| 接口 | 说明 |
| --- | --- |
| `GET /api/bootstrap` | 后台初始化数据，包含模型、Prompt、测试语料、设备、知识库、主动沟通配置和最近日志 |
| `GET /api/providers` / `PUT /api/providers` | 模型供应商配置 |
| `GET /api/providers/secret-status` | API Key 配置状态 |
| `PUT /api/providers/:providerId/api-key` | 写入本地 `apps/api/.env` |
| `GET /api/prompts` | Prompt 版本 |
| `GET /api/test-cases` | 测试语料 |
| `POST /api/chat/test` | 单句 AI 意图测试 |
| `POST /api/evaluations/run` | 批量评测 |

## 设备接口

当前先接模拟设备，真实样机接入后替换设备适配层。

| 接口 | 说明 |
| --- | --- |
| `GET /api/devices` | 设备清单 |
| `GET /api/devices/:deviceId` | 设备档案 |
| `GET /api/devices/:deviceId/state` | 当前设备状态 |
| `POST /api/devices/:deviceId/events` | 设备状态、雷达、人感、故障等事件上报 |
| `POST /api/devices/:deviceId/commands` | 后台直接下发测试命令 |

## 设备端 V1 接入接口

设备端接口用于 WiFi 联网模块接入真实样机联调，统一返回：

```json
{
  "success": true,
  "requestId": "req_001",
  "serverTime": "2026-08-16T10:00:00.000Z",
  "data": {}
}
```

| 接口 | 说明 |
| --- | --- |
| `POST /api/device/v1/register` | 设备注册，写入或更新设备档案 |
| `POST /api/device/v1/heartbeat` | 设备心跳，刷新在线状态 |
| `GET /api/device/v1/config?deviceId=...` | 获取轮询、心跳、超时等配置 |
| `POST /api/device/v1/state` | 设备状态上报，更新当前设备状态 |
| `POST /api/device/v1/events` | 雷达、人感、故障等事件上报，可触发主动沟通 |
| `POST /api/device/v1/voice-turn` | 语音识别文本上传，返回播报文本和控制动作 |
| `GET /api/device/v1/commands/poll?deviceId=...&limit=5` | 设备轮询待执行命令 |
| `POST /api/device/v1/commands/result` | 上报 MCU 执行结果 |

语音文本上传示例：

```json
{
  "deviceId": "demo-bath-heater-001",
  "sessionId": "voice_001",
  "text": "我有点冷",
  "asrConfidence": 0.91,
  "reportedState": {
    "ambientTemperature": 24,
    "humidity": 70,
    "hasOccupancy": true,
    "faultCode": null
  }
}
```

返回核心字段：

- `replyText`：播报文本；
- `needConfirm`：是否需要二次确认；
- `confirmToken`：确认令牌；
- `source`：`rule` / `knowledge` / `llm` / `confirm`；
- `actions`：WiFi 模块需要转换为 MCU 固定帧的标准动作；
- `usage`：是否调用 LLM、token、费用和耗时。

## 语音入口

第一阶段不做服务端音频 ASR，默认接收东信语音模块输出的识别文本。

`POST /api/voice/turn`

请求核心字段：

```json
{
  "deviceId": "demo-bath-heater-001",
  "providerId": "mock-local",
  "promptId": "bath-heater-intent-v1",
  "text": "有点冷",
  "applyToDevice": true
}
```

返回包括：

- `replyText`：返回给语音模块播报的文本；
- `aiResult`：大模型结构化意图；
- `safetyResult`：安全规则结果；
- `deviceState`：执行后的设备状态；
- `commandRecord`：本次控制记录。

## 知识库

| 接口 | 说明 |
| --- | --- |
| `GET /api/knowledge/documents` | 知识库资料列表 |
| `POST /api/knowledge/documents` | 新增资料 |
| `POST /api/knowledge/query` | 知识库问答测试 |

当前使用轻量关键词检索。资料不存在或无法匹配时，统一返回“建议联系官方售后”的兜底回答，不再继续走 LLM。

## 主动沟通

| 接口 | 说明 |
| --- | --- |
| `GET /api/proactive/settings` | 主动沟通设置 |
| `PATCH /api/proactive/settings` | 更新开关、模式、频率和安静时段 |
| `POST /api/proactive/events` | 雷达、人感、温湿度等触发事件 |
| `GET /api/proactive/logs` | 主动沟通日志 |

主动沟通不会直接执行设备动作。涉及控制时，只返回建议动作和确认话术。

## 日志

`GET /api/logs?type=VOICE&limit=50`

日志类型包括：

- `VOICE`
- `AI`
- `DEVICE`
- `COMMAND`
- `KNOWLEDGE`
- `PROACTIVE`
- `ERROR`

## 本地数据

开发期继续使用 `data/*.json`：

- `devices.json`
- `device-events.json`
- `device-commands.json`
- `knowledge-documents.json`
- `proactive-settings.json`
- `system-logs.json`

JSON 写入已改为唯一临时文件名，避免多个接口首次初始化数据时抢同一个 `.tmp` 文件。
