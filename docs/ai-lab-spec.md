# Spec: 东信 AI 浴霸研发测试平台

## Objective

建设一个本地运行的内部研发测试平台，用于验证浴霸产品接入大模型后的意图识别、结构化输出、安全规则、设备状态机和供应商评估。

第一阶段目标不是销售系统、不是手机 APP、不是云平台，而是让研发人员能批量比较豆包、通义千问、文心、智谱和自部署模型的表现。

## Tech Stack

- Frontend: React 19 + Vite + Ant Design + Ant Design X
- Backend: Fastify + TypeScript
- Shared contracts: TypeScript + Zod
- Persistence: project-local JSON files under `data/`
- Model interface: mock provider plus OpenAI-compatible provider adapter

## Commands

```bash
npm install
npm run dev
npm run build
npm run typecheck
```

## Project Structure

```text
apps/web/          React frontend
apps/api/          Local API and model gateway
packages/shared/   Shared schemas, enums, and contracts
data/              Local JSON configuration and test data
docs/              Product and technical notes
```

## Testing Strategy

Current verification is build and type checking:

```bash
npm run typecheck
npm run build
```

Later phases should add:

- Model gateway contract tests
- Safety-rule unit tests
- Batch evaluation regression tests
- Playwright browser smoke test

## Boundaries

- Always: keep secrets out of source files; validate model output before applying device actions.
- Always: persist internal test data in `data/*.json`.
- Ask first: adding a database, Docker, deployment scripts, mobile APP, or cloud service dependency.
- Never: let model free-form text directly control device power or heating functions.

## Success Criteria

- A local user can run the platform with `npm run dev`.
- The platform can run a batch evaluation using the built-in Mock model.
- The platform can display model output, rule-engine decision, device simulator state, and evaluation logs.
- The model gateway can add real commercial providers through configuration and local `.env` keys.

## Open Questions

- The exact commercial model IDs and prices should be filled after Dongxin procurement confirms supplier accounts.
- The real device communication protocol is still pending hardware-side confirmation.
