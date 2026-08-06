import type { DeviceIntent, DeviceState } from '@dongxin/shared';

const initialState: DeviceState = {
  isOnline: true,
  activeModes: [],
  targetTemperature: 40,
  ambientTemperature: 26,
  humidity: 58,
  hasOccupancy: true,
  voiceBroadcastEnabled: true,
  faultCode: null,
  updatedAt: new Date().toISOString()
};

let currentState: DeviceState = initialState;

const exclusiveModeIntents = new Set<DeviceIntent>([
  'HEAT_WEAK_ON',
  'HEAT_STRONG_ON',
  'DRY_ON',
  'DEFOG_ON',
  'BATH_MODE_ON',
  'CONSTANT_TEMP_ON'
]);

function addMode(intent: DeviceIntent) {
  const activeModes = exclusiveModeIntents.has(intent)
    ? currentState.activeModes.filter((mode) => !exclusiveModeIntents.has(mode))
    : [...currentState.activeModes];

  if (!activeModes.includes(intent)) {
    activeModes.push(intent);
  }

  currentState = {
    ...currentState,
    activeModes,
    updatedAt: new Date().toISOString()
  };
}

function removeMode(intent: DeviceIntent) {
  currentState = {
    ...currentState,
    activeModes: currentState.activeModes.filter((mode) => mode !== intent),
    updatedAt: new Date().toISOString()
  };
}

export function getDeviceState(): DeviceState {
  return currentState;
}

export function patchDeviceState(patch: Partial<DeviceState>): DeviceState {
  currentState = {
    ...currentState,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  return currentState;
}

export function applyDeviceCommand(intent: DeviceIntent, slots: Record<string, unknown> = {}): DeviceState {
  switch (intent) {
    case 'STANDBY':
      currentState = {
        ...currentState,
        activeModes: currentState.activeModes.filter((mode) =>
          ['LIGHT_ON', 'NIGHT_LIGHT_ON'].includes(mode)
        ),
        updatedAt: new Date().toISOString()
      };
      break;
    case 'LIGHT_OFF':
      removeMode('LIGHT_ON');
      break;
    case 'NIGHT_LIGHT_OFF':
      removeMode('NIGHT_LIGHT_ON');
      break;
    case 'HEAT_WEAK_OFF':
      removeMode('HEAT_WEAK_ON');
      break;
    case 'HEAT_STRONG_OFF':
      removeMode('HEAT_STRONG_ON');
      break;
    case 'FAN_OFF':
      removeMode('FAN_ON');
      break;
    case 'VENTILATION_OFF':
      removeMode('VENTILATION_ON');
      break;
    case 'SWING_OFF':
      removeMode('SWING_ON');
      break;
    case 'PURIFY_OFF':
      removeMode('PURIFY_ON');
      break;
    case 'DRY_OFF':
      removeMode('DRY_ON');
      break;
    case 'DEFOG_OFF':
      removeMode('DEFOG_ON');
      break;
    case 'BATH_MODE_OFF':
      removeMode('BATH_MODE_ON');
      break;
    case 'CONSTANT_TEMP_OFF':
      removeMode('CONSTANT_TEMP_ON');
      break;
    case 'SET_TEMP':
      currentState = {
        ...currentState,
        targetTemperature:
          typeof slots.temperature === 'number' ? slots.temperature : currentState.targetTemperature,
        updatedAt: new Date().toISOString()
      };
      break;
    case 'VOICE_BROADCAST_OFF':
      currentState = {
        ...currentState,
        voiceBroadcastEnabled: false,
        updatedAt: new Date().toISOString()
      };
      break;
    case 'VOICE_BROADCAST_ON':
      currentState = {
        ...currentState,
        voiceBroadcastEnabled: true,
        updatedAt: new Date().toISOString()
      };
      break;
    default:
      addMode(intent);
  }

  return currentState;
}
