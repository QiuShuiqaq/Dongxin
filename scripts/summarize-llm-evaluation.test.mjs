import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMarkdownSummary, summarizeEvaluation } from './summarize-llm-evaluation.mjs';

test('summary excludes interrupted attempts and keeps budget totals', () => {
  const manifest = {
    runId: 'sample', status: 'COMPLETE', plannedCalls: 3, callsMade: 3,
    datasetSha256: 'abc', model: 'fixture', providerId: 'fixture',
    reportedCostCny: 0.003, accountedCostCny: 0.09,
  };
  const records = [
    { type: 'turn', callId: '1', repeat: 1, caseId: 'A', attemptId: 'old',
      dimension: 'control', evaluation: { status: 'FAIL' }, status: 'COMPLETED', latencyMs: 20 },
    { type: 'turn', callId: '2', repeat: 1, caseId: 'A', attemptId: 'new',
      dimension: 'control', evaluation: { status: 'PASS' }, status: 'COMPLETED', latencyMs: 10,
      humanReviewRequired: true, replyClaimedExecution: true },
    { type: 'case_completed', repeat: 1, caseId: 'A', attemptId: 'new' },
    { type: 'call_reserved', callId: '3', reservationCny: 0.03 },
  ];
  const result = summarizeEvaluation(manifest, records);
  assert.equal(result.completeCaseTurns, 1);
  assert.equal(result.partialOrSupersededTurns, 1);
  assert.equal(result.unresolvedCalls, 1);
  assert.equal(result.overall.automatedPass, 1);
  assert.equal(result.overall.automatedFail, 0);
  assert.equal(result.categories.control.potentialFalseExecutionClaims, 1);
  assert.equal(result.budgetAccountedCny, 0.09);
  const markdown = renderMarkdownSummary(result);
  assert.match(markdown, /按配置单价估算费用：¥0\.0030/);
  assert.match(markdown, /供应商实际账单及免费额度抵扣可能不同/);
  assert.doesNotMatch(markdown, /API 回报费用/);
});
