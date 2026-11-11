# 东信智能浴霸 AI 项目

本仓库包含样机固件、在线语音与设备服务、产品研发中心、设备运营平台，以及研发和交付文档。当前实施路线以[项目执行基线 V1.2](docs/项目执行基线%20V1.1.md)为准；文件名保留 V1.1 是为了兼容已有链接。合同来源资料见 [`docs/reference/project-source`](docs/reference/project-source/)，历史方案和阶段成果见[研究过程与阶段成果索引](docs/研究过程与阶段成果索引.md)。

## 当前架构

```text
CI1302 麦克风 ─→ CI1302 固定词识别 ─UART─→ STM32 ─→ 负载及安全互锁
                                              ↑  ↓
独立在线麦克风/Codec ─→ ESP32-C3 ─────────── UART
                           │ Wi-Fi / MQTT / 在线音频
                           └────→ 服务端 ASR → 规则/知识库/LLM → TTS
```

- STM32 保留样机已有的负载、电机、温控、显示、遥控与安全控制，并仲裁 CI1302、面板、遥控和 C3 发来的动作。
- CI1302 负责“小东小东”唤醒与离线固定命令，经 STM32 本地执行；联网和断网时均不依赖云端。它不向 C3 提供原始 PCM 或任意自然语言文本。
- ESP32-C3 负责联网、独立在线音频、设备状态同步及 STM32 协议适配。开放式对话使用 C3 的麦克风，经服务端 ASR、规则/知识库或 LLM、TTS 完成。
- 当前样机不采用 C3 取代 STM32 或三颗 PCF8574 直接驱动负载。对应代码和设计图保留作降本预研，不作为现有样机接线依据。

详见[CI1302 经 STM32 接入与在线离线协同](docs/CI1302经STM32接入与在线离线协同%20V1.0.md)和[在线 AI 语音链路设计](docs/在线AI语音链路技术设计说明%20V1.0.md)。

## 阶段状态

| 范围 | 已有证据 | 尚未完成的验证 |
| --- | --- | --- |
| 样机控制 | C3 与 STM32 的 32 字节 UART 双向链路、照明和吹风动作及匹配回执已实测；其他控制路径有软件检查 | 其他负载、取暖、恒温及热安全需逐项保留实测记录 |
| 在线语音 | 立创 C3 音频板采集与播放、ASR/LLM/TTS 接口及本地研发中心对话已有测试入口和记录 | 正式语料准确率、整机连续会话和设备控制效果需按冻结版本测试 |
| 离线语音 | CI1302 独立开发板的唤醒、固定词和 UART 语义 ID 已观察；接入扩展代码已构建 | CI1302 → STM32 → C3 的整机时序、断网命令、去重与状态回传尚需实物联调 |
| 云端运营 | 运维网页和 API 已部署在单台 ECS 的回环试点；同机 PostgreSQL 已建库、迁移并做隔离恢复演练 | 业务主路径仍主要使用 JSON/进程状态；公网 HTTPS/MQTTS、设备接入、定期异机备份及容量测试未完成 |
| 小程序 | 仓库内有界面原型 | 微信登录、配网、绑定和生产接口暂缓，原型不计作已交付产品 |

上述证据按实物、独立开发板、软件模拟和云端试点分别记录，不能相互替代。16 路在线任务准入配置不是实测并发容量，也不代表十万台设备的上线能力。近期验证边界见[2026-11-09 备案等待期记录](docs/reports/2026-11-09-备案等待期验证记录.md)和[非小程序交付推进清单](docs/reports/2026-11-03-非小程序交付推进清单.md)。

## 工作区与入口

| 目录 | 用途 |
| --- | --- |
| [`apps/development-console`](apps/development-console/) | 产品研发中心：样机、语音、AI、批量测试及研发记录；本地研发工具 |
| [`apps/operations-console`](apps/operations-console/) | 设备运营平台：设备、告警、知识库、AI 运营及系统状态；供东信内部人员使用 |
| [`apps/api`](apps/api/) / [`apps/mqtt-broker`](apps/mqtt-broker/) | 服务端接口与设备消息服务 |
| [`firmware`](firmware/) / [`stm32-firmware`](stm32-firmware/) | C3 联网语音固件与现有样机 STM32 维护工程 |
| [`deploy`](deploy/) | 单台 ECS 试点的打包、发布、更新、回滚和数据库脚本 |
| [`docs`](docs/) | 当前方案、合同来源、历史研究与验证记录 |

本地启动（Windows PowerShell）：

```powershell
Set-Location D:\workspace\Dongxin
.\start-dev.ps1
```

默认入口为研发中心 `http://127.0.0.1:3010`、运营平台 `http://127.0.0.1:3020`、API 健康检查 `http://127.0.0.1:3077/api/health`，以及本地 MQTT `127.0.0.1:1883`。本机端口和实际串口、局域网 IP 应以启动配置及当前接线为准；固件访问电脑服务时不能填 `localhost`。启动脚本依赖 `D:\workspace\.tools` 中的 Node.js 和根目录的 `node-userinfo-shim.cjs`。

ECS 现阶段通过受限 SSH 隧道访问回环运维试点，尚非公网运营入口。部署、更新和访问方式见[试点发布说明](deploy/README.md)。第一阶段选择单台 ECS 和同机 PostgreSQL；阿里云 IoT、RDS、Redis 是否需要采用，以后续容量、可靠性与成本验证决定，不是当前必购依赖。

## 验证与安全

```powershell
.\verify-dev.ps1
npm.cmd run typecheck
npm.cmd run verify:runtime
npm.cmd run verify:db
npm.cmd run verify:knowledge
npm.cmd run verify:stm32
```

自动化检查覆盖相应软件行为，不会替代样机负载、云端公网或长期稳定性测试。串口烧录、真实负载动作和音频播放须由现场人员主动发起；危险负载不得自动批量测试。大模型输出须经结构化校验和设备安全控制，不能直接驱动负载。API Key、设备凭据、音频和备份不得提交到 Git。

完整文档导航见 [`docs/README.md`](docs/README.md)。[C3 单主控](docs/C3单主控系统架构与职责边界%20V1.0.md)、[Rev.A 硬件输入](docs/DX-AI-01%20Rev.A硬件设计输入书%20V1.0.md)和[CI 直连 C3 协议草案](docs/ESP32-C3与CI1302通信协议%20V2.0.md)保留为历史取舍记录，不是当前实施规范。
