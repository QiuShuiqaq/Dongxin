# 东信智能浴霸 AI 大模型融合创新项目系统架构设计方案

版本：V1.0 架构设计稿  
日期：2026-08-06  
用途：用于正式开发前确认系统架构、模块边界和重构方向。本文只做架构设计，不代表已经开始代码改造。

---

## 一、设计目标

本系统要在现有测试平台基础上，扩展成可以真实接入样机、服务器、小程序和企业后台的 AI 浴霸系统。

本阶段主要目标：

1. 保留当前已有的模型测试、Prompt、安全规则、设备模拟能力；
2. 增加真实设备接入能力；
3. 增加企业后台，用于知识库、测试语料、日志和配置管理；
4. 增加微信小程序接口，用于消费者端展示和控制；
5. 增加主动沟通能力，支持雷达/人感触发；
6. 将大模型输出统一变成结构化控制意图，再经过安全规则后下发设备；
7. 后续可扩展 RAG、模型切换、设备管理和长期维护。

本项目不把 WiFi 模块设计成直接调用大模型。设备端只负责采集、识别、上报和执行；大模型 API Key、Prompt、安全规则、知识库和日志都放在服务器。

---

## 二、当前项目基础

当前目录已经有一个初步测试平台：

| 位置 | 当前作用 | 后续处理 |
| --- | --- | --- |
| `apps/api` | Fastify API，支持模型供应商、Prompt、测试语料、模拟设备、安全规则 | 扩展为 AI Gateway 服务端 |
| `apps/web` | React + Ant Design X 企业测试页面 | 扩展为企业后台 |
| `packages/shared` | 共享类型和 Zod Schema | 扩展为统一接口契约和数据模型 |
| `data` | 本地 JSON 数据 | 开发期可继续用，真实服务器阶段迁移到数据库 |
| `deviceSimulator.ts` | 模拟设备状态和控制 | 保留为开发调试用，增加真实设备适配层 |
| `modelGateway.ts` | 统一调用 OpenAI-compatible 模型 | 保留并扩展供应商、超时、重试和调用日志 |
| `rules.ts` | 安全规则校验 | 保留并扩展为安全规则服务 |

当前基础适合继续演进，不需要从零重建。

---

## 三、目标系统结构

建议目标结构如下：

```text
微信小程序
    |
企业后台
    |
语音模块识别文本 / 雷达事件 / 设备状态
    |
    v
QiuAI AI Gateway
    |
    |-- 设备接入服务
    |-- 大模型服务
    |-- 意图解析服务
    |-- 安全规则服务
    |-- 企业知识库服务
    |-- 主动沟通服务
    |-- 日志和测试服务
    |
    v
设备通信层 MQTT / HTTP / WebSocket 适配
    |
    v
WiFi 模块 / MCU / 浴霸电控系统
```

### 3.1 系统分层

| 层级 | 作用 |
| --- | --- |
| 设备层 | 浴霸主控、WiFi 模块、语音模块、雷达/人感、温湿度、故障状态 |
| 接入层 | 设备状态上报、控制指令下发、雷达事件上报、语音文本接收 |
| AI Gateway | 意图解析、模型调用、安全规则、知识库、主动沟通、日志 |
| 管理层 | 企业后台，用于测试、配置、资料维护和日志查看 |
| 用户层 | 微信小程序，用于设备控制、AI 问答、主动沟通设置 |

---

## 四、仓库结构建议

在现有 monorepo 基础上扩展，不建议推倒重来。

建议目标结构：

```text
apps/
  api/                  # AI Gateway 服务端
  web/                  # 企业后台
  miniapp/              # 微信小程序，建议后续新增

packages/
  shared/               # 共享类型、Schema、接口契约
  device-protocol/      # 后续可选：设备协议适配
  ai-core/              # 后续可选：模型、意图、安全规则、RAG 核心逻辑

data/                   # 开发期本地数据
docs/                   # 架构、接口、部署和验收文档
```

第一阶段不一定马上拆出 `device-protocol` 和 `ai-core` 包。可以先在 `apps/api/src` 内按模块拆分，等代码稳定后再抽包。

---

