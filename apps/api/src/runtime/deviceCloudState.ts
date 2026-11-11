import type { DeviceCloudState, DeviceIntent, DeviceState } from '@dongxin/shared';
import { DeviceCloudStateSchema, DeviceStateSchema } from '@dongxin/shared';

const InitialReportSchema = DeviceCloudStateSchema.pick({
  isOnline: true, power: true, light: true, heater: true, ventilation: true,
  fan: true, swing: true, dry: true, bathMode: true, constantTemperature: true,
  targetTemperature: true, ambientTemperature: true, hasOccupancy: true, faultCode: true,
}).required();

export function initialDeviceStateFromCloud(report: DeviceCloudState): DeviceState {
  const full = InitialReportSchema.parse(report);
  return DeviceStateSchema.parse({
    isOnline: full.isOnline,
    activeModes: mapCloudModes(report, []),
    targetTemperature: full.targetTemperature,
    ambientTemperature: full.ambientTemperature,
    humidity: report.humidity ?? null,
    hasOccupancy: full.hasOccupancy,
    voiceBroadcastEnabled: true,
    faultCode: full.faultCode,
    updatedAt: new Date().toISOString(),
  });
}

export function deviceStateChanged(previous: DeviceState, current: DeviceState): boolean {
  return previous.isOnline !== current.isOnline ||
    previous.targetTemperature !== current.targetTemperature ||
    previous.ambientTemperature !== current.ambientTemperature ||
    previous.humidity !== current.humidity ||
    previous.hasOccupancy !== current.hasOccupancy ||
    previous.voiceBroadcastEnabled !== current.voiceBroadcastEnabled ||
    previous.faultCode !== current.faultCode ||
    JSON.stringify([...previous.activeModes].sort()) !== JSON.stringify([...current.activeModes].sort());
}

export function cloudStateToDeviceStatePatch(state: DeviceCloudState, previous: DeviceState): Partial<DeviceState> {
  const patch: Partial<DeviceState> = {
    isOnline: state.isOnline,
    ambientTemperature: state.ambientTemperature ?? undefined,
    humidity: state.humidity ?? undefined,
    hasOccupancy: state.hasOccupancy ?? undefined,
    faultCode: state.faultCode,
  };

  if (typeof state.targetTemperature === 'number' && state.targetTemperature >= 30 && state.targetTemperature <= 45) {
    patch.targetTemperature = state.targetTemperature;
  }
  if (hasModeUpdate(state)) patch.activeModes = mapCloudModes(state, previous.activeModes);
  return patch;
}

function hasModeUpdate(state: DeviceCloudState): boolean {
  return ['power', 'light', 'heater', 'ventilation', 'fan', 'swing', 'dry',
    'bathMode', 'constantTemperature'].some((key) => key in state);
}

function mapCloudModes(state: DeviceCloudState, previous: DeviceIntent[]): DeviceIntent[] {
  if (state.power === 'off') return [];
  let modes = [...previous];
  const switches = { light: 'LIGHT_ON', ventilation: 'VENTILATION_ON', fan: 'FAN_ON',
    swing: 'SWING_ON', dry: 'DRY_ON', bathMode: 'BATH_MODE_ON',
    constantTemperature: 'CONSTANT_TEMP_ON' } as const;
  for (const [key, intent] of Object.entries(switches)) {
    const value = state[key as keyof typeof switches];
    if (value === undefined) continue;
    modes = modes.filter((mode) => mode !== intent);
    if (value === 'on') modes.push(intent);
  }
  if (state.heater !== undefined) {
    modes = modes.filter((mode) => mode !== 'HEAT_WEAK_ON' && mode !== 'HEAT_STRONG_ON');
    if (state.heater === 'weak') modes.push('HEAT_WEAK_ON');
    if (state.heater === 'strong') modes.push('HEAT_STRONG_ON');
    if (state.heater === 'off') modes = modes.filter((mode) => mode !== 'BATH_MODE_ON' && mode !== 'CONSTANT_TEMP_ON');
  }
  return modes;
}
