# 东信 AI 浴霸研发测试平台

这是一个本地运行的企业内部研发测试平台，用于验证浴霸产品稳定接入商用大模型或自部署模型的可行性。

项目当前不做手机 APP，不做数据库，不做服务器部署。测试集、模型配置、Prompt 版本、评测记录都保存在当前项目的 `data/*.json` 文件里。

## 技术栈

- 前端：React 19、Vite、Ant Design、Ant Design X
- 后端：Node.js、Fastify、TypeScript
- 数据：项目本地 JSON 文件
- 模型接入：统一模型网关，默认配置国内 OpenAI-compatible 真实模型

## 本地运行

```bash
npm install
npm run dev
```

默认地址：

- 前端：http://localhost:5173
- 后端：http://localhost:3077/api/health

## 本地 API Key

复制 `apps/api/.env.example` 为 `apps/api/.env`，按企业采购账号填写 Key。`.env` 已被忽略，不会提交。

```bash
ARK_API_KEY=
DASHSCOPE_API_KEY=
QIANFAN_API_KEY=
DEEPSEEK_API_KEY=
ZAI_API_KEY=
HUNYUAN_API_KEY=
MOONSHOT_API_KEY=
```

## 边界

- 大模型只负责意图理解，不直接控制设备。
- 最终设备动作必须经过 JSON Schema 校验、安全规则引擎、设备状态机。
- 不在 C 盘写项目文件；npm 缓存固定到 `F:/dev-cache/npm`。
- 不写入真实密钥，不记录用户隐私音频。
