# MCU 串口模拟器

该工具在电脑上模拟旧浴霸主控MCU，只用于`uart_bridge`历史兼容代码回归，不需要连接强电或真实浴霸负载。旧协议文档已退出当前研发文档集；新样板不得使用该链路。

## 接线

C3 继续通过自身 USB 连接电脑并使用 `COM3` 输出日志。另插入一个 3.3V USB-TTL，假设系统识别为 `COM4`：

| USB-TTL | ESP32-C3 SuperMini |
| --- | --- |
| RX | GPIO4（C3 TX） |
| TX | GPIO5（C3 RX） |
| GND | GND |

USB-TTL 必须设为 3.3V IO。C3 已由自身 USB 供电，不连接 USB-TTL 的 5V 或 3.3V 电源脚。

## 运行

先把 `firmware/main/app_config.h` 中 `DX_ENABLE_UART_BRIDGE` 改为 `1`、`DX_ENABLE_TEXT_SIMULATION` 改为 `0`，重新编译和烧录 C3。

```powershell
cd D:\workspace\Dongxin
.\start-mcu-simulator.ps1 -List
.\start-mcu-simulator.ps1 -Port COM4
```

启动后可输入：

```text
next success
next retry
next reject 3
next timeout
state light on
state temperature 19.5
state occupancy on
fault 1
report
corrupt
show
quit
```

`next` 只影响下一笔新事务。`next retry` 丢弃第一次响应、在同序号重试时只执行一次；`next timeout` 会同时忽略首次发送和重试，用于验证 C3 的 2 秒超时；重复成功事务只返回缓存 ACK，不会再次执行动作。
