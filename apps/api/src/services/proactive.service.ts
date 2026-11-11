import type { DeviceState, ProactiveDecision, ProactiveEventRequest, ProactiveSettings } from '@dongxin/shared';
import { ProactiveEventRequestSchema, ProactiveModeSchema, ProactiveSettingsSchema } from '@dongxin/shared';
import { z } from 'zod';
import * as systemRepository from '../repositories/system.repository.js';
import { getCurrentDeviceState, patchCurrentDeviceState } from './device.service.js';
import { isDeviceAudioBusy, testTts } from './voiceModuleTest.service.js';
import { getVoiceTestSessions } from './voiceTest.service.js';
import { getDevice } from './deviceRegistry.service.js';
import { clearProactiveConfirmation, stageProactiveConfirmation } from './proactiveConfirmation.service.js';
import { appendLog, listLogs } from './log.service.js';
import { getDeviceVolume } from '../repositories/deviceVolume.repository.js';

const UpdateProactiveSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  mode: ProactiveModeSchema.optional(),
  minIntervalMinutes: z.number().int().positive().optional(),
  quietHours: z.object({ enabled: z.boolean().optional(), start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(), end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional() }).optional(),
});
const deliveryLocks = new Set<string>();
const recentDelivery = new Map<string, number>();

export async function getProactiveSettings(): Promise<ProactiveSettings> {
  return systemRepository.getProactiveSettings();
}

export async function updateProactiveSettings(requestBody: unknown): Promise<ProactiveSettings> {
  const current = await getProactiveSettings();
  const patch = UpdateProactiveSettingsSchema.parse(requestBody);
  const nextSettings = ProactiveSettingsSchema.parse({
    ...current, ...patch, quietHours: { ...current.quietHours, ...(patch.quietHours ?? {}) },
    updatedAt: new Date().toISOString(),
  });
  await systemRepository.saveProactiveSettings(nextSettings);
  await appendLog({ type: 'PROACTIVE', summary: 'Proactive settings updated', payload: nextSettings });
  return nextSettings;
}

/** Device events may deliver audio. The development endpoint below never changes real occupancy state. */
export async function handleProactiveEvent(requestBody: unknown, deliverToDevice = false): Promise<ProactiveDecision> {
  const event = ProactiveEventRequestSchema.parse(requestBody);
  const settings = await getProactiveSettings();
  const state = getCurrentDeviceState(event.deviceId);
  if (deliverToDevice && deliveryLocks.has(event.deviceId)) return skipped(state, '设备正在处理主动播报');
  if (deliverToDevice) deliveryLocks.add(event.deviceId);
  try {
    const decision = await decideProactiveAction(event, settings, state);
    const ageMs = event.occurredAt ? Date.now() - Date.parse(event.occurredAt) : 0;
    if (!Number.isFinite(ageMs) || ageMs > 30_000 || ageMs < -5_000) return skipped(state, '事件已过期或时间异常');
    const currentState = patchCurrentDeviceState(mapEventToStatePatch(event), event.deviceId);
    if (deliverToDevice && decision.shouldSpeak) {
      const unavailable = await deviceUnavailableReason(event.deviceId, state);
      if (unavailable) return skipped(currentState, unavailable);
      try {
        clearProactiveConfirmation(event.deviceId);
        await testTts({
          deviceId: event.deviceId, text: decision.speak.slice(0, 100), target: 'DEVICE',
          volumePercent: await getDeviceVolume(event.deviceId),
          listenAfterPlayback: true,
        }, { onCreated: (id) => {
          if (decision.requiresConfirm && decision.suggestedIntent) {
            stageProactiveConfirmation(event.deviceId, id, decision.suggestedIntent);
          }
        } });
        recentDelivery.set(event.deviceId, Date.now());
        if (recentDelivery.size > 100_000) {
          const oldest = recentDelivery.keys().next().value;
          if (oldest) recentDelivery.delete(oldest);
        }
      } catch (error) {
        await appendLog({ type: 'ERROR', summary: 'Proactive playback delivery failed', payload: {
          deviceId: event.deviceId, eventType: event.eventType,
          error: error instanceof Error ? error.message : String(error),
        } });
        return skipped(currentState, '主动播报未送达设备');
      }
    }
    await appendLog({ type: 'PROACTIVE', summary: `${event.eventType}: ${decision.shouldSpeak ? 'speak' : 'skip'}`, payload: { event, decision } });
    return { ...decision, deviceState: currentState };
  } finally {
    if (deliverToDevice) deliveryLocks.delete(event.deviceId);
  }
}

