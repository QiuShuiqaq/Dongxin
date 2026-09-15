# 东信智能浴霸固件开发 - 基于小智 AI 硬件的快速验证方案

> 备选实验文档：小智/ES8311仅保留为音频与S3对照测试资产。量产主线使用ESP32-C3 + CI1302，C3侧不再重复放置ES8311。

## 🎯 方案概述

你已经拥有一个**淘宝购买的"小智 AI"ESP32-C3 成品硬件**，这是一个完整的语音交互设备，包含：
- ESP32-C3 芯片
- ES8311 音频 Codec (麦克风 + 扬声器)
- SSD1306 OLED 显示屏
- 电池管理
- 完整的固件代码（xiaozhi-esp32 v2.2.4）

**关键优势**：
- ✅ 硬件已经验证可用（麦克风、扬声器、WiFi 都能工作）
- ✅ 有完整的音频驱动（ES8311 Codec）
- ✅ 有成熟的 I2S 音频采集和播放代码
- ✅ 有离线唤醒词功能（ESP-SR）
- ✅ 有完整的 WebSocket/MQTT 通信协议栈

## 📋 推荐开发路线

### 🔵 方案一：移植小智的音频模块到东信固件（推荐）

**适合场景**：快速验证完整语音链路，后续移植到定制硬件

**优势**：
- 可以立即开始测试完整的语音交互
- 复用小智项目的音频驱动（ES8311、I2S、唤醒词）
- 快速验证东信后端服务器的接口
- 为后续定制硬件提供参考实现

**实施步骤**：

#### 第一步：修改小智固件，对接东信后端 (Week 1)

当前小智固件默认连接 xiaozhi.me 官方服务器，我们需要修改它连接到你的 QiuAI Gateway。

**核心修改点**：
1. 修改通信协议：从 WebSocket/MQTT 改为 HTTP+JSON
2. 修改接口路径：对接 `/api/device/v1/*` 接口
3. 保留音频采集、唤醒词、TTS 播放功能
4. 移除 MCP 协议（东信不需要）

**具体操作**：

```bash
# 1. 复制小智项目
cd D:\workspace
cp -r xiaozhi-esp32-2.2.4/xiaozhi-esp32-2.2.4 dongxin-xiaozhi-bridge

# 2. 修改配置
cd dongxin-xiaozhi-bridge
```

需要修改的文件清单：
- `main/protocols/` - 添加 HTTP+JSON 协议适配器
- `main/application.cc` - 修改设备注册、心跳逻辑
- `main/audio/audio_service.cc` - 修改音频上传格式
- `sdkconfig.defaults.esp32c3` - WiFi 配置

#### 第二步：实现东信协议适配层 (Week 2)

在小智固件中添加新的协议适配器：

```cpp
// main/protocols/dongxin_protocol.h
class DongxinProtocol {
public:
    // 设备注册
    bool DeviceRegister(const char* device_id);

    // 心跳上报
    bool SendHeartbeat();

    // 状态上报
    bool ReportState(const DeviceState& state);

    // 语音文本上传（音频 -> ASR 在服务器端完成）
    bool SendVoiceTurn(const uint8_t* audio_data, size_t len);

    // 接收控制指令
    bool PollCommands(std::vector<Command>& commands);

    // 上报执行结果
    bool ReportCommandResult(const char* command_id, const char* status);
};
```

**关键改动**：
```cpp
// 当前小智：WebSocket 流式传输
audio_data -> WebSocket -> xiaozhi.me -> ASR -> LLM -> TTS

// 修改后：HTTP 请求响应
audio_data -> HTTP POST -> QiuAI Gateway -> ASR -> LLM -> TTS
```

#### 第三步：测试完整语音链路 (Week 2-3)

**测试流程**：
1. 烧录修改后的固件到小智硬件
2. 说唤醒词"小智"（或保持原唤醒词）
3. 说"打开照明"
4. 小智采集音频 → 上传到东信后端 → ASR 识别 → LLM 理解 → 返回控制指令
5. 小智接收到指令后，通过串口日志查看（暂时不执行，因为没有主控板）

#### 第四步：添加 UART 主控通信 (Week 3-4)

在小智固件中添加 UART 模块，参考东信固件的 `uart_bridge.c`：

```cpp
// main/uart_bridge.cc
class UartBridge {
public:
    void Initialize();
    void SendCommand(const Command& cmd);  // 发送 32 字节固定帧
    bool ReceiveStatus(DeviceStatus& status);  // 接收主控板状态
};
```

**硬件连接**：
```
小智 C3 开发板    →    东信主控板
TX (GPIO_XX)     →    RX
RX (GPIO_XX)     →    TX
GND              →    GND
```

---

### 🟢 方案二：直接使用小智硬件作为东信浴霸的 WiFi 模块（最快）