## 五、服务端模块设计

`apps/api` 后续作为 QiuAI AI Gateway，建议拆成以下模块：

| 模块 | 说明 |
| --- | --- |
| `auth` | 企业后台登录、小程序用户登录、接口鉴权 |
| `devices` | 设备注册、设备状态、设备绑定、在线状态 |
| `device-events` | 雷达/人感、温湿度、故障、运行状态事件 |
| `commands` | 控制指令生成、下发、确认、执行结果记录 |
| `voice` | 接收语音模块识别文本，返回播报文本和控制结果 |
| `model-gateway` | 统一接入豆包、通义、DeepSeek 等模型 |
| `intent` | 将用户表达转换为设备控制意图 |
| `safety` | 动作白名单、二次确认、高风险限制、异常拦截 |
| `knowledge` | 文档上传、切分、检索、RAG 问答 |
| `proactive` | 主动沟通触发、频率限制、话术生成、确认流程 |
| `logs` | AI 对话日志、设备控制日志、主动沟通日志 |
| `evaluations` | 模型评测、测试语料、测试结果 |
| `configs` | 模型配置、Prompt、主动沟通模式、安全规则配置 |

### 5.1 当前代码重构方向

当前 `apps/api/src/index.ts` 已经包含很多路由和业务逻辑。后续建议拆成：

```text
apps/api/src/
  server.ts
  routes/
    health.routes.ts
    providers.routes.ts
    prompts.routes.ts
    evaluations.routes.ts
    devices.routes.ts
    voice.routes.ts
    miniapp.routes.ts
    admin.routes.ts
    knowledge.routes.ts
    proactive.routes.ts
  services/
    modelGateway.service.ts
    intent.service.ts
    safety.service.ts
    device.service.ts
    command.service.ts
    knowledge.service.ts
    proactive.service.ts
    log.service.ts
  adapters/
    deviceSimulator.adapter.ts
    mqtt.adapter.ts
    httpDevice.adapter.ts
    openaiCompatible.adapter.ts
  repositories/
    provider.repository.ts
    device.repository.ts
    knowledge.repository.ts
    log.repository.ts
```

开发初期可以先保留 JSON 存储，新增 Repository 层。这样后面从 JSON 切到 PostgreSQL 时，不需要大面积改业务逻辑。

---

## 六、通信协议设计

### 6.1 设备和服务器

建议优先支持 MQTT，保留 HTTP 适配能力。

| 场景 | 推荐方式 | 说明 |
| --- | --- | --- |
| 设备状态上报 | MQTT | 设备在线后持续上报状态 |
| 雷达/人感事件 | MQTT | 有人进入、离开、停留等事件实时上报 |
| 控制指令下发 | MQTT | 服务器向设备下发控制动作 |
| 联调阶段临时接入 | HTTP | 如果设备暂时不支持 MQTT，可先用 HTTP 调试 |

建议 Topic：

```text
dx/bath-heater/{deviceId}/state
dx/bath-heater/{deviceId}/event
dx/bath-heater/{deviceId}/command
dx/bath-heater/{deviceId}/command-result
dx/bath-heater/{deviceId}/voice
dx/bath-heater/{deviceId}/reply
```

### 6.2 语音模块和服务器

第一阶段不建议把音频流上传作为主线。甲方已有语音模块，优先让语音模块提供识别结果。

推荐第一阶段接口：

```text
语音模块 -> 服务器：识别文本 / 设备 ID / 会话 ID / 当前设备状态
服务器 -> 语音模块：播报文本 / 是否需要确认 / 控制结果
```

待确认：

1. 语音模块输出文本、意图还是设备命令；
2. TTS 是否由语音模块完成；
3. 语音模块和服务器用 HTTP、MQTT 还是 WebSocket；
4. 语音模块能否携带设备 ID、会话 ID、唤醒来源和识别置信度。

### 6.3 小程序和服务器

小程序使用 HTTPS REST API。

主要接口：

```text
POST /api/miniapp/login
GET  /api/miniapp/devices
GET  /api/miniapp/devices/:deviceId/state
POST /api/miniapp/devices/:deviceId/commands
POST /api/miniapp/chat
GET  /api/miniapp/help/search
GET  /api/miniapp/proactive-settings
PATCH /api/miniapp/proactive-settings
```

