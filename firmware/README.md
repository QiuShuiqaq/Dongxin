# 东信智能浴霸 ESP32-C3 联网语音固件

## 当前产品基线

现有 STM32 样机继续负责已经稳定工作的负载、电机、温控、显示、遥控和安全互锁。ESP32-C3通过独立音频Codec负责联网、在线语音、提示/TTS播放和STM32协议适配；CI1302在后续样板阶段加入，只负责“小东小东”常驻唤醒、断网固定命令和UART语义ID。

```text
后续 CI1302 + 麦克风A
  唤醒 / 离线命令
             │ UART事件/语义ID
             ▼
ESP32-C3 + 独立音频Codec + 麦克风B
  Wi-Fi / MQTT / ASR / 规则 / 知识库 / LLM / TTS / 播放
  STM32 协议适配
             │ UART
             ▼
现有 STM32 样机
  负载 / 电机 / 温控 / 显示 / 遥控 / 安全互锁
```

当前合同实施不采用 C3 直接替代 STM32。`direct_control_hal`、`pcf8574` 和旧 MCU 模拟协议保留为研发模拟或降本预研资产，不属于当前样机控制主链路。

## 当前验证状态

| 模块 | 当前状态 |
|---|---|
| `wifi_manager` | C3 Wi-Fi STA 和断线重连已验证 |
| `mqtt_agent` | 本地 MQTT 注册、命令、结果、状态和幂等已验证 |
| `voice_engine` | 立创 C3 板按键录音、在线语音和受控播放测试入口 |
| `sample_uart_monitor` | GPIO19接收、GPIO18分级发送，115200 8N1；照明、吹风已取得真实匹配回执 |
| `voice_engine` 在线闭环 | 已支持ASR/规则或LLM、STM32回执判定、短期PCM下载和受控TTS播放，真实效果由研发人员手动验收 |
| `uart_bridge` | 历史 V0.2 模拟协议，与当前 STM32 样机不兼容，禁止启用 |
| `device_controller` / `direct_control_hal` | C3 软件逻辑模拟，不代表 STM32 或真实负载执行 |
| CI1302 | 后续只通过UART接入唤醒和离线语义ID，不承担在线PCM传输 |

已验证 STM32 状态帧示例：

```text
02 CA 07 00 00 00 00 00 1E 01 00 00 02 00 00 00
00 00 00 00 00 00 00 00 00 00 00 00 00 1A 0B 04
```

该帧表示温度 30℃、负载均关闭，校验通过。双向链路已通过照明和吹风动作闭环；其他负载必须分别保留真实回执后才能计为已验证。

## 安全约束

- `DX_ENABLE_UART_BRIDGE` 必须保持为 `0`。
- `DX_ENABLE_PCF8574` 必须保持为 `0`。
- 已连接 `C3 GPIO18 → STM32 WIFI_RX`，并保留原有共地和 `STM32 WIFI_TX → C3 GPIO19`；改线仍必须断电操作。
- `DX_STM32_CONTROL_STAGE` 当前为 `3`，仅供有人值守手动验证协议支持的负载，不代表取暖和热安全已验收。
- `DX_ENABLE_NTC_CONTROL` 必须保持为 `0`，直到NTC参数、标定和过温保护测试全部完成。
- 音频只允许由研发人员显式点击播放，功放上电默认关闭，使用受限音量。
- 取暖等危险负载不得加入自动批量测试。

## 开发环境

- ESP-IDF v5.3.2：`D:\Espressif\frameworks\esp-idf-v5.3.2`
- 立创实战派 ESP32-C3 音频板：COM5
- ESP32-C3 SuperMini HW-466AB：历史串口 COM3
- 固件目录：`D:\workspace\Dongxin\firmware`

## 构建和烧录

在 PowerShell 中执行：

```powershell
Set-Location D:\workspace\Dongxin\firmware
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build-and-flash.ps1
```

立创板命令：

```powershell
.\build-and-flash.ps1 -Action lichuang-build
.\build-and-flash.ps1 -Action lichuang-flash-monitor -Port COM5
```

串口监视器按 `Ctrl+]` 退出。烧录和播放均须由研发人员主动发起；网页不得在刷新、启动或设备上线时自动执行。

## 下一步顺序

1. 由研发人员手动完成在线语音和剩余样机功能验收，代码不自动播放或自动触发真实负载。
2. 取得产品知识资料后执行合同数据集，并从研发中心导出原始记录。
3. CI1302到板后，根据厂商真实输出码补齐UART映射并验证唤醒、固定命令和断网行为。
4. 同步推进运营平台生产化：员工鉴权、每机独立密钥、阿里云IoT/RDS/Redis、监控、备份和90天日志策略。

当前开发固件版本：`1.1.0-online-voice`。
