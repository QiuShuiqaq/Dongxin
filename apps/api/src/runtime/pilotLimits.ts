import type { DeviceProfile } from '@dongxin/shared';

export const PILOT_DEVICE_LIMIT = 20;

export function assertPilotDeviceLimit(
  devices: DeviceProfile[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV !== 'production' ||
      env.DONGXIN_PILOT_JSON_MODE !== 'acknowledge-local-json-limits') return;
  const physicalIds = devices.filter((device) => device.protocol !== 'SIMULATOR').map((device) => device.id);
  if (new Set(physicalIds).size !== physicalIds.length) {
    throw new Error('Hardware pilot contains duplicate device IDs');
  }
  if (physicalIds.length > PILOT_DEVICE_LIMIT) {
    throw new Error(`Single-instance JSON hardware pilot is limited to ${PILOT_DEVICE_LIMIT} devices`);
  }
}