### 6.4 企业后台和服务器

企业后台使用 HTTPS REST API。

主要接口：

```text
POST /api/admin/login
GET  /api/admin/devices
GET  /api/admin/devices/:deviceId/logs
GET  /api/admin/model-providers
PUT  /api/admin/model-providers
GET  /api/admin/prompts
POST /api/admin/prompts
GET  /api/admin/knowledge-documents
POST /api/admin/knowledge-documents
POST /api/admin/ai-test
GET  /api/admin/test-cases
POST /api/admin/evaluations/run
GET  /api/admin/proactive-rules
PUT  /api/admin/proactive-rules
GET  /api/admin/safety-rules
PUT  /api/admin/safety-rules
```

---

## 七、核心数据模型

真实服务器阶段建议使用 PostgreSQL。第一阶段也可以先用 SQLite 或 JSON 过渡，但如果要直接部署真实服务器，建议从 PostgreSQL 开始。

建议主要数据表：

| 表 | 说明 |
| --- | --- |
| `admin_users` | 企业后台管理员 |
| `miniapp_users` | 小程序用户 |
| `devices` | 设备基础信息 |
| `device_bindings` | 小程序用户和设备绑定关系 |
| `device_states` | 当前设备状态 |
| `device_events` | 状态上报、雷达/人感、故障等事件 |
| `device_commands` | 控制指令、下发状态、执行结果 |
| `voice_sessions` | 语音会话 |
| `ai_interactions` | 用户输入、模型输出、安全校验、回复文本 |
| `model_providers` | 模型供应商配置 |
| `prompt_versions` | Prompt 版本 |
| `safety_rules` | 安全规则配置 |
| `knowledge_documents` | 知识库文档 |
| `knowledge_chunks` | 文档切分片段 |
| `knowledge_embeddings` | 向量索引，后续可用 pgvector |
| `test_cases` | 测试语料 |
| `evaluation_runs` | 模型评测记录 |
| `proactive_rules` | 主动沟通规则 |
| `proactive_events` | 主动沟通触发和执行记录 |
| `system_configs` | 系统配置 |

API Key 不建议明文保存在数据库。开发阶段可放服务器环境变量；后续如需要后台配置，应加密保存。

---

## 八、AI 控制链路

### 8.1 统一处理流程

```text
输入文本
  |
  v
会话上下文加载
  |
  v
知识库检索，按场景决定是否需要
  |
  v
调用大模型
  |
  v
解析结构化 JSON
  |
  v
安全规则校验
  |
  v
需要确认？ -> 返回确认话术
  |
  v
通过校验 -> 生成控制指令
  |
  v
下发设备 / 返回小程序 / 返回语音播报文本
```

### 8.2 LLM 输出格式建议

建议扩展当前 `AiResult`，从单一 `intent` 逐步升级为支持多动作和来源引用。

第一阶段可以先保持简单：

```json
{
  "resultType": "DEVICE_CONTROL",
  "intent": "HEAT_WEAK_ON",
  "confidence": 0.88,
  "slots": {
    "temperature": null,
    "durationMinutes": null
  },
  "requiresConfirm": false,
  "speak": "有点冷的话，我先帮你开弱暖。"
}
```

后续扩展为：

```json
{
  "type": "CONTROL",
  "confidence": 0.88,
  "needConfirm": true,
  "riskLevel": "MEDIUM",
  "actions": [
    {
      "target": "heater",
      "command": "ON",
      "mode": "WEAK"
    }
  ],
  "replyText": "有点冷的话，我可以先帮你开弱暖，要打开吗？",
  "sourceRefs": []
}
```

第一阶段可以不急着改成多动作结构，但设计上要预留。

---

## 九、安全规则设计

安全规则必须独立于大模型。大模型只给建议，安全规则决定能不能执行。

规则建议：