**适合场景**：快速演示，6 周内必须出成果

**优势**：
- 最快速度完成验证（1-2 周）
- 无需硬件开发
- 可以立即演示完整功能

**实施步骤**：

- **Week 1**: 修改小智固件对接东信后端
- **Week 2**: 添加 UART 通信，连接东信主控板
- **Week 3**: 联调测试（语音 → 控制 → 主控板动作）
- **Week 4**: 主动沟通功能集成
- **Week 5**: 小程序对接 + 压力测试
- **Week 6**: 整理文档 + 现场演示准备

**硬件方案**：
```
┌─────────────────────────────────────┐
│  小智 AI C3 开发板                    │
│  - WiFi 通信                         │
│  - 语音采集（麦克风）                 │
│  - 语音播放（扬声器）                 │
│  - OLED 显示（可选）                  │
└──────────┬──────────────────────────┘
           │ UART (32字节固定帧)
           ↓
┌─────────────────────────────────────┐
│  东信浴霸主控板                       │
│  - 照明控制                          │
│  - 取暖控制                          │
│  - 换气控制                          │
│  - 温湿度传感器                       │
│  - 人感传感器                        │
└─────────────────────────────────────┘
```

---

### 🟡 方案三：提取小智的音频模块，移植到东信固件

**适合场景**：需要完全自主可控的固件

**优势**：
- 代码完全掌控
- 可以精简不需要的功能
- 为后续量产定制硬件做准备

**实施步骤**：

从小智项目提取以下模块，移植到 `Dongxin/firmware/`：

1. **音频 Codec 驱动**
   ```
   xiaozhi/main/audio/codecs/es8311_audio_codec.cc
   → Dongxin/firmware/main/audio_codec.c
   ```

2. **I2S 音频采集**
   ```
   xiaozhi/main/audio/audio_service.cc (I2S 初始化部分)
   → Dongxin/firmware/main/voice_engine.c
   ```

3. **离线唤醒词**（可选）
   ```
   xiaozhi/main/audio/wake_words/esp_wake_word.cc
   → Dongxin/firmware/main/wake_word.c
   ```

4. **OLED 显示驱动**（可选）
   ```
   xiaozhi/main/display/oled_display.cc
   → Dongxin/firmware/main/display.c
   ```

---

## 🎯 我的推荐：方案二（最快）

**理由**：
1. **时间紧迫**：6 周内要出成果，方案二最快
2. **硬件现成**：小智硬件已经验证可用，音质好，功能完整
3. **风险最低**：不需要调试新硬件，只需要改固件
4. **演示效果好**：有 OLED 屏幕显示，更直观

**后续扩展**：
- 项目演示成功后，可以定制专用硬件
- 小智项目的代码可以作为参考实现
- 量产时可以选择更低成本的方案（去掉屏幕，简化电池管理）

---

## 📝 立即开始的具体步骤

### 第一步：确认硬件信息（今天）

**请提供以下信息**：
1. 小智 C3 开发板的串口号（插入电脑后的 COM 端口）
2. 测试用 WiFi 信息（SSID + 密码）
3. 后端电脑的局域网 IP 地址

### 第二步：修改小智固件（明天）

我会帮你：
1. 在 `main/protocols/` 添加 `dongxin_protocol.cc`
2. 修改 `application.cc` 的初始化逻辑
3. 修改 `sdkconfig` 配置文件
4. 编译并生成固件

### 第三步：烧录测试（后天）

```bash
# 编译小智固件（针对你的板型）
cd D:\workspace\xiaozhi-esp32-2.2.4\xiaozhi-esp32-2.2.4
idf.py set-target esp32c3
idf.py -D SDKCONFIG_DEFAULTS="sdkconfig.defaults;sdkconfig.defaults.esp32c3;boards/xmini-c3-v3" build

# 烧录
idf.py -p COM3 flash monitor
```

### 第四步：验证基础通信（3天内）

预期日志：
```
I (1234) XminiC3Board: Board initialized
I (1245) WiFiManager: Connected to WiFi: 你的WiFi名称
I (1256) DongxinProtocol: Device registered: DX-XIAOZHI-C3-001
I (1267) DongxinProtocol: Heartbeat sent
```

---

## 🤔 你的决定

**现在请告诉我**：

1. **你倾向于哪个方案？**
   - 方案一：移植小智音频模块到东信固件
   - 方案二：直接使用小智硬件作为 WiFi 模块（推荐）
   - 方案三：完全重写音频驱动

2. **你的小智硬件是哪个型号？**
   - 虾哥 Mini C3 V3？
   - 其他型号？（请告诉我型号）

3. **立即提供的信息**：
   - 小智 C3 的串口号：COM?
   - 测试 WiFi：SSID
   - 后端电脑 IP：192.168.1.?

**一旦你确认，我立即开始修改代码！** 🚀
