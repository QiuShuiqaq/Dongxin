# 东信智能浴霸 AI联网版 - WiFi模块固件

## 项目概述

ESP32-C3 WiFi联网模块固件，负责东信高端智能浴霸（直流款·AI联网版）的网络通信、云端对接、主控桥接和语音交互。

### 系统链路

```
QiuAI AI Gateway ↔ WiFi模块(本固件) ↔ 浴霸主控板MCU
     (HTTPS+JSON)        (UART固定帧)
```

### 本固件职责

| 模块 | 职责 | 当前状态 |
|------|------|------|
| wifi_manager | WiFi STA连接、断线重连、IP和信号强度读取 | 已实现首版 |
| cloud_agent | 设备注册、心跳、状态上报 | 已实现首版 |
| uart_bridge | UART1与主控板通信、32字节固定帧解析、命令分发 | 等待引脚和最终协议 |
| voice_engine | 离线固定命令、在线音频上传、TTS播报 | 等待音频硬件定义 |
| device_state | 设备状态维护，为主控回传和云端上报提供统一结构 | 已实现基础结构 |

## 硬件规格

- 主控芯片：ESP32-C3 (RISC-V, 32-bit, 160MHz)
- 无线：WiFi 2.4GHz 802.11 b/g/n
- 通信：UART1（与主控板，115200 8N1）
- 音频：麦克风输入 + 扬声器输出（语音交互）
- 电源：3.3V（由主板供电）

## 开发环境

- ESP-IDF v5.3.2
- 工具链：riscv32-esp-elf 13.2.0
- 安装路径：`D:\Program\ESP_IDF\`

## 编译与烧录

```powershell
# 1. 配置环境
# 当前使用手动安装的 Python 虚拟环境，不执行安装向导
$env:IDF_PATH = "D:\Program\ESP_IDF\esp_idf"
$env:IDF_TOOLS_PATH = "D:\Program\ESP_IDF\tools"
$env:IDF_PYTHON_ENV_PATH = "D:\Program\ESP_IDF\python_env"
$env:IDF_SKIP_CHECK_SUBMODULES = "1"

# 2. 进入固件目录
cd F:\Workspace_VS\QiuAi-qiye\Dongxin\firmware

# 3. 设置目标芯片（首次构建 C3 时执行）
idf.py set-target esp32c3

# 4. 编译 C3
& "D:\Program\ESP_IDF\python_env\Scripts\python.exe" `
  "D:\Program\ESP_IDF\esp_idf\tools\idf.py" build

# 5. 烧录 C3（COM3改为实际串口号）
& "D:\Program\ESP_IDF\python_env\Scripts\python.exe" `
  "D:\Program\ESP_IDF\esp_idf\tools\idf.py" -p COM3 flash

# 6. 串口监视 C3
& "D:\Program\ESP_IDF\python_env\Scripts\python.exe" `
  "D:\Program\ESP_IDF\esp_idf\tools\idf.py" -p COM3 monitor

# S3 使用独立构建目录和 sdkconfig.s3，不要覆盖 C3 的 build 目录
& "D:\Program\ESP_IDF\python_env\Scripts\python.exe" `
  "D:\Program\ESP_IDF\esp_idf\tools\idf.py" `
  -B build-s3-verify2 `
  -D SDKCONFIG="$PWD\sdkconfig.s3" `
  build

# S3 烧录和串口监视（COM3改为实际串口号）
& "D:\Program\ESP_IDF\python_env\Scripts\python.exe" `
  "D:\Program\ESP_IDF\esp_idf\tools\idf.py" `
  -B build-s3-verify2 -p COM3 flash
& "D:\Program\ESP_IDF\python_env\Scripts\python.exe" `
  "D:\Program\ESP_IDF\esp_idf\tools\idf.py" `
  -B build-s3-verify2 -p COM3 monitor
```

## 目录结构

```
firmware/
├── CMakeLists.txt          # 项目构建配置
├── README.md               # 本文件
└── main/
    ├── CMakeLists.txt      # 主组件构建配置
    ├── app_main.c          # 主入口（系统初始化+主循环）
    ├── wifi_manager.c/h    # WiFi管理模块
    ├── cloud_agent.c/h     # 云端通信代理
    ├── uart_bridge.c/h     # UART主控桥接
    ├── voice_engine.c/h    # 语音引擎
    └── device_state.c/h    # 设备状态管理
```

## 板型选择

工程会根据当前构建目录的 ESP-IDF 目标自动选择 C3 或 S3 板级配置：

- `build`：`esp32c3`，输出 C3 固件和设备 ID；
- `build-s3-verify2`：`esp32s3`，输出 S3 自检固件和独立设备 ID。

构建时不需要手动修改 `main/app_config.h` 中的 `DX_TARGET_BOARD`。

## 当前首轮联调范围

本版本先验证 C3 本身能否稳定完成以下链路：

```text
C3 上电
  -> 连接 2.4GHz WiFi
  -> POST /api/device/v1/register
  -> POST /api/device/v1/heartbeat
  -> POST /api/device/v1/state
  -> 后台显示设备在线
```

请先在 `main/app_config.h` 中填写：

```c
#define DX_WIFI_SSID "实际WiFi名称"
#define DX_WIFI_PASSWORD "实际WiFi密码"
#define DX_GATEWAY_BASE_URL "http://运行后端电脑的局域网IP:3077"
```

后端地址不能填写 `localhost` 或 `127.0.0.1`。C3 访问电脑服务时必须使用电脑在同一局域网内的 IPv4 地址。

## 当前未启用内容

- `DX_ENABLE_UART_BRIDGE` 默认关闭，原因是东信尚未确认 C3 与主控板的 TX/RX 引脚和最终串口参数。
- `DX_ENABLE_AUDIO` 默认关闭，原因是麦克风、扬声器和音频编解码器的具体接线尚未确认。
- 本版本不在 C3 内运行通用 ASR 或 LLM，也不把任何 API Key 写入固件。
- 当前状态中的温度、湿度、人感和故障码在主控协议接入前只保留字段，不代表已经从真实传感器读取。

## 版本历史

- v0.2.0 (2026-09-03)：完成 C3 WiFi、设备注册、心跳、基础状态上报和统一状态结构
