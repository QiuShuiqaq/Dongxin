# STM32 样机主控固件

本目录用于维护东信现有样机的 STM32F103C8 主控固件。原始资料目录 `D:\workspace\backup0424` 仅用于追溯，不在原目录上直接开发。

## 工程边界

- STM32：负载、电机、温控、显示、遥控和安全互锁。
- ESP32-C3：Wi-Fi、MQTT、在线语音、AI 和 STM32 协议适配。
- CI1302：后续接入唤醒与离线固定命令，不直接控制负载。

当前只做兼容性和确定性缺陷修复。恒温、故障码和协议 V1.1 尚未进入本工程，不得把现有 `0x0B` 模式命令解释为恒温控制。

## 工程入口

- `axent-controller/AXENT.uvprojx`：原始 ARMCC 5.06u7 工程，仅保留追溯。
- `axent-controller/AXENT-AC6.uvprojx`：当前维护工程，使用本机 ARM Compiler 6.24。
- `axent-controller/baseline/`：原始 HEX、历史构建日志和哈希说明。

## 仅编译

在 PowerShell 中执行：

```powershell
cd D:\workspace\Dongxin\stm32-firmware\axent-controller
& 'D:\Keil_v5\UV4\UV4.exe' -r '.\AXENT-AC6.uvprojx' -j0 -o '.\ac6-build.log'
Get-Content '.\ac6-build.log'
```

构建成功必须出现 `0 Error(s), 0 Warning(s)`。上述命令只编译，不会通过 J-Link 下载到样机。

也可以在仓库根目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\stm32-firmware\tools\build-stm32.ps1
```

## 回归检查

在仓库根目录执行：

```powershell
npm run verify:stm32
```

该检查覆盖 32 个环形缓冲区帧头位置、校验失败、帧尾失败，以及当前三路串口修复约束。

## 烧录门禁

当前 AC6 产物尚未写入样机。只有在源代码评审、编译记录归档、样机负载全部关闭并明确确认测试窗口后，才能使用 J-Link 烧录。首次烧录必须先读取并保存样机现有 Flash，随后从低风险的状态查询、照明和风路动作开始验证。

安全状态确认文本固定为 `SAMPLE_COLD_LOADS_OFF`。首次验证按以下顺序执行：

```powershell
# 1. 备份当前样机 Flash、Option Bytes 和 UID
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\stm32-firmware\tools\backup-stm32.ps1 -SafetyConfirmation SAMPLE_COLD_LOADS_OFF

# 2. 使用上一步生成的 manifest.json 烧录当前构建产物
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\stm32-firmware\tools\flash-stm32.ps1 -SafetyConfirmation SAMPLE_COLD_LOADS_OFF -BackupManifest <manifest.json路径>

# 3. 需要回滚时恢复完整的 64 KiB Flash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\stm32-firmware\tools\restore-stm32.ps1 -SafetyConfirmation SAMPLE_COLD_LOADS_OFF -BackupManifest <manifest.json路径>
```

备份与烧录脚本固定连接 J-Link `69406456`、目标 `STM32F103C8`、接口 `SWD`、速率 `1000 kHz`。它们不写入 Git，也不通过研发中心远程调用。
