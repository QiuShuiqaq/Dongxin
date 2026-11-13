import { randomUUID } from 'node:crypto';
import type {
  DeviceCommandRecord,
  DeviceEvent,
  DeviceProfile,
  KnowledgeDocument,
  KnowledgeSource,
  ProactiveSettings,
  SystemLog
} from '@dongxin/shared';
import {
  DeviceCommandRecordSchema,
  DeviceEventSchema,
  DeviceProfileSchema,
  KnowledgeDocumentSchema,
  KnowledgeSourceSchema,
  ProactiveSettingsSchema,
  SystemLogSchema
} from '@dongxin/shared';
import { z } from 'zod';
import { readJsonFile, writeJsonFile, updateJsonFile } from '../storage.js';
import { retainRecent, retentionSettings } from '../runtime/retention.js';
import { assertPilotDeviceLimit } from '../runtime/pilotLimits.js';
import { projectDevicePresence } from '../runtime/devicePresence.js';
import { initialKnowledgeDocuments, initialKnowledgeSources } from './knowledgeSeed.js';

const DEFAULT_DEVICE_ID = 'demo-bath-heater-001';

export async function listDeviceProfiles(): Promise<DeviceProfile[]> {
  const devices = await readJsonFile<DeviceProfile[]>('devices.json', [createDefaultDeviceProfile()]);
  return z.array(DeviceProfileSchema).parse(devices).map((device) => projectDevicePresence(device));
}

export async function getDeviceProfile(deviceId: string): Promise<DeviceProfile | null> {
  const devices = await listDeviceProfiles();
  return devices.find((device) => device.id === deviceId) ?? null;
}

export async function saveDeviceProfiles(devices: DeviceProfile[]): Promise<DeviceProfile[]> {
  const parsed = z.array(DeviceProfileSchema).parse(devices);
  assertPilotDeviceLimit(parsed);
  await writeJsonFile('devices.json', parsed);
  return parsed;
}

export function updateDeviceProfiles(update: (devices: DeviceProfile[]) => DeviceProfile[] | Promise<DeviceProfile[]>): Promise<DeviceProfile[]> {
  return updateJsonFile<DeviceProfile[], DeviceProfile[]>('devices.json', [createDefaultDeviceProfile()], async (devices) => {
    const value = z.array(DeviceProfileSchema).parse(await update(z.array(DeviceProfileSchema).parse(devices)));
    assertPilotDeviceLimit(value);
    return { value, result: value };
  });
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
  return updateJsonFile<DeviceEvent[], DeviceEvent>('device-events.json', [], (events) => ({
    value: retainRecent([...events, nextEvent], (item) => item.createdAt, retentionSettings().events), result: nextEvent,
  }));
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
  return updateJsonFile<DeviceCommandRecord[], DeviceCommandRecord>('device-commands.json', [], (commands) => ({
    value: retainRecent([...commands, nextCommand], (item) => item.createdAt, retentionSettings().commands), result: nextCommand,
  }));
}

export async function patchDeviceCommand(commandId: string, patch: Partial<DeviceCommandRecord>): Promise<DeviceCommandRecord | null> {
  return updateJsonFile<DeviceCommandRecord[], DeviceCommandRecord | null>('device-commands.json', [], (commands) => {
  const index = commands.findIndex((item) => item.id === commandId);
  if (index < 0) {
    return { value: commands, result: null };
  }

  const nextCommand = DeviceCommandRecordSchema.parse({
    ...commands[index],
    ...patch
  });
  const nextCommands = [...commands];
  nextCommands[index] = nextCommand;
  return { value: nextCommands, result: nextCommand };
  });
}

