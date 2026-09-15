# 东信 AI 浴霸 ESP32 固件

## 目标架构

ESP32-C3 是量产首选和唯一业务主控，直接负责设备状态机、低压控制接口、WiFi、BLE配网/本地终端、MQTT、传感器和在线音频转发。CI1302负责麦克风、降噪、VAD、离线唤醒/命令和播放。

```text
CI1302语音 ─────┐
BLE墙面板/遥控器 ┼→ C3统一命令队列 → 安全状态机 → direct_control_hal → 3 x PCF8574/GPIO/ADC
MQTT平台 ───────┘
```

新样板不再包含独立浴霸MCU。`uart_bridge`、32字节旧协议和MCU模拟器作为历史兼容/测试资产保留，不是新架构的控制主链路。ESP32-S3构建继续保留为研发对照和量产备选。

详细基线：

- `../docs/C3单主控系统架构与职责边界 V1.0.md`
- `../docs/ESP32-C3与CI1302通信协议 V1.0.md`
- `../docs/ESP32-C3与BLE本地控制终端协议 V1.0.md`
- `../docs/浴霸控制状态机与安全规则 V1.0.md`
- `../docs/东信样板硬件接口及验收要求 V1.0.md`

## 当前代码状态

| 模块 | 当前状态 |
|---|---|
| `wifi_manager` | C3 WiFi STA、断线重连已验证 |
| `mqtt_agent` | 本地MQTT注册、命令、结果、状态和幂等已验证 |
| `cloud_agent` | HTTP研发兼容通道 |
| `device_command` | MQTT/HTTP命令统一进入命令队列，保留旧UART兼容分支 |
| `command_queue` | 已统一MQTT、CI、BLE、定时和安全来源，当前为同步执行接口 |
| `device_controller` | 已实现风机/取暖/换气互锁、散热、最长运行、定时和干燥上限 |
| `direct_control_hal` | SuperMini默认虚拟HAL；真实PCF引脚未冻结时禁止启用 |
| `pcf8574` | 已实现3颗设备初始化、整字节影子输出、全关和健康检查 |
| `device_state` | 已维护基础全量状态；NTC有效性和期望/实际状态待样板阶段扩展 |
| `uart_bridge` | 旧MCU协议测试资产；新架构下不驱动浴霸主控 |
| `voice_engine` | 当前为桩，待接CI1302 UART控制和I2S PCM |
| `board_profile` | 支持C3/S3并报告控制、CI和BLE链路 |

当前 C3 SuperMini 返回 `executionPath=LOCAL_VIRTUAL`。它证明命令队列和安全状态机执行，不代表真实PCF电平、驱动或220V负载执行。

## 开发环境

- ESP-IDF v5.3.2：`D:\Espressif\frameworks\esp-idf-v5.3.2`
- C3开发板：ESP32-C3 SuperMini HW-466AB
- 串口：COM3
- 固件目录：`D:\workspace\Dongxin\firmware`

## 构建、烧录和退出监视器

在 PowerShell 中切换盘符和目录，不能只使用传统CMD的 `cd D:\...`：

```powershell
Set-Location D:\workspace\Dongxin\firmware
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build-and-flash.ps1
```

菜单选择 `3` 执行构建、烧录和监视。串口监视器中按 `Ctrl+]` 退出；不是 `Ctrl+C`。

脚本默认使用COM3和D盘ESP-IDF，可通过 `-Port` 覆盖串口。C3首次切换目标选择 `1`，普通构建选择 `2`。
烧录/监视前脚本会检查端口是否存在；若显示 `no serial ports detected`，先重新插入开发板再执行。

也可以不进入菜单：

```powershell
.\build-and-flash.ps1 -Action build
.\build-and-flash.ps1 -Action flash-monitor -Port COM3
.\build-and-flash.ps1 -Action s3-build
```

`s3-build` 使用独立的 `build-s3-verify2` 目录，不改变默认C3构建目录。

## 联调配置

当前研发环境：

```c
#define DX_WIFI_SSID "TP-LINK_3DB722"
#define DX_WIFI_PASSWORD ""
#define DX_GATEWAY_BASE_URL "http://192.168.16.146:3077"
#define DX_MQTT_BROKER_URI "mqtt://192.168.16.146:1883"
```

后端地址必须使用同一局域网电脑IP，不能在C3固件中填写 `localhost` 或 `127.0.0.1`。生产固件不得硬编码家庭WiFi和研发服务器地址，后续由BLE配网和环境配置替代。

## 当前代码结构与下一步

```text
main/
├── command_queue.c/h          统一命令、来源、优先级、幂等和超时
├── device_controller.c/h      状态变更、互锁、散热、时限和HAL协调
├── direct_control_hal.c/h     虚拟/真实板级控制接口
├── pcf8574.c/h                3颗PCF8574低速IO
├── ci1302_protocol.c/h        下一步：UART事件、CRC、ACK和链路状态
├── ci1302_audio.c/h           下一步：I2S PCM采集与播放
├── ble_local_control.c/h      下一步：墙面板/遥控器GATT与绑定
├── temperature_sensor.c/h     NTC采样、滤波和故障
└── board_profile.*            C3/S3/东信样板能力和引脚
```

先实现虚拟HAL和测试，再绑定东信样板的真实引脚。危险负载参数不能在无原理图和热测试时猜测。

## 板型

- `build`：ESP32-C3主线；
- `build-s3-verify2`：ESP32-S3-N16R8备选；
- 东信量产样板：原理图确认后新增独立profile，不覆盖SuperMini配置。

## 版本记录

- v0.2.0：C3 WiFi、设备注册、心跳和基础状态；
- v0.3.0：本地MQTT和文本模拟控制闭环；
- v0.3.1：旧MCU UART ACK/重试测试资产；
- v0.4.0：C3单主控统一队列、安全控制器、虚拟HAL和3颗PCF8574驱动；
- 下一版本：CI1302控制/I2S骨架、BLE本地终端和NTC故障注入。
