import { z } from 'zod';
import { readJsonFile, writeJsonFile } from '../storage.js';

const FILE_NAME = 'device-voice-volumes.json';
export const DEFAULT_DEVICE_VOLUME = 20;
export const DeviceVolumeSchema = z.number().int().min(5).max(80);
const VolumeSettingsSchema = z.record(z.string(), DeviceVolumeSchema);
let mutationQueue: Promise<unknown> = Promise.resolve();

export async function getDeviceVolume(deviceId: string): Promise<number> {
  const settings = VolumeSettingsSchema.parse(await readJsonFile(FILE_NAME, {}));
  return settings[deviceId] ?? DEFAULT_DEVICE_VOLUME;
}

export function saveDeviceVolume(deviceId: string, value: number): Promise<number> {
  const volumePercent = DeviceVolumeSchema.parse(value);
  const operation = mutationQueue.then(async () => {
    const settings = VolumeSettingsSchema.parse(await readJsonFile(FILE_NAME, {}));
    await writeJsonFile(FILE_NAME, { ...settings, [deviceId]: volumePercent });
    return volumePercent;
  });
  mutationQueue = operation.catch(() => undefined);
  return operation;
}
