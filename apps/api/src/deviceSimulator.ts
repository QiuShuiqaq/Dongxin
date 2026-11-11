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

function createSimulator(isDefault: boolean) {
let currentState: DeviceState = { ...initialState, activeModes: [], isOnline: isDefault };

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

function getDeviceState(): DeviceState {
  return structuredClone(currentState);
}

function patchDeviceState(patch: Partial<DeviceState>): DeviceState {
  // Device reports are partial; missing fields must not erase known state.
  const definedPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<DeviceState>;
  currentState = {
    ...currentState,
    ...definedPatch,
    updatedAt: new Date().toISOString()
  };
  return currentState;
}

function applyDeviceCommand(intent: DeviceIntent, slots: Record<string, unknown> = {}): DeviceState {
  switch (intent) {
    case 'STANDBY':
      currentState = {
        ...currentState,
        activeModes: [],
        updatedAt: new Date().toISOString()
      };
      break;
    case 'HEAT_WEAK_ON':
      setHeatingModes('HEAT_WEAK_ON');
      break;
    case 'HEAT_STRONG_ON':
      setHeatingModes('HEAT_STRONG_ON');
      break;
    case 'BATH_MODE_ON':
      setHeatingModes('HEAT_WEAK_ON', 'BATH_MODE_ON');
      break;
    case 'CONSTANT_TEMP_ON':
      setHeatingModes('HEAT_WEAK_ON', 'CONSTANT_TEMP_ON');
      break;
    case 'DRY_ON':
    case 'DEFOG_ON':
      currentState = {
        ...currentState,
        activeModes: uniqueModes([
          ...currentState.activeModes.filter(
            (mode) =>
              !exclusiveModeIntents.has(mode) &&
              mode !== 'VENTILATION_ON'
          ),
          'FAN_ON',
          intent
        ]),
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
    case 'HEAT_STRONG_OFF':
      currentState = {
        ...currentState,
        activeModes: currentState.activeModes.filter(
          (mode) =>
            mode !== 'HEAT_WEAK_ON' &&
            mode !== 'HEAT_STRONG_ON' &&
            mode !== 'BATH_MODE_ON' &&
            mode !== 'CONSTANT_TEMP_ON'
        ),
        updatedAt: new Date().toISOString()
      };
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
          typeof slots.temperature === 'number' &&
          Number.isInteger(slots.temperature) &&
          slots.temperature >= 30 &&
          slots.temperature <= 45
            ? slots.temperature
            : currentState.targetTemperature,
        updatedAt: new Date().toISOString()
      };
      break;
    case 'SET_TIMER':
      currentState = {
        ...currentState,
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

function setHeatingModes(
  level: 'HEAT_WEAK_ON' | 'HEAT_STRONG_ON',
  productMode?: 'BATH_MODE_ON' | 'CONSTANT_TEMP_ON'
) {
  currentState = {
    ...currentState,
    activeModes: uniqueModes([
      ...currentState.activeModes.filter(
        (mode) =>
          !exclusiveModeIntents.has(mode) &&
          mode !== 'VENTILATION_ON'
      ),
      'FAN_ON',
      level,
      ...(productMode ? [productMode] : [])
    ]),
    updatedAt: new Date().toISOString()
  };
}

function uniqueModes(modes: DeviceIntent[]): DeviceIntent[] {
  return [...new Set(modes)];
}
return { getDeviceState, patchDeviceState, applyDeviceCommand };
}

const DEFAULT_ID = 'demo-bath-heater-001';
const devices = new Map<string, ReturnType<typeof createSimulator>>();
const revisions = new Map<string, number>();
function device(id: string) {
  let value = devices.get(id);
  if (!value) { value = createSimulator(id === DEFAULT_ID); devices.set(id, value); }
  return value;
}
export function getDeviceState(deviceId = DEFAULT_ID): DeviceState { return device(deviceId).getDeviceState(); }
export function getDeviceControlRevision(deviceId: string): number { return revisions.get(deviceId) ?? 0; }
export function bumpDeviceControlRevision(deviceId: string): number {
  const revision = getDeviceControlRevision(deviceId) + 1;
  revisions.set(deviceId, revision);
  return revision;
}
export function patchDeviceState(
  patch: Partial<DeviceState>,
  deviceId = DEFAULT_ID,
  options: { bumpRevision?: boolean } = {},
): DeviceState {
  const before = device(deviceId).getDeviceState();
  const next = device(deviceId).patchDeviceState(patch);
  if (options.bumpRevision !== false &&
      (JSON.stringify([...before.activeModes].sort()) !== JSON.stringify([...next.activeModes].sort()) ||
       before.targetTemperature !== next.targetTemperature || before.faultCode !== next.faultCode)) {
    bumpDeviceControlRevision(deviceId);
  }
  return structuredClone(next);
}
export function applyDeviceCommand(intent: DeviceIntent, slots: Record<string, unknown> = {}, deviceId = DEFAULT_ID): DeviceState {
  bumpDeviceControlRevision(deviceId);
  return structuredClone(device(deviceId).applyDeviceCommand(intent, slots));
}
