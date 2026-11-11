import { limitSetting } from './limits.js';

export function retentionSettings() {
  return {
    textDays: limitSetting('TEXT_RETENTION_DAYS', 90, 1, 90),
    historySessions: limitSetting('VOICE_HISTORY_MAX_SESSIONS', 1000, 1, 10000),
    historyTurns: limitSetting('VOICE_HISTORY_MAX_TURNS', 200, 1, 1000),
    testSessions: limitSetting('VOICE_TEST_MAX_SESSIONS', 100, 1, 1000),
    testTurns: limitSetting('VOICE_TEST_MAX_TURNS', 100, 1, 1000),
    events: limitSetting('DEVICE_EVENT_MAX_RECORDS', 500, 1, 100000),
    commands: limitSetting('DEVICE_COMMAND_MAX_RECORDS', 500, 1, 100000),
    logs: limitSetting('SYSTEM_LOG_MAX_RECORDS', 1000, 1, 100000),
  };
}

export function retainRecent<T>(records: T[], time: (item: T) => string, max: number, now = Date.now()): T[] {
  const cutoff = now - retentionSettings().textDays * 86400000;
  return records.filter((item) => {
    const timestamp = Date.parse(time(item));
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  }).sort((a, b) => Date.parse(time(a)) - Date.parse(time(b))).slice(-max);
}
