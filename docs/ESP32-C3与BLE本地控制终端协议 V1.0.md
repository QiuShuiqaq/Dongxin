# ESP32-C3 与 BLE 本地控制终端协议 V1.0

文档状态：样板和固件开发基线<br>
适用终端：墙面触控板、手持遥控器、微信小程序配网入口<br>
更新日期：2026-09-14

## 1. 架构决定

ESP32-C3 自带 WiFi 和 Bluetooth LE，浴霸主板不增加外部蓝牙接收模块。

- C3 作为 BLE GATT Server 和唯一设备状态权威；
- 墙面触控板、手持遥控器作为 GATT Client；
- 墙面板本地管理触摸扫描和屏幕，只向 C3 发送语义命令；
- 手持遥控器只发送语义命令，不发送 GPIO 或 PCF8574 端口号；
- C3 执行统一安全状态机后返回结果，并向所有已连接终端同步真实状态；
- 微信小程序复用 C3 BLE 完成配网、首次绑定和售后诊断，不参与低压负载直控；
- 默认出厂绑定 1 个墙面板和 1 个手持遥控器，最多保留 4 个终端绑定记录。

## 2. 角色和连接

| 设备 | BLE角色 | 建议连接方式 |
|---|---|---|
| ESP32-C3主板 | Peripheral / GATT Server | 常态低占空比广播，允许多个已绑定客户端 |
| 墙面触控板 | Central / GATT Client | 有电时保持连接，断线自动重连 |
| 手持遥控器 | Central / GATT Client | 按键唤醒后快速连接、发命令、收回执、休眠 |
| 微信小程序 | Central / GATT Client | 仅配网、绑定、配置或诊断期间连接 |

首板目标：墙面板常连、遥控器按需连接、手机临时连接能与 WiFi/MQTT 共存。若所选 BLE 芯片不支持 Central 角色，不得直接改协议，需在原理图投板前重新评审角色。

## 3. 广播

设备名：`DX-BATH-xxxx`，`xxxx` 为设备 ID 后四位，不包含 WiFi 密码和密钥。

Manufacturer Data：

```text
protocol_version      uint8   当前1
product_code          uint16
device_id_hash        uint32  deviceId的截断哈希
flags                 uint8   bit0=可配网 bit1=可配对 bit2=故障 bit3=已联网
```

普通运行不广播完整设备序列号、deviceSecret、SSID或用户信息。

## 4. GATT 服务

项目 128-bit UUID 基线：

| 名称 | UUID | 属性 | 用途 |
|---|---|---|---|
| DX Local Control Service | `d0a10000-7a61-4f62-9b10-44584c4f4341` | Primary | 本地控制服务 |
| Device Info | `d0a10001-7a61-4f62-9b10-44584c4f4341` | Read | 协议、产品、固件和能力摘要 |
| Command | `d0a10002-7a61-4f62-9b10-44584c4f4341` | Write with response | 终端发送命令 |
| Command Result | `d0a10003-7a61-4f62-9b10-44584c4f4341` | Indicate | C3返回执行或拒绝 |
| Device State | `d0a10004-7a61-4f62-9b10-44584c4f4341` | Read + Notify | 全量状态和变化同步 |
| Pairing Control | `d0a10005-7a61-4f62-9b10-44584c4f4341` | Write + Indicate | 生产/售后配对流程 |
| WiFi Provisioning | `d0a10006-7a61-4f62-9b10-44584c4f4341` | Write + Indicate | 小程序配网，终端不可使用 |

除公开的 Device Info 外，所有特征必须在加密连接上访问。Command、Pairing Control 和 WiFi Provisioning 还必须通过应用身份检查。

## 5. 通用数据帧

BLE 已有链路校验，但应用帧继续使用长度、序号和 CRC，便于发现错误实现和做跨芯片回归。

```text
version               uint8
message_type          uint8
flags                 uint8
payload_length        uint8
sequence              uint16  little-endian，0不使用
opcode                uint16  little-endian
payload               uint8[payload_length]
crc16                 uint16  对此前全部字段做CCITT-FALSE
```

单帧默认不超过 64 字节。超过当前 ATT MTU 时由 BLE 栈分片，业务层不自行拼接超长 JSON。

消息类型：

| 值 | 名称 | 方向 |
|---:|---|---|
| 0x01 | COMMAND | 终端 -> C3 |
| 0x02 | COMMAND_RESULT | C3 -> 终端 |
| 0x03 | STATE | C3 -> 终端 |
| 0x04 | PAIRING | 双向 |
| 0x05 | PROVISIONING | 小程序 <-> C3 |

## 6. 语义命令

| opcode | 命令 | payload |
|---:|---|---|
| 0x0001 | 照明 | `uint8 0=关,1=开` |
| 0x0002 | 吹风 | `uint8 0=关,1=开` |
| 0x0003 | 换气 | `uint8 0=关,1=开` |
| 0x0004 | 取暖 | `uint8 0=关,1=弱暖,2=强暖` |
| 0x0005 | 摆风 | `uint8 0=关,1=开` |
| 0x0006 | 干燥 | `uint8 0=关,1=开` |
| 0x0007 | 目标温度 | `uint8 30..45` |
| 0x0008 | 定时 | `uint8 1..120分钟` |
| 0x0009 | 待机/全部关闭 | 空 |
| 0x0010 | 沐浴模式 | `uint8 0=关,1=开` |
| 0x0011 | 恒温模式 | `uint8 0=关,1=开` |

夜灯、净化、独立除雾等可选能力只有在产品 Profile 为 `ENABLED` 后分配正式 opcode；未装配能力必须返回 `UNSUPPORTED`。

