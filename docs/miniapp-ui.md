# 东信浴霸小程序第一版界面说明

当前小程序位于 `apps/miniapp`，采用原生微信小程序结构，不依赖 Taro 或 uni-app。第一版目标是现场演示和消费者端功能验证，不做商城、支付、会员、家庭共享等运营功能。

## 页面结构

| 页面 | 路径 | 作用 |
| --- | --- | --- |
| 首页 | `pages/home/index` | 设备状态、温度湿度、人感、当前模式和常用控制 |
| 控制 | `pages/control/index` | 照明、弱暖、强暖、吹风、换气、摆风、待机、温度调节 |
| AI | `pages/ai/index` | 自然语言输入，调用 `/api/voice/turn` 返回播报和控制结果 |
| 帮助 | `pages/help/index` | 产品知识库问答，调用 `/api/knowledge/query` |
| 设置 | `pages/settings/index` | 主动沟通开关、模式、安静时段和触发预览 |

## 接口策略

小程序默认 API 地址在 `apps/miniapp/app.js`：

```js
apiBaseUrl: 'http://127.0.0.1:3077'
```

微信开发者工具本地预览时可以使用该地址。真机演示时需要改成局域网 IP、测试域名或正式 HTTPS 域名。

接口封装在 `apps/miniapp/utils/api.js`。如果本地 API 未启动，小程序会使用本地模拟数据，保证界面能打开和演示基础流程。

## 第一版边界

- 不做微信登录和设备绑定流程，默认使用 `demo-bath-heater-001`；
- 不做真实语音输入，先用文本输入模拟语音识别结果；
- 不直接执行主动沟通建议动作，只显示确认话术和建议动作；
- 不保存用户长期偏好，后续接数据库和真实用户体系后再补。

## 导入方式

使用微信开发者工具导入目录：

```text
F:\Workspace_VS\QiuAi-qiye\Dongxin\apps\miniapp
```

项目配置文件为 `project.config.json`，当前使用 `touristappid`，后续替换为东信或你的真实小程序 AppID。