export async function listProactiveLogs(limit = 20) {
  return listLogs({ type: 'PROACTIVE', limit });
}

/** Development-only sensor event; never writes device state or sends a load command. */
export async function simulateProactiveEvent(requestBody: unknown) {
  const body = z.object({
    deviceId: z.string().min(1),
    eventType: z.enum(['OCCUPANCY_ENTER', 'LOW_TEMPERATURE', 'HIGH_HUMIDITY', 'LONG_RUNNING']),
    ambientTemperature: z.number().min(-10).max(50).nullable().optional(),
    humidity: z.number().min(0).max(100).nullable().optional(),
    playToDevice: z.boolean().default(false), volumePercent: z.number().int().min(5).max(80).default(20),
  }).parse(requestBody);
  const event: ProactiveEventRequest = {
    deviceId: body.deviceId, eventType: body.eventType,
    hasOccupancy: body.eventType === 'OCCUPANCY_ENTER' ? true : undefined,
    ambientTemperature: body.ambientTemperature, humidity: body.humidity,
  };
  const state = { ...getCurrentDeviceState(body.deviceId), ...mapEventToStatePatch(event) };
  const decision = await decideProactiveAction(event, await getProactiveSettings(), state);
  let playback: Awaited<ReturnType<typeof testTts>> | null = null;
  if (body.playToDevice && decision.shouldSpeak) {
    const unavailable = await deviceUnavailableReason(body.deviceId, state);
    if (unavailable) throw new Error(unavailable);
    clearProactiveConfirmation(body.deviceId);
    playback = await testTts({
      deviceId: body.deviceId, text: decision.speak.slice(0, 100), target: 'DEVICE',
      volumePercent: body.volumePercent, listenAfterPlayback: true,
    }, { onCreated: (id) => {
      if (decision.requiresConfirm && decision.suggestedIntent) stageProactiveConfirmation(body.deviceId, id, decision.suggestedIntent);
    } });
  }
  await appendLog({ type: 'PROACTIVE', summary: 'Development sensor simulation',
    payload: { event, decision, simulation: true, playbackId: playback && 'id' in playback ? playback.id : null } });
  return { simulation: true, actionExecuted: false, event, decision, playback,
    note: '模拟事件不写入真实设备状态；播报后不会自动执行设备动作' };
}

export async function simulateProactiveEntrance(requestBody: unknown) {
  return simulateProactiveEvent({ ...z.object({ deviceId: z.string().min(1),
    ambientTemperature: z.number().nullable().optional(), playToDevice: z.boolean().optional(),
    volumePercent: z.number().optional() }).parse(requestBody), eventType: 'OCCUPANCY_ENTER' });
}

function mapEventToStatePatch(event: ProactiveEventRequest): Partial<DeviceState> {
  return {
    ambientTemperature: event.ambientTemperature ?? undefined,
    humidity: event.humidity ?? undefined,
    hasOccupancy: event.hasOccupancy ?? undefined,
  };
}

async function deviceUnavailableReason(deviceId: string, state: DeviceState): Promise<string | null> {
  const device = await getDevice(deviceId);
  if (device.status !== 'ONLINE' || device.capabilities?.audioPlayback !== true) return '设备离线或不支持播报';
  if (state.voiceBroadcastEnabled === false) return '设备已关闭语音播报';
  if (isDeviceAudioBusy(deviceId)) return '设备正在播放音频';
  if ((await getVoiceTestSessions(deviceId)).some((session) =>
    !['COMPLETED', 'CANCELLED', 'FAILED'].includes(session.status))) return '设备正在进行语音会话';
  return null;
}

