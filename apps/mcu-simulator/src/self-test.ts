import assert from 'node:assert/strict';
import {
  applyCommand,
  buildAckFrame,
  buildStateFrame,
  checksum,
  createDefaultState,
  parseCommandFrame,
  resultCodes,
  validateFrame
} from './protocol.ts';

const commandFrame = Buffer.alloc(32);
commandFrame[0] = 0x02;
commandFrame[1] = 0xcf;
commandFrame[2] = 0x07;
commandFrame[3] = 0x01;
commandFrame[4] = 0x01;
commandFrame[28] = 0x2a;
commandFrame[30] = 0x0f;
commandFrame[31] = 0x04;
commandFrame[29] = checksum(commandFrame);

assert.equal(validateFrame(commandFrame, 0xcf), true);
const command = parseCommandFrame(commandFrame);
assert.deepEqual(command, { command: 0x01, value: 0x01, sequence: 0x2a });

const state = createDefaultState();
const applied = applyCommand(state, command);
assert.equal(applied.resultCode, resultCodes.SUCCESS);
assert.equal(applied.stateChanged, true);
assert.equal(state.light, true);
assert.equal(state.power, true);

const ack = buildAckFrame(command, applied.resultCode, applied.currentValue);
assert.equal(validateFrame(ack, 0xca), true);
assert.equal(ack[3], 0x7f);
assert.equal(ack[4], 0x01);
assert.equal(ack[5], 0x00);
assert.equal(ack[28], 0x2a);

state.ambientTemperature = 25.67;
state.humidity = 72;
state.hasOccupancy = true;
state.runningMinutes = 8;
const stateFrame = buildStateFrame(state, 0x2a);
assert.equal(validateFrame(stateFrame, 0xca), true);
assert.equal(stateFrame[3], 0x10);
assert.equal(stateFrame.readInt16LE(12), 2567);
assert.equal(stateFrame[14], 72);
assert.equal(stateFrame[15], 1);
assert.equal(stateFrame.readUInt32LE(18), 8);

const corrupted = Buffer.from(stateFrame);
corrupted[12] ^= 0x01;
assert.equal(validateFrame(corrupted), false);

state.faultCode = 1;
const rejected = applyCommand(state, { command: 0x04, value: 0x02, sequence: 0x2b });
assert.equal(rejected.resultCode, resultCodes.SAFETY_INTERLOCK);
assert.equal(state.heater, 0);

const invalid = applyCommand(state, { command: 0x07, value: 46, sequence: 0x2c });
assert.equal(invalid.resultCode, resultCodes.INVALID_PARAMETER);

console.log('[mcu-simulator] frame generation and parsing passed');
console.log('[mcu-simulator] state transitions and safety rejection passed');
console.log('[mcu-simulator] checksum rejection passed');
