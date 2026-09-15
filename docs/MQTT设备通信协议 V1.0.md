# 东信浴霸 MQTT 设备通信协议 V1.0

## 1. 适用范围

本协议用于 ESP32 设备、东信平台 API 和 MQTT Broker 之间的通信。研发环境使用本地 Broker，生产环境优先接入阿里云 IoT 平台。业务消息结构保持一致，生产切换只更换连接、TLS 和认证适配。

当前确认边界：

- 每台设备使用独立 `deviceId` 和 `deviceSecret`；
- 命令和命令结果使用 QoS 1；
- 状态变化立即上报，并每 30 秒上报研发心跳；
- 不通过 MQTT 保存或传输原始音频；
- 第一版一个设备归属一个用户，不定义家庭共享；
- OTA 暂不实现。

## 2. 研发环境

| 项目 | 值 |
| --- | --- |
| Broker | `mqtt://192.168.16.146:1883` |
| C3 Client ID | `DX-C3-SUPERMINI-HW466AB-001` |
| C3 Username | 与 Client ID 相同 |
| C3 deviceSecret | 仅保存在研发配置中，生产时逐台烧录 |
| API Client ID | `dongxin-api-gateway` |

研发环境允许明文 MQTT，仅用于同一局域网联调。生产必须使用 TLS，并由阿里云 IoT 认证适配器生成连接参数。

## 3. 主题

```text
dongxin/v1/devices/{deviceId}/up/register
dongxin/v1/devices/{deviceId}/up/heartbeat
dongxin/v1/devices/{deviceId}/up/status
dongxin/v1/devices/{deviceId}/up/state
dongxin/v1/devices/{deviceId}/up/event
dongxin/v1/devices/{deviceId}/up/command-result

dongxin/v1/devices/{deviceId}/down/command
dongxin/v1/devices/{deviceId}/down/config
```

设备只能发布自己的 `up` 主题并订阅自己的 `down` 主题。API 网关只能订阅设备上行主题并发布设备下行主题。

## 4. 通用信封

```json
{
  "version": "1.0",
  "messageId": "msg_unique_id",
  "deviceId": "DX-C3-SUPERMINI-HW466AB-001",
  "sentAt": "2026-09-12T12:00:00.000Z",
  "data": {}
}
```

设备尚未同步网络时间时，`sentAt` 可以暂时使用启动时长标识；平台接收时间作为审计基准。命令是否过期以平台生成的 `expireAt` 为准。

## 5. 注册和在线状态

`up/register` 使用 QoS 1 和 retained，内容包含型号、固件版本、协议版本和已实际启用的能力。`up/status` 使用 retained；设备上线发布 `isOnline=true`，异常断线由 MQTT Last Will 发布 `isOnline=false`。

```json
{
  "data": {
    "model": "DX-AI-BATH-C3-SUPERMINI",
    "firmwareVersion": "0.4.0-direct-control",
    "protocolVersion": "1.0",
    "capabilities": {
      "mqttCommand": true,
      "textSimulation": true,
      "uartBridge": false,
      "audio": false,
      "directControl": true,
      "virtualHal": true,
      "pcf8574": false,
      "ci1302": false,
      "bleLocalControllers": false
    }
  }
}
```

## 6. 命令下发

`down/command` 使用 QoS 1、不 retained，命令默认 60 秒过期。

```json
{
  "data": {
    "commandId": "2ba4b045-da9d-489c-a71a-e6676edf443c",
    "source": "server",
    "expireAt": "2026-09-12T12:01:00.000Z",
    "replyText": "已打开照明",
    "actions": [
      {
        "commandId": "2ba4b045-da9d-489c-a71a-e6676edf443c",
        "code": "light",
        "value": "on"
      }
    ]
  }
}
```

设备按 `commandId` 去重。QoS 1 重发同一命令时不得重复执行C3状态机或驱动输出，但必须允许再次回传结果。沐浴和恒温动作分别使用 `code=bath`、`code=constantTemperature`；恒温在NTC驱动/标定未就绪时返回拒绝。

V1.0要求每个 `commandId` 的 `actions` 数组只能包含一个动作。需要同时执行照明和取暖时，平台分别创建两个命令并逐个等待结果，避免部分执行后整包状态不明确。将来确需原子组合命令时应升级协议和C3事务控制器，不能直接放开数组长度。

## 7. 结果和状态

`up/command-result` 使用 QoS 1。只有设备实际执行完成并回传成功，平台才把命令标记为 `APPLIED`。

```json
{
  "data": {
    "commandId": "2ba4b045-da9d-489c-a71a-e6676edf443c",
    "status": "success",
    "executedAt": "2026-09-12T12:00:01.000Z",
    "executionPath": "LOCAL_VIRTUAL",
    "message": "命令已通过本地安全状态机执行",
    "state": {
      "isOnline": true,
      "power": "on",
      "light": "on",
      "heater": "off",
      "fan": "off",
      "ventilation": "off",
      "swing": "off",
      "dry": "off",
      "bathMode": "off",
      "constantTemperature": "off",
      "targetTemperature": 40
    }
  }
}
```

状态值以ESP32-C3本地状态机和HAL回报为准。平台发布成功只代表Broker接收消息，不代表设备或浴霸已经执行。

## 8. 当前验证级别

已完成真实C3的MQTT注册、订阅、统一状态机、结果回传和状态回传。当前SuperMini应返回 `executionPath=LOCAL_VIRTUAL`；它只证明C3软件闭环。新样板必须依次验证 `LOCAL_PCF8574`、低压测试点、功率驱动和实际负载。历史 `mcuFrame` 字段仅在旧MCU兼容分支出现。
