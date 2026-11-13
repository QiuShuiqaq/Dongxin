import type { DeviceProfile } from '@dongxin/shared';

export const OPERATIONAL_PILOT_ID_PATTERN = '^DX-PILOT-[A-Z0-9]+(-[A-Z0-9]+)*$';
export const DEVELOPMENT_MODEL_PATTERN = '(SIMULATOR|SUPERMINI|LICHUANG|DEVKIT)';

const pilotId = new RegExp(OPERATIONAL_PILOT_ID_PATTERN);
const developmentModel = new RegExp(DEVELOPMENT_MODEL_PATTERN, 'i');

export function isOperationalDevice(device: Pick<DeviceProfile, 'id' | 'model' | 'protocol'>): boolean {
  if (device.protocol === 'SIMULATOR') return false;
  if (!developmentModel.test(device.model)) return true;

  // A provisioned MQTT pilot is physical even when its hardware model names a development board.
  return device.protocol === 'MQTT' && /LICHUANG/i.test(device.model)
    && !/(SIMULATOR|SUPERMINI|DEVKIT)/i.test(device.model) && pilotId.test(device.id);
}
