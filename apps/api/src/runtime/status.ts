import { getWorkloadStatus } from './workload.js';
import { getRetentionStatus } from './maintenance.js';
import { speechCache } from './ttsCache.js';
import { voiceRequestReplay } from './requestReplay.js';
import { limitSetting } from './limits.js';
import { voiceHistoryBackend } from '../repositories/voiceHistory.repository.js';

export function getRuntimeStatus() {
  // Validate deadline configuration even before the first request.
  limitSetting('VOICE_TASK_TIMEOUT_MS', 10000, 100);
  limitSetting('AI_STAGE_TIMEOUT_MS', 10000, 100);
  return { at: new Date().toISOString(), mode: 'SINGLE_PROCESS', ...getWorkloadStatus(),
    storage: { voiceHistory: voiceHistoryBackend() },
    retention: getRetentionStatus(), ttsCache: speechCache.snapshot(), requestReplay: voiceRequestReplay.snapshot() };
}