async function decideProactiveAction(event: ProactiveEventRequest, settings: ProactiveSettings, state: DeviceState): Promise<ProactiveDecision> {
  if (!settings.enabled) return skipped(state, '主动沟通未开启');
  if (event.occurredAt) {
    const ageMs = Date.now() - Date.parse(event.occurredAt);
    if (!Number.isFinite(ageMs) || ageMs > 30_000 || ageMs < -5_000) return skipped(state, '事件已过期或时间异常');
  }
  if (isQuietHours(settings, new Date().toISOString())) return skipped(state, '安静时段不主动播报');
  const lastDelivery = recentDelivery.get(event.deviceId);
  if (lastDelivery && Date.now() - lastDelivery < settings.minIntervalMinutes * 60_000) return skipped(state, '距离上次主动播报过近');
  if (await getRecentProactiveLogAgeMinutes(event.deviceId) < settings.minIntervalMinutes) return skipped(state, '距离上次主动播报过近');
  const choices = {
    OCCUPANCY_ENTER: { intent: null, reason: '有人进入浴室',
      speak: { PRACTICAL: '你来了，有什么需要我帮忙的吗？', RELAXED: '欢迎回来，今天想让我帮你做点什么？', QUIET: '有什么需要吗？' } },
    LOW_TEMPERATURE: { intent: 'HEAT_WEAK_ON', reason: '环境温度偏低',
      speak: { PRACTICAL: '浴室温度偏低，要不要先开弱暖？', RELAXED: '现在有点冷，要不要先暖起来？', QUIET: '要开弱暖吗？' } },
    HIGH_HUMIDITY: { intent: 'VENTILATION_ON', reason: '环境湿度偏高',
      speak: { PRACTICAL: '浴室湿度偏高，要不要打开换气？', RELAXED: '浴室有点闷，要不要换换气？', QUIET: '要打开换气吗？' } },
    LONG_RUNNING: { intent: 'STANDBY', reason: '设备运行时间较长',
      speak: { PRACTICAL: '设备已经运行一段时间，要不要关闭？', RELAXED: '已经运行一会儿了，要不要关掉？', QUIET: '要关闭设备吗？' } },
  } as const;
  if (event.eventType === 'OCCUPANCY_LEAVE') return skipped(state, '当前事件不需要主动播报');
  const choice = choices[event.eventType];
  const temperature = event.ambientTemperature;
  const humidity = event.humidity;
  const sensorSummary = event.eventType === 'OCCUPANCY_ENTER' && settings.mode !== 'QUIET'
    ? [temperature != null && Number.isFinite(temperature) ? `温度${temperature}度` : null,
       humidity != null && Number.isFinite(humidity) ? `湿度${humidity}%` : null].filter(Boolean).join('，')
    : '';
  const speak = sensorSummary ? `你来了，浴室现在${sensorSummary}。有什么需要我帮忙的吗？` : choice.speak[settings.mode];
  return { shouldSpeak: true, speak, requiresConfirm: choice.intent !== null,
    suggestedIntent: choice.intent, reason: choice.reason, deviceState: state };
}

function skipped(state: DeviceState, reason: string): ProactiveDecision {
  return { shouldSpeak: false, speak: '', requiresConfirm: false, suggestedIntent: null, reason, deviceState: state };
}

function isQuietHours(settings: ProactiveSettings, isoTime: string): boolean {
  if (!settings.quietHours.enabled) return false;
  const instant = new Date(isoTime);
  if (!Number.isFinite(instant.getTime())) return true;
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(instant);
  return settings.quietHours.start <= settings.quietHours.end
    ? time >= settings.quietHours.start && time < settings.quietHours.end
    : time >= settings.quietHours.start || time < settings.quietHours.end;
}

async function getRecentProactiveLogAgeMinutes(deviceId: string): Promise<number> {
  const logs = await listLogs({ type: 'PROACTIVE', limit: 1000 });
  const lastSpeak = logs.find((log) => {
    const event = log.payload.event;
    const decision = log.payload.decision;
    return log.payload.simulation !== true && typeof event === 'object' && event !== null &&
      'deviceId' in event && event.deviceId === deviceId && typeof decision === 'object' &&
      decision !== null && 'shouldSpeak' in decision && decision.shouldSpeak === true;
  });
  return lastSpeak ? (Date.now() - new Date(lastSpeak.createdAt).getTime()) / 60000 : Number.POSITIVE_INFINITY;
}
