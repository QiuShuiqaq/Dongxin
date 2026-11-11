import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FRAME_LENGTH = 32;
const FRAME_MASK = FRAME_LENGTH - 1;
const RX_HEAD_HIGH = 0x02;
const RX_HEAD_LOW = 0xcf;
const PRODUCT_TYPE = 0x07;
const RX_END_HIGH = 0x0f;
const RX_END_LOW = 0x04;

function createFrame(command, value, beepCount = 0) {
  const frame = new Uint8Array(FRAME_LENGTH);
  frame[0] = RX_HEAD_HIGH;
  frame[1] = RX_HEAD_LOW;
  frame[2] = PRODUCT_TYPE;
  frame[3] = command;
  frame[4] = value;
  frame[5] = beepCount;
  frame[30] = RX_END_HIGH;
  frame[31] = RX_END_LOW;

  for (let index = 2; index < 29; index += 1) {
    frame[29] ^= frame[index];
  }

  return frame;
}

function placeInRing(frame, start) {
  const ring = new Uint8Array(FRAME_LENGTH);
  for (let index = 0; index < FRAME_LENGTH; index += 1) {
    ring[(start + index) & FRAME_MASK] = frame[index];
  }
  return ring;
}

function parseRing(ring) {
  let start = -1;
  for (let index = 0; index < FRAME_LENGTH; index += 1) {
    if (
      ring[index] === RX_HEAD_HIGH &&
      ring[(index + 1) & FRAME_MASK] === RX_HEAD_LOW
    ) {
      start = index;
      break;
    }
  }

  if (start < 0) return null;

  const frame = Uint8Array.from(
    { length: FRAME_LENGTH },
    (_, index) => ring[(start + index) & FRAME_MASK],
  );
  if (
    frame[2] !== PRODUCT_TYPE ||
    frame[30] !== RX_END_HIGH ||
    frame[31] !== RX_END_LOW
  ) {
    return null;
  }

  let checksum = 0;
  for (let index = 2; index < 29; index += 1) checksum ^= frame[index];
  if (checksum !== frame[29]) return null;

  return { command: frame[3], value: frame[4], beepCount: frame[5] };
}

const strongHeatFrame = createFrame(0x04, 0x02, 1);
for (let start = 0; start < FRAME_LENGTH; start += 1) {
  assert.deepEqual(parseRing(placeInRing(strongHeatFrame, start)), {
    command: 0x04,
    value: 0x02,
    beepCount: 1,
  });
}

const badChecksum = strongHeatFrame.slice();
badChecksum[29] ^= 0xff;
assert.equal(parseRing(placeInRing(badChecksum, 31)), null);

const badTail = strongHeatFrame.slice();
badTail[31] = 0;
assert.equal(parseRing(placeInRing(badTail, 31)), null);
assert.equal(parseRing(new Uint8Array(FRAME_LENGTH)), null);

