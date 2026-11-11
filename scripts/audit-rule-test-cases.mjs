// Compare the production fast rules with the independently maintained test cases.
// A missing rule may proceed to LLM; a conflicting rule bypasses the LLM and is unsafe.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { matchOnlineRule } from '../apps/api/src/services/onlineRule.service.ts';

const source = fileURLToPath(new URL('../data/test-cases.json', import.meta.url));
const cases = JSON.parse(readFileSync(source, 'utf8'));
const matched = [];
const fallback = [];
const conflicts = [];
for (const item of cases) {
  const result = matchOnlineRule(item.inputText);
  if (result === null) {
    fallback.push(item.id);
    continue;
  }
  const intent = result.resultType === 'DEVICE_CONTROL' ? result.intent : null;
  if (intent !== item.expectedIntent) {
    conflicts.push({ id: item.id, input: item.inputText,
      expectedIntent: item.expectedIntent, actualIntent: intent });
  } else {
    matched.push(item.id);
  }
}

console.log(JSON.stringify({ source, total: cases.length, matched: matched.length,
  deferredToOtherRoutes: fallback.length, conflicts }, null, 2));
if (conflicts.length > 0) process.exitCode = 1;
