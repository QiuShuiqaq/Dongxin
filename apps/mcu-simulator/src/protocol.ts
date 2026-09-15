export const FRAME_SIZE = 32;

export const resultCodes = {
  SUCCESS: 0x00,
  UNSUPPORTED_COMMAND: 0x01,
  INVALID_PARAMETER: 0x02,
  SAFETY_INTERLOCK: 0x03,
  MCU_BUSY: 0x04,
  HARDWARE_FAULT: 0x05
} as const;

export interface HeaterState {
  power: boolean;
  light: boolean;
  heater: 0 | 1 | 2;
  ventilation: boolean;
  fan: boolean;
  swing: boolean;
  dry: boolean;
  targetTemperature: number;
  ambientTemperature: number;
  humidity: number;
  hasOccupancy: boolean;
  faultCode: number;
  runningMinutes: number;
}

export interface ParsedCommand {
  command: number;
  value: number;
  sequence: number;
}

export interface ApplyResult {
  resultCode: number;
  currentValue: number;
  stateChanged: boolean;
}

export function createDefaultState(): HeaterState {
  return {
    power: false,
    light: false,
    heater: 0,
    ventilation: false,
    fan: false,
    swing: false,
    dry: false,
    targetTemperature: 40,
    ambientTemperature: 25,
    humidity: 55,
    hasOccupancy: false,
    faultCode: 0,
    runningMinutes: 0
  };
}

export function checksum(frame: Uint8Array): number {
  let value = 0;
  for (let index = 2; index <= 28; index += 1) {
    value ^= frame[index] ?? 0;
  }
  return value;
}

export function validateFrame(frame: Uint8Array, direction?: 0xcf | 0xca): boolean {
  if (frame.length !== FRAME_SIZE || frame[0] !== 0x02 || frame[2] !== 0x07 || frame[31] !== 0x04) {
    return false;
  }
  if (direction !== undefined && frame[1] !== direction) {
    return false;
  }
  const validDirectionAndTail =
    (frame[1] === 0xcf && frame[30] === 0x0f) ||
    (frame[1] === 0xca && frame[30] === 0x0b);
  return validDirectionAndTail && frame[29] === checksum(frame);
}

export function parseCommandFrame(frame: Uint8Array): ParsedCommand {
  if (!validateFrame(frame, 0xcf)) {
    throw new Error('Invalid ESP32-to-MCU frame');
  }
  return {
    command: frame[3] ?? 0,
    value: frame[4] ?? 0,
    sequence: frame[28] ?? 0
  };
}

export function buildAckFrame(
  command: ParsedCommand,
  resultCode: number,
  currentValue = command.value
): Buffer {
  const frame = createMcuFrame(0x7f, command.sequence);
  frame[4] = command.command;
  frame[5] = resultCode;
  frame[6] = currentValue;
  finishFrame(frame);
  return frame;
}

export function buildStateFrame(state: HeaterState, sequence = 0): Buffer {
  const frame = createMcuFrame(0x10, sequence);
  frame[4] = state.power ? 1 : 0;
  frame[5] = state.light ? 1 : 0;
  frame[6] = state.heater;
  frame[7] = state.ventilation ? 1 : 0;
  frame[8] = state.fan ? 1 : 0;
  frame[9] = state.swing ? 1 : 0;
  frame[10] = state.dry ? 1 : 0;
  frame[11] = clampInteger(state.targetTemperature, 30, 45);
  frame.writeInt16LE(clampInteger(Math.round(state.ambientTemperature * 100), -32768, 32767), 12);
  frame[14] = clampInteger(state.humidity, 0, 100);
  frame[15] = state.hasOccupancy ? 1 : 0;
  frame.writeUInt16LE(clampInteger(state.faultCode, 0, 0xffff), 16);
  frame.writeUInt32LE(clampInteger(state.runningMinutes, 0, 0xffffffff), 18);
  finishFrame(frame);
  return frame;
}

