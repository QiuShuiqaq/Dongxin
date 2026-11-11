import { listBatchRuns } from '../repositories/aiTesting.repository.js';
import { listVoiceTestSessions } from '../repositories/voiceTest.repository.js';
import { listVoiceHistory } from '../repositories/voiceHistory.repository.js';
import { getDevice } from './deviceRegistry.service.js';
import { getMqttGatewayStatus } from './mqttGateway.service.js';
import { listDeviceAudioTests } from './voiceModuleTest.service.js';
import { listStm32LinkEvents } from './stm32Link.service.js';

export async function getDevelopmentLiveData(deviceId: string) {
  const [device, voiceTests, batchRuns, linkEvents, conversations] = await Promise.all([
    getDevice(deviceId),
    listVoiceTestSessions(),
    listBatchRuns(),
    listStm32LinkEvents(deviceId, 12),
    listVoiceHistory(deviceId, 8),
  ]);
  return {
    sampledAt: new Date().toISOString(),
    device: { id: device.id, name: device.name, status: device.status, updatedAt: device.updatedAt },
    mqtt: getMqttGatewayStatus(),
    voiceTests: voiceTests.filter((item) => item.deviceId === deviceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8)
      .map((item) => ({
        id: item.id, mode: item.mode, status: item.status, message: item.message,
        updatedAt: item.updatedAt, transcript: item.result?.transcript ?? null,
        reply: item.result?.replyText ?? null, route: item.result?.route ?? null,
        stages: item.result?.stages.map((stage) => ({ key: stage.key, status: stage.status, error: stage.error })) ?? [],
      })),
    audioTests: listDeviceAudioTests(deviceId),
    batchTests: batchRuns.filter((item) => !item.deviceId || item.deviceId === deviceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8)
      .map((item) => ({
        id: item.id, name: item.name, kind: item.kind, status: item.status,
        updatedAt: item.updatedAt, error: item.error,
        completed: item.items.length, total: item.caseIds.length * item.repeatCount,
      })),
    linkEvents: linkEvents.map((item) => ({
      id: item.id, createdAt: item.createdAt, payload: item.payload,
    })),
    conversations: conversations.map((item) => ({
      id: item.id, channel: item.channel, updatedAt: item.updatedAt,
      lastTurn: item.turns.at(-1) ?? null,
    })),
  };
}