| 规则 | 说明 |
| --- | --- |
| 动作白名单 | 只允许执行系统定义过的浴霸动作 |
| 温度范围 | 设定温度限制在样机支持范围内 |
| 高功率确认 | 强暖、长时间运行等动作可要求二次确认 |
| 故障阻断 | 设备有故障码时阻断取暖等高风险动作 |
| 离线阻断 | 设备离线时不下发控制指令 |
| 模式互斥 | 互斥模式不能同时开启 |
| 夜间策略 | 夜间主动播报和高功率动作可限制 |
| 频率限制 | 主动沟通不能频繁触发 |
| 未知表达 | 模型低置信度时不执行动作，要求用户补充说明 |

当前 `rules.ts` 已经有温度范围、强暖确认、故障阻断、离线阻断等基础逻辑，可以继续扩展。

---

## 十、主动沟通设计

主动沟通由服务器判断，不建议设备端自行生成复杂话术。

### 10.1 输入条件

主动沟通服务接收：

- 雷达/人感状态；
- 当前时间；
- 浴室温度；
- 湿度；
- 当前运行模式；
- 用户是否开启主动沟通；
- 用户选择的沟通模式；
- 最近一次播报时间。

### 10.2 第一阶段场景

建议先做 3 个场景：

| 场景 | 触发 | 处理 |
| --- | --- | --- |
| 进入浴室问候 | 人感从无人变为有人 | 生成一句简短问候，可询问是否需要弱暖 |
| 环境提醒 | 湿度高、温度低或停留时间较长 | 提醒是否开启换气或弱暖 |
| 运行提醒 | 强暖运行较久或人离开后仍运行 | 提醒切换弱暖或关闭 |

主动沟通输出也必须经过安全规则。涉及控制动作时，默认要求用户确认。

---

## 十一、企业知识库设计

知识库第一阶段不要做得过重，但要能维护资料。

建议流程：

```text
后台上传资料
  |
  v
资料分类
  |
  v
文档切分
  |
  v
保存文本片段
  |
  v
问答时检索相关片段
  |
  v
大模型基于资料回答
```

第一阶段可以先使用普通关键词检索或简单向量检索。资料量上来后，再引入 pgvector 或专门向量库。

问答规则：

- 只基于东信资料回答；
- 没有资料时提示联系官方售后；
- 维修、安全、拆机问题不直接给危险指导；
- 回答日志要保存，方便售后资料持续补充。

---

## 十二、企业后台设计

企业后台基于现有 `apps/web` 扩展。

建议页面：

| 页面 | 功能 |
| --- | --- |
| 登录 | 内部账号登录 |
| 首页 | 样机状态、最近日志、模型调用概览 |
| 设备管理 | 设备状态、在线情况、故障码、传感器数据 |
| AI 测试台 | 输入语料，查看模型输出、安全校验、控制结果 |
| 模型配置 | 模型供应商、API Key 状态、模型参数 |
| Prompt 管理 | Prompt 版本、启用状态 |
| 知识库管理 | 文档上传、分类、切分、更新 |
| 问答测试 | 测试知识库回答 |
| 主动沟通配置 | 开关、模式、场景、频率、话术 |
| 安全规则 | 白名单、高风险动作、确认规则 |
| 日志记录 | AI 日志、设备日志、控制日志、主动沟通日志 |
| 测试语料 | 控制语料、问答语料、安全测试语料 |

---

## 十三、微信小程序设计

小程序建议新增 `apps/miniapp`。技术上可以选：

| 方案 | 说明 |
| --- | --- |
| 原生微信小程序 | 依赖少，稳定，适合简单小程序 |
| Taro + React | 可复用 TypeScript 思路，适合和当前 React 项目统一 |

如果目标是 6 周内稳定展示，建议优先考虑原生微信小程序或 Taro 的轻量写法，不做复杂跨端架构。

第一阶段页面：

| 页面 | 功能 |
| --- | --- |
| 登录/授权 | 微信授权，获取用户身份 |
| 我的设备 | 展示测试设备或已绑定设备 |
| 设备面板 | 开关、模式、温度、湿度、是否有人、故障状态 |
| 控制面板 | 照明、弱暖、强暖、换气、吹风、摆风、待机、温度调节 |
| AI 对话 | 输入控制表达或产品问题 |
| 产品帮助 | 常见问题、使用说明、售后问答 |
| 主动沟通设置 | 开关、模式、安静时段 |