export function finishDeviceCommand(
  deviceId: string,
  commandId: string,
  status: 'APPLIED' | 'REJECTED' | 'FAILED',
  completedAt = new Date().toISOString(),
): Promise<{ command: DeviceCommandRecord; outcome: 'UPDATED' | 'DUPLICATE' | 'CONFLICT' } | null> {
  return updateJsonFile<DeviceCommandRecord[], { command: DeviceCommandRecord; outcome: 'UPDATED' | 'DUPLICATE' | 'CONFLICT' } | null>(
    'device-commands.json', [], (commands) => {
      const index = commands.findIndex((item) => item.id === commandId && item.deviceId === deviceId);
      if (index < 0) return { value: commands, result: null };

      const current = DeviceCommandRecordSchema.parse(commands[index]);
      if (current.status === 'APPLIED' || current.status === 'REJECTED' || current.status === 'FAILED') {
        return { value: commands, result: { command: current, outcome: current.status === status ? 'DUPLICATE' : 'CONFLICT' } };
      }
      if (current.status !== 'QUEUED') {
        return { value: commands, result: { command: current, outcome: 'CONFLICT' } };
      }

      const command = DeviceCommandRecordSchema.parse({ ...current, status, completedAt });
      const next = [...commands];
      next[index] = command;
      return { value: next, result: { command, outcome: 'UPDATED' } };
    },
  );
}

let knowledgeSeedPromise: Promise<void> | null = null;

async function ensureInitialKnowledge(): Promise<void> {
  if (!knowledgeSeedPromise) {
    knowledgeSeedPromise = (async () => {
      const state = await readJsonFile('knowledge-seed-state.json', { applied: false, curationVersion: 0 });
      if (state.applied && state.curationVersion >= 4) return;
      const documents = await readJsonFile<KnowledgeDocument[]>('knowledge-documents.json', []);
      if (!state.applied && !documents.length) await writeJsonFile('knowledge-documents.json', initialKnowledgeDocuments);
      else {
        const migrated = documents.map((document) => {
          const seed = initialKnowledgeDocuments.find((item) => item.id === document.id);
          return (state.curationVersion ?? 0) < 2 && seed && document.updatedBy === 'initial-curation' ? { ...document, questionVariants: seed.questionVariants } : document;
        });
        // Add only this release's new curated facts. Never recreate old entries
        // that operators have removed, or overwrite manually edited knowledge.
        const newIds = new Set(['dx-company-founded', 'dx-company-oem', 'dx-company-quality', 'dx-company-laboratory', 'dx-company-mes', 'dx-company-brand']);
        if ((state.curationVersion ?? 0) < 4) initialKnowledgeDocuments.filter((seed) => seed.id.startsWith('dx-topic-')).forEach((seed) => newIds.add(seed.id));
        migrated.push(...initialKnowledgeDocuments.filter((seed) => newIds.has(seed.id) && !documents.some((document) => document.id === seed.id)));
        await writeJsonFile('knowledge-documents.json', migrated);
      }
      const sources = await readJsonFile<KnowledgeSource[]>('knowledge-sources.json', initialKnowledgeSources);
      if ((state.curationVersion ?? 0) < 4) {
        await writeJsonFile('knowledge-sources.json', sources.map((source) => {
          const latest = initialKnowledgeSources.find((item) => item.id === source.id);
          return ['dx-company-publicity', 'dx-ip-list', 'dx-awards-list'].includes(source.id) && source.processingStatus === 'CATALOGUED' && latest
            ? { ...source, processingStatus: latest.processingStatus, note: latest.note, scope: latest.scope } : source;
        }));
      }
      await writeJsonFile('knowledge-seed-state.json', { applied: true, curationVersion: 4 });
    })().catch((error: unknown) => {
      knowledgeSeedPromise = null;
      throw error;
    });
  }
  await knowledgeSeedPromise;
}

export async function listKnowledgeSources(): Promise<KnowledgeSource[]> {
  await ensureInitialKnowledge();
  const sources = await readJsonFile<KnowledgeSource[]>('knowledge-sources.json', []);
  return z.array(KnowledgeSourceSchema).parse(sources.map((source) => ({ ...initialKnowledgeSources.find((item) => item.id === source.id), ...source })));
}

export async function saveKnowledgeSources(sources: KnowledgeSource[]): Promise<void> {
  await writeJsonFile('knowledge-sources.json', z.array(KnowledgeSourceSchema).parse(sources));
}

export async function listKnowledgeDocuments(): Promise<KnowledgeDocument[]> {
  await ensureInitialKnowledge();
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
  return updateJsonFile<SystemLog[], SystemLog>('system-logs.json', [], (logs) => ({
    value: retainRecent([...logs, nextLog], (item) => item.createdAt, retentionSettings().logs), result: nextLog,
  }));
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

