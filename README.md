# 东信 AI 浴霸研发测试平台

> 后续研发的芯片选型、功能边界和 Gate 顺序以 [项目范围与技术决策基线 V1.0](docs/项目范围与技术决策基线%20V1.0.md) 为准。当前量产主线是 `ESP32-C3` 唯一业务主控 + `CI1302` 语音前端，不再使用独立浴霸 MCU。

仓库同时提供独立的产品研发中心和设备运营平台。当前优先验证 ESP32-C3 联网和直接控制、CI1302语音协议、MQTT设备接入和AI网关链路；生产阶段再替换为阿里云IoT、RDS和Redis。

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

- [C3单主控系统架构与职责边界 V1.0](docs/C3单主控系统架构与职责边界%20V1.0.md)
- [ESP32-C3与CI1302通信协议 V1.0](docs/ESP32-C3与CI1302通信协议%20V1.0.md)
- [ESP32-C3与BLE本地控制终端协议 V1.0](docs/ESP32-C3与BLE本地控制终端协议%20V1.0.md)
- [浴霸控制状态机与安全规则 V1.0](docs/浴霸控制状态机与安全规则%20V1.0.md)
- [东信样板硬件接口及验收要求 V1.0](docs/东信样板硬件接口及验收要求%20V1.0.md)
- [东信技术交付文件清单 V1.0](docs/东信技术交付文件清单%20V1.0.md)

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
