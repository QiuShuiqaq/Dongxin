import { createInterface } from 'node:readline';
import { SerialPort } from 'serialport';
import {
  applyCommand,
  buildAckFrame,
  buildStateFrame,
  createDefaultState,
  frameToHex,
  FRAME_SIZE,
  parseCommandFrame,
  resultCodes,
  type HeaterState,
  type ParsedCommand
} from './protocol.ts';

type Outcome =
  | { type: 'normal' }
  | { type: 'reject'; resultCode: number }
  | { type: 'retry' }
  | { type: 'timeout' };

const args = process.argv.slice(2);
if (args.includes('--list')) {
  const ports = await SerialPort.list();
  if (ports.length === 0) {
    console.log('No serial ports found.');
  } else {
    for (const port of ports) {
      console.log(`${port.path}\t${port.manufacturer ?? ''}\t${port.serialNumber ?? ''}`);
    }
  }
  process.exit(0);
}

const portName = readOption('--port');
const baudRate = Number(readOption('--baud') ?? '115200');
if (!portName || !Number.isInteger(baudRate) || baudRate <= 0) {
  printUsage();
  process.exit(1);
}

const serial = new SerialPort({ path: portName, baudRate, autoOpen: false });
await new Promise<void>((resolve, reject) => {
  serial.open((error) => error ? reject(error) : resolve());
});

const state = createDefaultState();
const completedTransactions = new Map<string, Buffer>();
let nextOutcome: Outcome = { type: 'normal' };
let timedOutTransaction: string | undefined;
let retryTransaction: string | undefined;
let rxBuffer = Buffer.alloc(0);

console.log(`[mcu-simulator] opened ${portName} at ${baudRate} 8N1`);
console.log('[mcu-simulator] protocol V0.2, type "help" for fault injection commands');

serial.on('data', (chunk: Buffer) => {
  rxBuffer = Buffer.concat([rxBuffer, chunk]);
  consumeFrames();
});
serial.on('error', (error) => console.error(`[serial] ${error.message}`));

const input = createInterface({ input: process.stdin, output: process.stdout });
input.on('line', (line) => void handleConsoleCommand(line.trim()));
input.on('close', () => serial.close());

function consumeFrames(): void {
  while (rxBuffer.length > 0) {
    const header = rxBuffer.indexOf(0x02);
    if (header < 0) {
      console.warn(`[rx] discarded ${rxBuffer.length} byte(s) before frame header`);
      rxBuffer = Buffer.alloc(0);
      return;
    }
    if (header > 0) {
      console.warn(`[rx] discarded ${header} byte(s) before frame header`);
      rxBuffer = rxBuffer.subarray(header);
    }
    if (rxBuffer.length < FRAME_SIZE) return;

    const frame = Buffer.from(rxBuffer.subarray(0, FRAME_SIZE));
    rxBuffer = rxBuffer.subarray(FRAME_SIZE);
    try {
      const command = parseCommandFrame(frame);
      console.log(`[rx] ${frameToHex(frame)}`);
      void handleCommand(command);
    } catch (error) {
      console.warn(`[rx] invalid frame: ${error instanceof Error ? error.message : String(error)}`);
      rxBuffer = Buffer.concat([frame.subarray(1), rxBuffer]);
    }
  }
}

async function handleCommand(command: ParsedCommand): Promise<void> {
  const transactionKey = `${command.sequence}:${command.command}`;
  const priorAck = completedTransactions.get(transactionKey);
  if (priorAck) {
    console.log(`[mcu] duplicate transaction ${transactionKey}; resending cached ACK only`);
    await writeFrame(priorAck);
    return;
  }
  if (timedOutTransaction === transactionKey) {
    console.log(`[mcu] timeout injection continues for retry ${transactionKey}`);
    return;
  }

  if (retryTransaction === transactionKey) {
    retryTransaction = undefined;
    console.log(`[mcu] retry received for ${transactionKey}; executing once now`);
  } else {
    const outcome = nextOutcome;
    nextOutcome = { type: 'normal' };
    if (outcome.type === 'timeout') {
      timedOutTransaction = transactionKey;
      console.log(`[mcu] intentionally ignoring transaction ${transactionKey} and its retries`);
      return;
    }
    if (outcome.type === 'retry') {
      retryTransaction = transactionKey;
      console.log(`[mcu] intentionally dropping the first response for ${transactionKey}`);
      return;
    }
    if (outcome.type === 'reject') {
      const ack = buildAckFrame(command, outcome.resultCode, command.value);
      completedTransactions.set(transactionKey, ack);
      trimCompletedTransactions();
      await writeFrame(ack);
      return;
    }
  }

  timedOutTransaction = undefined;

  if (command.command === 0x00) {
    const result = applyCommand(state, command);
    if (result.resultCode !== resultCodes.SUCCESS) {
      await writeFrame(buildAckFrame(command, result.resultCode, result.currentValue));
      return;
    }
    await writeFrame(buildStateFrame(state, command.sequence));
    return;
  }

  const result = applyCommand(state, command);
  const ack = buildAckFrame(command, result.resultCode, result.currentValue);
  completedTransactions.set(transactionKey, ack);
  trimCompletedTransactions();
  await writeFrame(ack);
  if (result.resultCode === resultCodes.SUCCESS && result.stateChanged) {
    await delay(20);
    await writeFrame(buildStateFrame(state));
  }
}

