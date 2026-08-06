import { randomUUID } from 'node:crypto';
import type {
  DeviceCommandRecord,
  DeviceEvent,
  DeviceProfile,
  KnowledgeDocument,
  ProactiveSettings,
  SystemLog
} from '@dongxin/shared';
import {
  DeviceCommandRecordSchema,
  DeviceEventSchema,
  DeviceProfileSchema,
  KnowledgeDocumentSchema,
  ProactiveSettingsSchema,
  SystemLogSchema
} from '@dongxin/shared';
import { z } from 'zod';
import { readJsonFile, writeJsonFile } from '../storage.js';

const DEFAULT_DEVICE_ID = 'demo-bath-heater-001';

export async function listDeviceProfiles(): Promise<DeviceProfile[]> {
  const devices = await readJsonFile<DeviceProfile[]>('devices.json', [createDefaultDeviceProfile()]);
  return z.array(DeviceProfileSchema).parse(devices);
}

export async function getDeviceProfile(deviceId: string): Promise<DeviceProfile | null> {
  const devices = await listDeviceProfiles();
  return devices.find((device) => device.id === deviceId) ?? null;
}

export async function saveDeviceProfiles(devices: DeviceProfile[]): Promise<DeviceProfile[]> {
  const parsed = z.array(DeviceProfileSchema).parse(devices);
  await writeJsonFile('devices.json', parsed);
  return parsed;
}

export async function listDeviceEvents(): Promise<DeviceEvent[]> {
  const events = await readJsonFile<DeviceEvent[]>('device-events.json', []);
  return z.array(DeviceEventSchema).parse(events);
}

export async function appendDeviceEvent(event: Omit<DeviceEvent, 'id' | 'createdAt'>): Promise<DeviceEvent> {
  const nextEvent: DeviceEvent = {
    ...event,
    id: randomUUID(),
    createdAt: new Date().toISOString()
  };
  const events = await listDeviceEvents();
  await writeJsonFile('device-events.json', [...events, nextEvent].slice(-500));
  return nextEvent;
}

export async function listDeviceCommands(): Promise<DeviceCommandRecord[]> {
  const commands = await readJsonFile<DeviceCommandRecord[]>('device-commands.json', []);
  return z.array(DeviceCommandRecordSchema).parse(commands);
}

export async function appendDeviceCommand(
  command: Omit<DeviceCommandRecord, 'id' | 'createdAt'>
): Promise<DeviceCommandRecord> {
  const nextCommand: DeviceCommandRecord = {
    ...command,
    id: randomUUID(),
    createdAt: new Date().toISOString()
  };
  const commands = await listDeviceCommands();
  await writeJsonFile('device-commands.json', [...commands, nextCommand].slice(-500));
  return nextCommand;
}

export async function patchDeviceCommand(commandId: string, patch: Partial<DeviceCommandRecord>): Promise<DeviceCommandRecord | null> {
  const commands = await listDeviceCommands();
  const index = commands.findIndex((item) => item.id === commandId);
  if (index < 0) {
    return null;
  }

  const nextCommand = DeviceCommandRecordSchema.parse({
    ...commands[index],
    ...patch
  });
  const nextCommands = [...commands];
  nextCommands[index] = nextCommand;
  await writeJsonFile('device-commands.json', nextCommands);
  return nextCommand;
}

export async function listKnowledgeDocuments(): Promise<KnowledgeDocument[]> {
  const documents = await readJsonFile<KnowledgeDocument[]>('knowledge-documents.json', []);
  return z.array(KnowledgeDocumentSchema).parse(documents);
}

export async function saveKnowledgeDocuments(documents: KnowledgeDocument[]): Promise<KnowledgeDocument[]> {
  const parsed = z.array(KnowledgeDocumentSchema).parse(documents);
  await writeJsonFile('knowledge-documents.json', parsed);
  return parsed;
}

export async function getProactiveSettings(): Promise<ProactiveSettings> {
  const settings = await readJsonFile<ProactiveSettings>('proactive-settings.json', createDefaultProactiveSettings());
  return ProactiveSettingsSchema.parse(settings);
}

export async function saveProactiveSettings(settings: ProactiveSettings): Promise<ProactiveSettings> {
  const parsed = ProactiveSettingsSchema.parse(settings);
  await writeJsonFile('proactive-settings.json', parsed);
  return parsed;
}

export async function listSystemLogs(): Promise<SystemLog[]> {
  const logs = await readJsonFile<SystemLog[]>('system-logs.json', []);
  return z.array(SystemLogSchema).parse(logs);
}

export async function appendSystemLog(log: Omit<SystemLog, 'id' | 'createdAt'>): Promise<SystemLog> {
  const nextLog: SystemLog = {
    ...log,
    id: randomUUID(),
    createdAt: new Date().toISOString()
  };
  const logs = await listSystemLogs();
  await writeJsonFile('system-logs.json', [...logs, nextLog].slice(-1000));
  return nextLog;
}

function createDefaultDeviceProfile(): DeviceProfile {
  const now = new Date().toISOString();
  return {
    id: DEFAULT_DEVICE_ID,
    name: '东信浴霸样机',
    model: 'DX-AI-01',
    firmwareVersion: null,
    protocol: 'SIMULATOR',
    status: 'ONLINE',
    notes: '开发期默认样机',
    createdAt: now,
    updatedAt: now
  };
}

function createDefaultProactiveSettings(): ProactiveSettings {
  const now = new Date().toISOString();
  return {
    enabled: false,
    mode: 'PRACTICAL',
    minIntervalMinutes: 10,
    quietHours: {
      enabled: true,
      start: '22:00',
      end: '07:00'
    },
    updatedAt: now
  };
}

export { DEFAULT_DEVICE_ID };