墙面板和遥控器不得自行实现“强暖需要哪些继电器”“散热多久”等逻辑。它们只表达用户意图。

## 7. 命令结果

```text
request_sequence      uint16
status                uint8   0=APPLIED 1=REJECTED 2=FAILED 3=DUPLICATE
error_code            uint16
state_revision        uint32
```

常用错误：

| 值 | 名称 |
|---:|---|
| 0x0000 | OK |
| 0x0001 | BAD_FRAME |
| 0x0002 | UNAUTHORIZED |
| 0x0003 | UNSUPPORTED |
| 0x0004 | INVALID_VALUE |
| 0x0005 | HEATER_INTERLOCK |
| 0x0006 | COOLDOWN_INTERLOCK |
| 0x0007 | FAULT_LOCKED |
| 0x0008 | BUSY |
| 0x0009 | INTERNAL_ERROR |

Write Response 只说明 C3 的 BLE 栈收到数据；Command Result Indication 才是业务回执。终端未收到结果时可以用相同 sequence 重试，C3 必须去重并返回原结果。

## 8. 状态同步

```text
state_revision        uint32  每次有效状态变化加1
flags                 uint16
heater_level          uint8   0=关,1=弱暖,2=强暖
target_temperature    int8
ambient_x10           int16   无效时0x7FFF
remaining_minutes     uint8   无定时时0
fault_code            uint16
```

`flags` 至少包含：照明、吹风、换气、摆风、干燥、有人、联网、故障。

- 连接建立后终端先 Read 全量状态；
- 状态变化后 C3 立即 Notify；
- 墙面板显示 C3 返回的状态，不根据按键动作自行假定成功；
- revision 断档时重新 Read，避免漏通知后显示错误；
- C3 重启后的 revision 从随机启动基值或持久化基值开始，终端不能只比较大小来判断跨重启新旧。

## 9. 配对与安全

用户正常使用不需要手动配对：成套墙面板和遥控器应在生产测试时与主板预绑定。

- 使用 LE Secure Connections 和加密 Bonding；
- 每套产品生成独立 `localControlKey`，不得全型号共用一个固定密钥；
- 主板、墙面板和遥控器在生产烧录时注入同一套派生凭据；
- C3 只接受绑定白名单中的控制终端，最多 4 个；
- 普通重新上电不能自动打开新终端配对窗口；
- 替换遥控器时，由已绑定小程序/售后工具鉴权后开启 120 秒服务配对窗口；
- 解除全部绑定属于高风险操作，必须有售后鉴权并写审计记录；
- WiFi 密码仅允许微信小程序身份写入，墙面板和手持遥控器权限不足；
- BLE 密钥、deviceSecret 和 WiFi 密码不得出现在串口普通日志、广播或平台文本日志。

如首板暂时没有量产密钥注入系统，可使用明确标记的开发密钥联调，但该固件不得进入生产。

## 10. 配网流程

```text
用户扫描机身二维码
  -> 小程序向平台取得短期配网授权
  -> 手机连接C3 BLE
  -> 双方建立加密会话
  -> 写入SSID/密码和授权票据
  -> C3连接WiFi/MQTT并自动注册
  -> 平台把设备绑定给当前微信用户
  -> C3清除短期授权和明文密码缓冲
```

开放 WiFi 的密码长度可以为 0。生产固件不写死家庭 SSID。配网失败需返回阶段和错误码，不能只显示“失败”。

## 11. 可靠性与性能目标

- 墙面板已连接时，按键到 C3 业务回执 P95 小于 200ms；
- 手持遥控器从按键唤醒到业务回执 P95 小于 500ms；
- 断线后墙面板自动重连，遥控器重试不能造成重复动作；
- 命令队列满时返回 BUSY，不静默丢弃；
- 关闭/待机命令优先于普通模式命令，但仍遵守取暖散热；
- BLE 断线不改变当前负载状态，安全状态机继续运行；
- WiFi/MQTT离线不影响已绑定本地终端控制；
- 单终端连续按键、双终端冲突操作和手机并发配网必须进入同一命令队列；
- 8小时混合压力测试不得出现内存持续下降、连接泄漏、错误绑定或状态不同步。

## 12. 首板验收

1. 墙面板和遥控器均只能绑定到目标主板；
2. 未绑定终端不能读取敏感状态或发控制命令；
3. 每个按键均生成正确 opcode，长按/连按不会形成命令风暴；
4. 开取暖经过风机预启动，终端只显示 C3 回传的最终状态；
5. 散热期间关风机/开换气收到明确拒绝；
6. 两个终端同时操作时结果可解释、状态最终一致；
7. C3、终端任一方断电重启后自动恢复绑定；
8. 手机配网连接不会让墙面板或遥控器永久掉线；
9. WiFi断开时本地控制继续，恢复后完整状态上报 MQTT；
10. 清除/替换终端需要授权，普通邻近手机无法发起。

## 13. 东信终端选型输入

东信选择墙面板和手持遥控器 BLE 芯片前，必须确认：

- 支持 BLE Central、LE Secure Connections、Bonding 和白名单；
- 墙面板至少支持 1 个稳定连接及本地触摸/显示资源；
- 手持遥控器支持低功耗按键唤醒和快速重连；
- SDK 能设置 128-bit 自定义 GATT、Write、Indicate 和 Notify；
- 可注入每套独立密钥并在量产测试读取版本；
- 芯片量产价格、供货周期、烧录工具和治具可接受。

具体芯片型号可以后定，但这些能力是投板前置条件。