export function applyCommand(state: HeaterState, command: ParsedCommand): ApplyResult {
  const previous = JSON.stringify(state);
  let currentValue = command.value;

  switch (command.command) {
    case 0x00:
      if (command.value !== 0) return invalidParameter(command.value);
      return { resultCode: resultCodes.SUCCESS, currentValue: 0, stateChanged: false };
    case 0x01:
      if (!isSwitch(command.value)) return invalidParameter(command.value);
      state.light = command.value === 1;
      break;
    case 0x02:
      if (!isSwitch(command.value)) return invalidParameter(command.value);
      state.ventilation = command.value === 1;
      break;
    case 0x03:
      if (!isSwitch(command.value)) return invalidParameter(command.value);
      state.fan = command.value === 1;
      break;
    case 0x04:
      if (command.value < 0 || command.value > 2) return invalidParameter(command.value);
      if (command.value > 0 && state.faultCode !== 0) {
        return { resultCode: resultCodes.SAFETY_INTERLOCK, currentValue: state.heater, stateChanged: false };
      }
      state.heater = command.value as 0 | 1 | 2;
      break;
    case 0x05:
      if (!isSwitch(command.value)) return invalidParameter(command.value);
      state.swing = command.value === 1;
      break;
    case 0x06:
      if (!isSwitch(command.value)) return invalidParameter(command.value);
      state.dry = command.value === 1;
      break;
    case 0x07:
      if (command.value < 30 || command.value > 45) return invalidParameter(command.value);
      state.targetTemperature = command.value;
      break;
    case 0x08:
      if (command.value !== 1) return invalidParameter(command.value);
      state.light = false;
      state.heater = 0;
      state.ventilation = false;
      state.fan = false;
      state.swing = false;
      state.dry = false;
      break;
    case 0x09:
      if (command.value < 0 || command.value > 120) return invalidParameter(command.value);
      break;
    case 0x0c:
      if (!isSwitch(command.value)) return invalidParameter(command.value);
      break;
    default:
      return {
        resultCode: resultCodes.UNSUPPORTED_COMMAND,
        currentValue: command.value,
        stateChanged: false
      };
  }

  state.power = hasActiveLoad(state);
  currentValue = readCurrentValue(state, command.command, currentValue);
  return {
    resultCode: resultCodes.SUCCESS,
    currentValue,
    stateChanged: JSON.stringify(state) !== previous
  };
}

export function frameToHex(frame: Uint8Array): string {
  return [...frame].map((value) => value.toString(16).padStart(2, '0')).join(' ').toUpperCase();
}

function createMcuFrame(messageCode: number, sequence: number): Buffer {
  const frame = Buffer.alloc(FRAME_SIZE);
  frame[0] = 0x02;
  frame[1] = 0xca;
  frame[2] = 0x07;
  frame[3] = messageCode;
  frame[28] = sequence;
  frame[30] = 0x0b;
  frame[31] = 0x04;
  return frame;
}

function finishFrame(frame: Buffer): void {
  frame[29] = checksum(frame);
}

function invalidParameter(currentValue: number): ApplyResult {
  return { resultCode: resultCodes.INVALID_PARAMETER, currentValue, stateChanged: false };
}

function isSwitch(value: number): boolean {
  return value === 0 || value === 1;
}

function hasActiveLoad(state: HeaterState): boolean {
  return state.light || state.heater !== 0 || state.ventilation || state.fan || state.swing || state.dry;
}

function readCurrentValue(state: HeaterState, command: number, fallback: number): number {
  switch (command) {
    case 0x01: return state.light ? 1 : 0;
    case 0x02: return state.ventilation ? 1 : 0;
    case 0x03: return state.fan ? 1 : 0;
    case 0x04: return state.heater;
    case 0x05: return state.swing ? 1 : 0;
    case 0x06: return state.dry ? 1 : 0;
    case 0x07: return state.targetTemperature;
    case 0x08: return state.power ? 0 : 1;
    default: return fallback;
  }
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
