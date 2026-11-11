import { readJsonFile, updateJsonFile } from '../storage.js';
import { ApiError } from '../http/apiError.js';
import { decimalSetting, limitSetting } from './limits.js';

export type AiStage = 'ASR' | 'LLM' | 'TTS';
type Usage = { date: string; ASR: number; LLM: number; TTS: number; estimatedCostCny: number; failed: number };
const file = 'runtime-ai-usage.json';
const day = () => new Date().toISOString().slice(0, 10);
const empty = (): Usage => ({ date: day(), ASR: 0, LLM: 0, TTS: 0, estimatedCostCny: 0, failed: 0 });
let current = empty();

export async function initializeUsage(): Promise<void> {
  const saved = await readJsonFile(file, empty());
  current = saved.date === day() ? saved : empty();
}

// Reserve before entering a provider. Persisting the attempt prevents a restart
// from silently resetting daily limits. Concurrent calls share the file transaction.
export async function reserveAiAttempt(stage: AiStage): Promise<void> {
  current = await updateJsonFile<Usage, Usage>(file, empty(), (saved) => {
    const value = saved.date === day() ? saved : empty();
    const cap = limitSetting(`${stage}_DAILY_CALL_LIMIT`, 0, 0);
    const budget = decimalSetting('AI_DAILY_ESTIMATED_BUDGET_CNY');
    if ((cap && value[stage] >= cap) || (budget > 0 && value.estimatedCostCny >= budget)) {
      throw new ApiError(429, 'AI_DAILY_LIMIT', '今日在线服务额度已达上限');
    }
    value[stage]++;
    return { value, result: { ...value } };
  });
}

export async function recordAiOutcome(date: string, costCny: number, failed: boolean): Promise<void> {
  current = await updateJsonFile<Usage, Usage>(file, empty(), (saved) => {
    const value = saved.date === day() ? saved : empty();
    if (date === value.date) {
      value.estimatedCostCny += Number.isFinite(costCny) ? Math.max(0, costCny) : 0;
      if (failed) value.failed++;
    }
    return { value, result: { ...value } };
  });
}

export function getUsageStatus() {
  return { ...(current.date === day() ? current : empty()), scope: 'PERSISTED_UTC_DAY', billing: 'ESTIMATE_NOT_PROVIDER_INVOICE',
    dailyLimits: { ASR: limitSetting('ASR_DAILY_CALL_LIMIT', 0, 0), LLM: limitSetting('LLM_DAILY_CALL_LIMIT', 0, 0), TTS: limitSetting('TTS_DAILY_CALL_LIMIT', 0, 0) },
    budgetCny: decimalSetting('AI_DAILY_ESTIMATED_BUDGET_CNY') };
}