const sourcePath = fileURLToPath(
  new URL("../stm32-firmware/axent-controller/USER/BLE_COMM.C", import.meta.url),
);
const source = readFileSync(sourcePath, "utf8");
const controlSource = readFileSync(fileURLToPath(new URL('../stm32-firmware/axent-controller/USER/Control_Process.C', import.meta.url)), 'utf8');
const voiceSource = readFileSync(fileURLToPath(new URL('../firmware/main/voice_engine.c', import.meta.url)), 'utf8');
const mqttSource = readFileSync(fileURLToPath(new URL('../firmware/main/mqtt_agent.c', import.meta.url)), 'utf8');
const cloudSource = readFileSync(fileURLToPath(new URL('../firmware/main/cloud_agent.c', import.meta.url)), 'utf8');
const commandSource = readFileSync(fileURLToPath(new URL('../firmware/main/device_command.c', import.meta.url)), 'utf8');
const wifiSource = readFileSync(fileURLToPath(new URL('../firmware/main/wifi_manager.c', import.meta.url)), 'utf8');
assert.equal(controlSource.includes('USART_SendData(USART3, Tx_Reg[i])'), false);
assert.equal(controlSource.includes('RS485_EN_High'), false);
assert.equal(controlSource.includes('RS485_EN_Low'), false);
assert.equal((source.match(/reg\[\(n\+1\)&0x1f\]/g) ?? []).length, 2);
assert.equal(source.includes("reg[n+1]"), false);
assert.equal(source.includes('Check_RS485_Uart3'), false);
assert.match(source, /void Check_CI1302_Uart3\(void\)/);
assert.match(source, /ci_frame\[6\] != sum/);
assert.match(source, /CI1302_Semantic_Allowed\(ci_frame\[4\]\) == 0U/);
assert.match(source, /case 2U: Pro_Control\(1, Command_Lamp, 1, 0\)/);
assert.match(source, /case 3U: Pro_Control\(1, Command_Lamp, 0, 0\)/);
assert.match(source, /case 8U: Pro_Control\(1, Command_HuanQi, 1, 0\)/);
assert.match(source, /case 9U: Pro_Control\(1, Command_HuanQi, 0, 0\)/);
assert.match(source, /case 10U: Pro_Control\(1, Command_CuiFen, 1, 0\)/);
assert.match(source, /case 11U: Pro_Control\(1, Command_CuiFen, 0, 0\)/);
assert.match(source, /reg0\[13\] != 0xC2U \|\| reg0\[14\] == dx_control_revision/);
assert.match(source, /CI1302_Receive_Byte\(\(uint8_t\)USART_ReceiveData\(USART3\)\)/);
assert.equal((source.match(/volatile uint8_t Res[12]\[32\]/g) ?? []).length, 2);
assert.equal((source.match(/volatile uint8_t rec[12]_[nF]/g) ?? []).length, 4);
assert.match(voiceSource, /if \(request->ci_wake_online_fallback\) \{\s*vTaskDelay\(pdMS_TO_TICKS\(DX_CI_FIXED_COMMAND_GRACE_MS\)\);\s*if \(s_ci_local_generation != ci_local_generation\)/);
assert.match(voiceSource, /if \(request->ci_wake_online_fallback && !s_cancel_requested &&\s*s_ci_local_generation != ci_local_generation\) \{\s*\*end_session = false;/);
assert.match(voiceSource, /if \(ci_error == ESP_ERR_NOT_FOUND &&\s*s_ci_local_generation != turn_ci_generation\) \{\s*vTaskDelay\(pdMS_TO_TICKS\(DX_CI_FIXED_COMMAND_GRACE_MS\)\);/);
assert.match(voiceSource, /ci_request\.ci_hardware_triggered = false;/);
assert.match(mqttSource, /store_ci_pending\(status, event_id, event_counter\)/);
assert.match(mqttSource, /enqueue_local_ci_event\(&pending, pending_id, pending_counter\)/);
assert.match(mqttSource, /if \(!flush_pending_ci_event\(\) \|\| !s_connected \|\| generation != s_connection_generation\) goto done;/);
assert.match(mqttSource, /s_connection_setup_running = true;/);
assert.match(mqttSource, /case MQTT_EVENT_PUBLISHED:[\s\S]*?s_ci_inflight_message_id = -1;/);
assert.match(mqttSource, /case MQTT_EVENT_SUBSCRIBED:[\s\S]*?s_subscription_ack_mask == 0x0FU/);
assert.match(mqttSource, /message\.connection_generation != s_connection_generation/);
assert.match(mqttSource, /device_command_is_fresh\(data, &result\)/);
assert.match(cloudSource, /device_command_is_fresh\(command, &result\)/);
assert.match(commandSource, /expiry->valuedouble > now_ms && expiry->valuedouble <= now_ms \+ 120000\.0/);
assert.match(wifiSource, /esp_netif_sntp_init\(&sntp_config\)/);
assert.match(voiceSource, /download_and_play_pcm\(playback\.audio_path, playback\.volume_percent,\s*NULL, ci_local_generation\)/);
assert.match(voiceSource, /s_ci_local_generation == expected_ci_generation/);

console.log("STM32 protocol checks passed: legacy UART ring and CI1302 source invariants.");
