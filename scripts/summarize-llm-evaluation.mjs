import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function percentile(values, ratio) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)];
}

function summarizeTurns(turns) {
  const byCategory = new Map();
  for (const turn of turns) {
    const category = turn.dimension ?? 'unknown';
    const group = byCategory.get(category) ?? [];
    group.push(turn);
    byCategory.set(category, group);
  }
  const count = (items, predicate) => items.filter(predicate).length;
  const metrics = (items) => ({
    turns: items.length,
    automatedPass: count(items, (item) => item.evaluation?.status === 'PASS'),
    automatedFail: count(items, (item) => item.evaluation?.status === 'FAIL'),
    errors: count(items, (item) => item.status === 'ERROR'),
    humanReviewRequired: count(items, (item) => item.humanReviewRequired),
    potentialFalseExecutionClaims: count(items, (item) => item.replyClaimedExecution),
    unexpectedCommandProposals: count(items, (item) =>
      item.expected?.actionProposal === false && Boolean(item.safetyResult?.commands?.length)),
    medianLatencyMs: percentile(items.filter((item) => item.status !== 'ERROR').map((item) => item.latencyMs).filter(Number.isFinite), 0.5),
    p95LatencyMs: percentile(items.filter((item) => item.status !== 'ERROR').map((item) => item.latencyMs).filter(Number.isFinite), 0.95),
  });
  return {
    overall: metrics(turns),
    categories: Object.fromEntries([...byCategory].sort(([left], [right]) => left.localeCompare(right))
      .map(([category, items]) => [category, metrics(items)])),
  };
}

export function summarizeEvaluation(manifest, records) {
  const completed = new Map(records.filter((record) => record.type === 'case_completed')
    .map((record) => [`${record.repeat}:${record.caseId}`, record.attemptId]));
  const settled = records.filter((record) => record.type === 'turn');
  const completeTurns = settled.filter((record) =>
    completed.get(`${record.repeat}:${record.caseId}`) === record.attemptId);
  const abortedCases = records.filter((record) => record.type === 'case_aborted').length;
  const settledIds = new Set(settled.map((record) => record.callId));
  const unresolvedCalls = records.filter((record) => record.type === 'call_reserved' && !settledIds.has(record.callId));
  return {
    schemaVersion: 1,
    runId: manifest.runId,
    runStatus: manifest.status,
    datasetSha256: manifest.datasetSha256,
    model: manifest.model,
    providerId: manifest.providerId,
    promptId: manifest.promptId,
    promptVersion: manifest.promptVersion,
    promptSha256: manifest.promptSha256,
    plannedCalls: manifest.plannedCalls,
    callsReserved: manifest.callsMade ?? 0,
    completedCases: completed.size,
    abortedCases,
    completeCaseTurns: completeTurns.length,
    partialOrSupersededTurns: settled.length - completeTurns.length,
    attemptedErrors: settled.filter((record) => record.status === 'ERROR').length,
    unresolvedCalls: unresolvedCalls.length,
    reportedCostCny: manifest.reportedCostCny ?? 0,
    budgetAccountedCny: manifest.accountedCostCny ?? 0,
    ...summarizeTurns(completeTurns),
  };
}

export function renderMarkdownSummary(summary) {
  const lines = [
    '# LLM 文本评测批次摘要',
    '',
    `- 批次：${summary.runId}`,
    `- 状态：${summary.runStatus}`,
    `- 模型：${summary.providerId} / ${summary.model}`,
    `- 数据集 SHA-256：${summary.datasetSha256}`,
    `- 已记账请求：${summary.callsReserved} / 计划 ${summary.plannedCalls}`,
    `- 完整 case：${summary.completedCases}；纳入自动统计的回合：${summary.completeCaseTurns}`,
    `- 非完整或被后续重试替代的回合：${summary.partialOrSupersededTurns}；只有预留、没有结果的请求：${summary.unresolvedCalls}`,
    `- 按配置单价估算费用：¥${summary.reportedCostCny.toFixed(4)}；保守预算占用：¥${summary.budgetAccountedCny.toFixed(4)}`,
    '- 费用估算由本地配置单价与用量计算；供应商实际账单及免费额度抵扣可能不同。',
    '',
    '| 类别 | 回合 | 自动检查通过 | 自动检查失败 | 错误 | 待人工复核 | 疑似虚称已执行 | 不应有的控制建议 | P95 耗时 (ms) |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const [category, metrics] of Object.entries(summary.categories)) {
    lines.push(`| ${category} | ${metrics.turns} | ${metrics.automatedPass} | ${metrics.automatedFail} | ${metrics.errors} | ${metrics.humanReviewRequired} | ${metrics.potentialFalseExecutionClaims} | ${metrics.unexpectedCommandProposals} | ${metrics.p95LatencyMs ?? '-'} |`);
  }
  lines.push('', '自动检查只验证标注的结构化字段和有限的关键词/安全条件，不等于回答质量准确率。知识题使用固定资料注入，不验证知识库检索；本批次没有 ASR、TTS 或真实设备动作。疑似虚称执行仅是待复核标记，不直接判定事实。', '');
  return lines.join('\n');
}

async function main() {
  const runDir = process.argv[2] ? path.resolve(process.argv[2]) : null;
  if (!runDir || process.argv.length !== 3) throw new Error('Usage: node scripts/summarize-llm-evaluation.mjs <run-directory>');
  const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
  const records = (await readFile(path.join(runDir, 'results.jsonl'), 'utf8'))
    .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const summary = summarizeEvaluation(manifest, records);
  await writeFile(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
  await writeFile(path.join(runDir, 'summary.md'), renderMarkdownSummary(summary), 'utf8');
  console.log(JSON.stringify({ runDir, status: summary.runStatus, turns: summary.completeCaseTurns,
    automatedPass: summary.overall.automatedPass, automatedFail: summary.overall.automatedFail,
    errors: summary.overall.errors, reportedCostCny: summary.reportedCostCny }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
