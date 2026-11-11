import type { AiResult } from '@dongxin/shared';
import { getVoiceKnowledge } from './knowledge.service.js';
import { matchOnlineRule } from './onlineRule.service.js';

export type LowCostIntentSource = 'rule' | 'knowledge';
export interface LowCostIntentResult { source: LowCostIntentSource; aiResult: AiResult }

/** All online entry points use the same exact-command and published-FAQ rules. */
export async function resolveLowCostIntent(inputText: string, model?: string): Promise<LowCostIntentResult | null> {
  const rule = matchOnlineRule(inputText);
  if (rule) return { source: 'rule', aiResult: rule };
  const knowledge = await getVoiceKnowledge(inputText, [], model);
  const answer = knowledge.fastAnswer ?? knowledge.blockedAnswer;
  return answer ? { source: 'knowledge', aiResult: { resultType: 'CHAT', intent: null, confidence: 1,
    slots: {}, requiresConfirm: false, speak: answer } } : null;
}
