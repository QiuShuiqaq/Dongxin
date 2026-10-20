# 东信 AI 浴霸研发测试平台

> 后续研发的功能边界和顺序以[项目执行基线 V1.1](docs/项目执行基线%20V1.1.md)为准。当前主线保留现有STM32控制，ESP32-C3负责联网和独立在线音频，CI1302只负责唤醒及离线固定命令。

仓库同时提供独立的产品研发中心和设备运营平台。当前优先验证ESP32-C3联网、STM32协议适配、C3独立在线音频、CI1302离线语义、MQTT设备接入和AI网关链路；生产阶段再替换为阿里云IoT、RDS和Redis。

项目文档统一从[文档导航](docs/README.md)进入。原始需求、商务资料、厂商手册和旧产品资料位于`docs/reference`，不作为当前研发执行基线。

研发阶段使用本地 JSON 文件和本地 MQTT Broker，测试设备与未来生产设备隔离。音频硬件尚未接入时，使用文本模拟完成控制链路验证。

## 技术栈

- 前端：React 19、Vite、Ant Design
- 后端：Node.js、Fastify、TypeScript
- 数据：项目本地 JSON 文件
- 模型接入：统一模型网关，默认配置国内 OpenAI-compatible 真实模型

## 本地运行

```bash
cd D:\workspace\Dongxin
.\start-dev.ps1
```

默认入口：

- 产品研发中心：http://127.0.0.1:3010
- 设备运营平台：http://127.0.0.1:3020
- 后端健康检查：http://127.0.0.1:3077/api/health
- MQTT Broker：mqtt://127.0.0.1:1883（局域网设备使用 `mqtt://192.168.16.146:1883`）

设备联调时，后端和 MQTT Broker 默认监听局域网地址。固件中的 `DX_GATEWAY_BASE_URL` 与 `DX_MQTT_BROKER_URI` 必须填写运行服务电脑的局域网 IPv4 地址，不能填写 `localhost` 或 `127.0.0.1`。

当前本地联调配置：`http://192.168.16.146:3077`、`mqtt://192.168.16.146:1883`、设备串口 `COM3`。

旧产品兼容测试需要时，电脑端 MCU 模拟器使用另一个串口（例如 `COM4`）：

```powershell
.\start-mcu-simulator.ps1 -List
.\start-mcu-simulator.ps1 -Port COM4
```

接线和故障注入命令见 `apps/mcu-simulator/README.md`。该模拟器不属于新C3单主控样板的量产链路。

## 平台分工

- 产品研发中心面向固件、硬件、AI和测试人员，提供系统拓扑、板卡引脚、24路PCF8574端口、固件执行链、实板联调、语音链路和交付Gate。
- 设备运营平台面向东信内部运营与售后人员，提供生产设备、激活绑定、告警售后、版本发布、AI运营、审计和基础设施状态。
- 两个前端是独立工作区和独立构建产物，后端暂时共享，但接口已按 `/api/development/*` 与 `/api/operations/*` 分域。
- 运营平台不显示烧录、串口、引脚和模拟器；研发数据不得被描述为生产可用。

详细使用方式见[研发中心与设备运营平台使用说明 V1.0](docs/研发中心与设备运营平台使用说明%20V1.0.md)。

旧混合工作台不再默认启动。过渡期需要使用尚未迁移的模型评测或产品配置工具时，可单独运行：

```powershell
npm.cmd run dev:legacy-web
```

旧工作台地址为 `http://127.0.0.1:3000`，只作为迁移期研发工具，不作为运营入口。

## 产品与语音能力

现有服务端能力包括：

- C3产品能力矩阵和安全默认值；
- CI1302唤醒词、离线命令、语义ID和资源包SHA-256；
- 草稿、资源生成、样机验证、审核、发布和回滚；
- CI1302 Wake/VAD/离线命令/未命中事件模拟；
- 不支持能力的 `UNSUPPORTED` 拒绝。

设计和东信交付入口：

- [DX-AI-01阶段技术交付文件索引 V0.4](docs/DX-AI-01阶段技术交付文件索引%20V0.4.md)
- [项目架构说明 V1.0](docs/项目架构说明%20V1.0.md)
- [东信浴霸AI平台系统设计 V1.0](docs/东信浴霸AI平台系统设计%20V1.0.md)
- [DX-AI-01 Rev.A硬件设计输入书 V1.0](docs/DX-AI-01%20Rev.A硬件设计输入书%20V1.0.md)
- [C3单主控系统架构与职责边界 V1.0](docs/C3单主控系统架构与职责边界%20V1.0.md)
- [ESP32-C3固件软件设计说明 V1.0](docs/ESP32-C3固件软件设计说明%20V1.0.md)
- [ESP32-C3与CI1302通信协议 V2.0](docs/ESP32-C3与CI1302通信协议%20V2.0.md)
- [CI1302离线语音与独立在线音频方案 V1.0](docs/CI1302离线语音与独立在线音频方案%20V1.0.md)
- [ESP32-C3与BLE本地控制终端协议 V1.0](docs/ESP32-C3与BLE本地控制终端协议%20V1.0.md)
- [浴霸控制状态机与安全规则 V1.0](docs/浴霸控制状态机与安全规则%20V1.0.md)
- [在线AI语音链路技术设计说明 V1.0](docs/在线AI语音链路技术设计说明%20V1.0.md)
- [需求-设计-实现-验证追踪矩阵 V0.4](docs/需求-设计-实现-验证追踪矩阵%20V0.4.md)
- [阶段技术状态与验证记录 V0.4](docs/阶段技术状态与验证记录%20V0.4.md)
- [AI语音专项测试计划与数据集规范 V1.0](docs/AI语音专项测试计划与数据集规范%20V1.0.md)
- [待确认参数及后续验证项 V0.4](docs/待确认参数及后续验证项%20V0.4.md)
- [东信样板硬件接口及验收要求 V1.0](docs/东信样板硬件接口及验收要求%20V1.0.md)
- [东信技术交付文件清单 V1.0](docs/东信技术交付文件清单%20V1.0.md)

AI专项测试模板位于[`docs/templates`](docs/templates)。模板数据均为待人工复核的候选数据，不代表已执行或已通过。

## 设备联调门禁

```bash
.\verify-dev.ps1
```

MQTT烟囱测试必须看到设备注册、命令接收、结果回传并最终变为 `APPLIED`。真实C3上的 `APPLIED` 目前代表文本模拟闭环；下一阶段接入统一控制HAL后，只有HAL执行和状态确认成功才报告成功。

双平台浏览器验收会检查全部桌面/手机页面、控制台错误、横向溢出、24路PCF8574定义、运营设备隔离和C3虚拟命令闭环：

```powershell
npm.cmd run verify:consoles
```

## 本地 API Key

复制 `apps/api/.env.example` 为 `apps/api/.env`，按企业采购账号填写 Key。`.env` 已被忽略，不会提交。

```bash
ARK_API_KEY=
DASHSCOPE_API_KEY=
QIANFAN_API_KEY=
DEEPSEEK_API_KEY=
ZAI_API_KEY=
HUNYUAN_API_KEY=
MOONSHOT_API_KEY=
```

## 边界

- 大模型只负责意图理解，不直接控制设备。
- 最终设备动作必须经过 JSON Schema 校验、安全规则引擎、设备状态机。
- 不在 C 盘写项目文件；Node.js 与 npm 缓存分别固定在 `D:\workspace\.tools` 和 `D:\workspace\.npm-cache`。
- 不写入真实密钥，不记录用户隐私音频。