async function handleConsoleCommand(line: string): Promise<void> {
  if (!line) return;
  const [command, ...values] = line.split(/\s+/);
  try {
    switch (command?.toLowerCase()) {
      case 'help':
        printInteractiveHelp();
        break;
      case 'next':
        setNextOutcome(values);
        break;
      case 'state':
        setStateValue(state, values[0], values[1]);
        await writeFrame(buildStateFrame(state));
        break;
      case 'fault':
        setStateValue(state, 'fault', values[0]);
        await writeFrame(buildStateFrame(state));
        break;
      case 'report':
        await writeFrame(buildStateFrame(state));
        break;
      case 'corrupt': {
        const frame = buildStateFrame(state);
        frame[29] ^= 0x01;
        await writeFrame(frame);
        console.log('[mcu] sent a state frame with an invalid checksum');
        break;
      }
      case 'show':
        console.log(JSON.stringify(state, null, 2));
        break;
      case 'quit':
      case 'exit':
        input.close();
        break;
      default:
        console.warn(`Unknown command: ${command}. Type "help".`);
    }
  } catch (error) {
    console.error(`[console] ${error instanceof Error ? error.message : String(error)}`);
  }
}

function setNextOutcome(values: string[]): void {
  const name = values[0]?.toLowerCase();
  if (name === 'success') {
    nextOutcome = { type: 'normal' };
  } else if (name === 'retry') {
    nextOutcome = { type: 'retry' };
  } else if (name === 'timeout') {
    nextOutcome = { type: 'timeout' };
  } else if (name === 'reject') {
    const resultCode = Number(values[1] ?? resultCodes.SAFETY_INTERLOCK);
    if (!Number.isInteger(resultCode) || resultCode < 1 || resultCode > 5) {
      throw new Error('Reject result code must be 1..5');
    }
    nextOutcome = { type: 'reject', resultCode };
  } else {
    throw new Error('Usage: next success | next retry | next reject [1..5] | next timeout');
  }
  console.log(`[mcu] next outcome: ${JSON.stringify(nextOutcome)}`);
}

function setStateValue(target: HeaterState, field: string | undefined, raw: string | undefined): void {
  if (!field || raw === undefined) {
    throw new Error('Usage: state <light|heater|ventilation|fan|swing|dry|temperature|humidity|occupancy|fault> <value>');
  }
  const key = field.toLowerCase();
  if (['light', 'ventilation', 'fan', 'swing', 'dry', 'occupancy'].includes(key)) {
    const enabled = parseBoolean(raw);
    if (key === 'occupancy') target.hasOccupancy = enabled;
    else target[key as 'light' | 'ventilation' | 'fan' | 'swing' | 'dry'] = enabled;
  } else if (key === 'heater') {
    const value = Number(raw);
    if (value !== 0 && value !== 1 && value !== 2) throw new Error('heater must be 0, 1 or 2');
    target.heater = value;
  } else if (key === 'temperature') {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < -100 || value > 200) throw new Error('temperature is out of range');
    target.ambientTemperature = value;
  } else if (key === 'humidity') {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error('humidity must be 0..100');
    target.humidity = value;
  } else if (key === 'fault') {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new Error('fault must be 0..65535');
    target.faultCode = value;
  } else {
    throw new Error(`Unsupported state field: ${field}`);
  }
  target.power = target.light || target.heater !== 0 || target.ventilation || target.fan || target.swing || target.dry;
  console.log(`[mcu] state updated: ${key}=${raw}`);
}

async function writeFrame(frame: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    serial.write(frame, (error) => {
      if (error) reject(error);
      else serial.drain((drainError) => drainError ? reject(drainError) : resolve());
    });
  });
  console.log(`[tx] ${frameToHex(frame)}`);
}

function trimCompletedTransactions(): void {
  while (completedTransactions.size > 16) {
    const first = completedTransactions.keys().next().value as string | undefined;
    if (first === undefined) break;
    completedTransactions.delete(first);
  }
}

function parseBoolean(raw: string): boolean {
  if (['1', 'on', 'true'].includes(raw.toLowerCase())) return true;
  if (['0', 'off', 'false'].includes(raw.toLowerCase())) return false;
  throw new Error('Boolean value must be on/off, true/false or 1/0');
}

function readOption(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function printUsage(): void {
  console.log('Usage: npm run mcu:sim -- --port COM4 [--baud 115200]');
  console.log('       npm run mcu:sim -- --list');
}

function printInteractiveHelp(): void {
  console.log('next success             apply the next transaction normally');
  console.log('next retry               drop once, then execute the same-sequence retry');
  console.log('next reject [1..5]       reject the next transaction');
  console.log('next timeout             ignore the next transaction and its retry');
  console.log('state <field> <value>    change state and actively report it');
  console.log('fault <0..65535>         change fault code and actively report it');
  console.log('report                    send the current full state');
  console.log('corrupt                   send a state frame with a bad checksum');
  console.log('show                      print current simulated state');
  console.log('quit                      close the simulator');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
