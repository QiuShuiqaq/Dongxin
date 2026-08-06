import type { DeviceState, ProactiveDecision, ProactiveEventRequest, ProactiveSettings } from '@dongxin/shared';
import { ProactiveEventRequestSchema, ProactiveModeSchema, ProactiveSettingsSchema } from '@dongxin/shared';
import { z } from 'zod';
import * as systemRepository from '../repositories/system.repository.js';
import { patchCurrentDeviceState } from './device.service.js';
import { appendLog, listLogs } from './log.service.js';

const UpdateProactiveSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  mode: ProactiveModeSchema.optional(),
  minIntervalMinutes: z.number().int().positive().optional(),
  quietHours: z
    .object({
      enabled: z.boolean().optional(),
      start: z.string().optional(),
      end: z.string().optional()
    })
    .optional()
});

export async function getProactiveSettings(): Promise<ProactiveSettings> {
  return systemRepository.getProactiveSettings();
}

export async function updateProactiveSettings(requestBody: unknown): Promise<ProactiveSettings> {
  const current = await getProactiveSettings();
  const patch = UpdateProactiveSettingsSchema.parse(requestBody);
  const nextSettings = ProactiveSettingsSchema.parse({
    ...current,
    ...patch,
    quietHours: {
      ...current.quietHours,
      ...(patch.quietHours ?? {})
    },
    updatedAt: new Date().toISOString()
  });

  await systemRepository.saveProactiveSettings(nextSettings);
  await appendLog({
    type: 'PROACTIVE',
    summary: 'Proactive settings updated',
    payload: nextSettings
  });
  return nextSettings;
}

export async function handleProactiveEvent(requestBody: unknown): Promise<ProactiveDecision> {
  const body = ProactiveEventRequestSchema.parse(requestBody);
  const settings = await getProactiveSettings();
  const currentState = patchCurrentDeviceState(mapEventToStatePatch(body));
  const decision = await decideProactiveAction(body, settings, currentState);

  await appendLog({
    type: 'PROACTIVE',
    summary: `${body.eventType}: ${decision.shouldSpeak ? 'speak' : 'skip'}`,
    payload: {
      event: body,
      decision
    }
  });

  return decision;
}

export async function listProactiveLogs(limit = 20) {
  return listLogs({ type: 'PROACTIVE', limit });
}

function mapEventToStatePatch(event: ProactiveEventRequest): Partial<DeviceState> {
  return {
    ambientTemperature: event.ambientTemperature ?? undefined,
    humidity: event.humidity ?? undefined,
    hasOccupancy: event.hasOccupancy ?? undefined
  };
}

async function decideProactiveAction(
  event: ProactiveEventRequest,
  settings: ProactiveSettings,
  state: DeviceState
): Promise<ProactiveDecision> {
  if (!settings.enabled) {
    return {
      shouldSpeak: false,
      speak: '',
      requiresConfirm: false,
      suggestedIntent: null,
      reason: '主动沟通未开启',
      deviceState: state
    };
  }

  if (isQuietHours(settings, event.occurredAt ?? new Date().toISOString()) && settings.mode === 'QUIET') {
    return {
      shouldSpeak: false,
      speak: '',
      requiresConfirm: false,
      suggestedIntent: null,
      reason: '安静模式下不主动播报',
      deviceState: state
    };
  }

  const recentMinutes = await getRecentProactiveLogAgeMinutes();
  if (recentMinutes < settings.minIntervalMinutes) {
    return {
      shouldSpeak: false,
      speak: '',
      requiresConfirm: false,
      suggestedIntent: null,
      reason: '距离上次主动沟通太近',
      deviceState: state
    };
  }

  switch (event.eventType) {
    case 'OCCUPANCY_ENTER':
      return buildDecision(state, 'HEAT_WEAK_ON', pickVoice(settings.mode, {
        PRACTICAL: '你来了，浴室现在有点凉，要不要先开弱暖？',
        RELAXED: '欢迎回来，先帮你把浴室暖一下吧？',
        QUIET: '你来了，要不要开弱暖？'
      }), '有人进入浴室');
    case 'LOW_TEMPERATURE':
      return buildDecision(state, 'HEAT_WEAK_ON', pickVoice(settings.mode, {
        PRACTICAL: '浴室温度偏低，要不要先开弱暖？',
        RELAXED: '现在有点冷，要不要先暖起来？',
        QUIET: '温度偏低，要不要开弱暖？'
      }), '环境温度偏低');
    case 'HIGH_HUMIDITY':
      return buildDecision(state, 'VENTILATION_ON', pickVoice(settings.mode, {
        PRACTICAL: '浴室湿度有点高，要不要开一会儿换气？',
        RELAXED: '浴室有点闷，换气一下会更舒服。要不要开？',
        QUIET: '湿度较高，要不要开换气？'
      }), '环境湿度偏高');
    case 'LONG_RUNNING':
      return buildDecision(state, 'STANDBY', pickVoice(settings.mode, {
        PRACTICAL: '设备已经运行一段时间了，要不要检查一下是否需要关闭？',
        RELAXED: '已经运行一会儿了，要不要看下要不要收一收？',
        QUIET: '设备运行较久，建议确认是否需要关闭。'
      }), '设备长时间运行');
    case 'OCCUPANCY_LEAVE':
    default:
      return {
        shouldSpeak: false,
        speak: '',
        requiresConfirm: false,
        suggestedIntent: null,
        reason: '当前事件不需要主动播报',
        deviceState: state
      };
  }
}

function buildDecision(
  state: DeviceState,
  suggestedIntent: ProactiveDecision['suggestedIntent'],
  speak: string,
  reason: string
): ProactiveDecision {
  return {
    shouldSpeak: true,
    speak,
    requiresConfirm: true,
    suggestedIntent,
    reason,
    deviceState: state
  };
}

function pickVoice(
  mode: ProactiveSettings['mode'],
  options: Record<ProactiveSettings['mode'], string>
): string {
  return options[mode];
}

function isQuietHours(settings: ProactiveSettings, isoTime: string): boolean {
  if (!settings.quietHours.enabled) {
    return false;
  }

  const time = isoTime.slice(11, 16);
  return settings.quietHours.start <= settings.quietHours.end
    ? time >= settings.quietHours.start && time <= settings.quietHours.end
    : time >= settings.quietHours.start || time <= settings.quietHours.end;
}

async function getRecentProactiveLogAgeMinutes(): Promise<number> {
  const logs = await listLogs({ type: 'PROACTIVE', limit: 1 });
  if (!logs.length) {
    return Number.POSITIVE_INFINITY;
  }

  return (Date.now() - new Date(logs[0].createdAt).getTime()) / 60000;
}