---

## 十四、部署架构

第一阶段真实服务器建议：

```text
Nginx
  |
  |-- API 服务 Fastify
  |-- 企业后台静态资源
  |-- 小程序 HTTPS API

PostgreSQL
MQTT Broker
文件目录 / 对象存储
```

推荐组件：

| 组件 | 建议 |
| --- | --- |
| 后端 | Node.js + Fastify，沿用当前项目 |
| 后台 | React + Ant Design X，沿用当前项目 |
| 小程序 | 原生微信小程序或 Taro |
| 数据库 | PostgreSQL |
| MQTT | Mosquitto 或云厂商 MQTT 服务 |
| 反向代理 | Nginx |
| 进程管理 | PM2 或 Docker Compose |

第一阶段可以一台服务器部署。后续量产或用户量增加后，再拆分服务和数据库。

---

## 十五、从当前项目到目标架构的实施顺序

### 第一步：整理服务端结构

不改业务功能，先把 `index.ts` 中路由和业务逻辑拆开：

- routes；
- services；
- adapters；
- repositories；
- shared schemas。

### 第二步：抽象存储层

先保留 JSON 文件，但统一通过 Repository 调用。后续切 PostgreSQL 时，只替换 Repository 实现。

### 第三步：扩展设备模型

从当前单一模拟设备扩展为：

- deviceId；
- 设备状态；
- 设备事件；
- 控制指令；
- 指令执行结果；
- 雷达/人感事件。

### 第四步：增加真实设备接入适配

先实现 HTTP 适配或 MQTT 适配，具体取决于东信样机能力。

### 第五步：升级 AI 处理链路

从 `/api/chat/test` 扩展为统一 AI Orchestrator：

```text
输入 -> 模型 -> 结构化结果 -> 安全规则 -> 控制指令 -> 日志
```

### 第六步：增加知识库模块

先做资料上传、分类、文本切分和问答检索。

### 第七步：增加主动沟通模块

从设备事件触发，经过规则判断和频率限制，再生成播报文本。

### 第八步：扩展企业后台

把现有测试平台扩展为项目后台。

### 第九步：新增微信小程序

做消费者端展示、设备控制、AI 问答和主动沟通设置。

---

## 十六、第一阶段不建议做的内容

为了保证 6 周内能落地，第一阶段不建议做：

1. 服务端实时 ASR 音频流完整方案；
2. 自研语音降噪、回声消除、唤醒词；
3. 完整云平台；
4. 原生手机 APP；
5. 多租户系统；
6. 多型号设备大规模兼容；
7. OTA；
8. 完整售后工单系统；
9. 真正的用户行为学习模型；
10. 复杂 BI 统计分析。

这些内容可以在样机验证完成后，再按产品化阶段规划。

---

## 十七、需要东信优先确认的问题

正式开始开发前，建议先和东信技术人员确认：

1. 设备和服务器用 MQTT、HTTP、WebSocket 还是其他协议；
2. WiFi 模块是否能稳定连接指定服务器；
3. 设备状态字段，包括模式、温度、湿度、是否有人、故障码；
4. 控制指令格式；
5. 语音模块输出文本、意图还是命令；
6. TTS 播报由谁完成；
7. 雷达/人感事件字段；
8. 小程序账号、服务器、域名、证书和备案情况；
9. 第一批产品资料提供时间；
10. 高风险动作是否需要二次确认。

---

## 十八、架构结论

本项目应以 `QiuAI AI Gateway` 为中心，把设备、语音模块、小程序、企业后台和大模型统一接起来。

当前项目已有测试平台基础，可以继续使用：

- `apps/api` 扩展为 AI Gateway；
- `apps/web` 扩展为企业后台；
- `packages/shared` 扩展为统一接口契约；
- 新增 `apps/miniapp` 做微信小程序；
- 增加数据库、MQTT、知识库和真实设备适配。

正式开始前，先确认设备协议、语音模块输出和服务器资源。确认后再进入代码重构和功能开发。

