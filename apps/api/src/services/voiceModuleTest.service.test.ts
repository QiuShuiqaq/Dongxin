import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { randomUUID } from "node:crypto";

let releaseDevice: (() => void) | undefined;
let holdDevice = true;
let publishAudioControl: (input: {
  action: string;
  testId: string;
  deviceId: string;
}) => Promise<void> = async () => undefined;
const playbackCompletions: boolean[] = [];
let confirmationClears = 0;
const replace = (path: string, namedExports: Record<string, unknown>) =>
  mock.module(new URL(path, import.meta.url).href, { namedExports });
replace("./deviceAudioAsset.service.js", {
  convertWavToPcm16Mono: () => Buffer.alloc(320),
});
replace("./deviceRegistry.service.js", {
  getDevice: async () => {
    if (holdDevice)
      await new Promise<void>((resolve) => {
        releaseDevice = resolve;
      });
    return { status: "ONLINE", capabilities: { audioPlayback: true } };
  },
});
replace("./mqttGateway.service.js", {
  publishAudioTestControl: (input: {
    action: string;
    testId: string;
    deviceId: string;
  }) => publishAudioControl(input),
});
replace("./speech.service.js", {
  synthesizeSpeech: async () => ({
    status: "COMPLETED",
    audioBase64: "AA==",
    providerId: null,
    providerName: null,
    latencyMs: 1,
    costCny: 0,
  }),
});
replace("./voicePipeline.service.js", {
  runLlmModuleTest: async () => undefined,
});
replace("./proactiveConfirmation.service.js", {
  clearProactiveConfirmation: () => {
    confirmationClears++;
  },
  finishProactivePlayback: (
    _deviceId: string,
    _testId: string,
    completed: boolean,
  ) => {
    playbackCompletions.push(completed);
  },
});
const {
  testTts,
  isDeviceAudioBusy,
  handleAudioTestDeviceStatus,
  stopAudioTest,
} = await import("./voiceModuleTest.service.js");

test("one device reserves audio before asynchronous validation and releases after completion", async () => {
  const deviceId = `audio-fixture-${randomUUID()}`;
  const first = testTts({ deviceId, text: "测试", target: "DEVICE" });
  assert.equal(isDeviceAudioBusy(deviceId), true);
  await assert.rejects(
    testTts({ deviceId, text: "再次测试", target: "DEVICE" }),
    (error: unknown) =>
      (error as { code?: string }).code === "AUDIO_TEST_ALREADY_ACTIVE",
  );
  assert.ok(releaseDevice);
  releaseDevice!();
  const record = await first;
  assert.ok(record && "id" in record);
  assert.equal(isDeviceAudioBusy(deviceId), true);
  handleAudioTestDeviceStatus({
    deviceId,
    testId: record.id,
    status: "COMPLETED",
  });
  assert.equal(isDeviceAudioBusy(deviceId), false);
});

test("a fast device callback cannot be overwritten by command sent", async () => {
  holdDevice = false;
  const deviceId = `audio-fixture-${randomUUID()}`;
  publishAudioControl = async ({ action, testId }) => {
    if (action === "play")
      handleAudioTestDeviceStatus({ deviceId, testId, status: "PLAYING" });
  };
  const record = await testTts({ deviceId, text: "测试", target: "DEVICE" });
  assert.equal(record?.status, "PLAYING");
  handleAudioTestDeviceStatus({
    deviceId,
    testId: record!.id,
    status: "COMPLETED",
  });
  assert.equal(isDeviceAudioBusy(deviceId), false);
  publishAudioControl = async () => undefined;
});

test("stop wins over an in-flight completed callback and blocks proactive confirmation", async () => {
  const deviceId = `audio-fixture-${randomUUID()}`;
  playbackCompletions.length = 0;
  confirmationClears = 0;
  const record = await testTts({
    deviceId,
    text: "要打开换气吗",
    target: "DEVICE",
    listenAfterPlayback: true,
  });
  assert.ok(record && "id" in record);
  publishAudioControl = async ({ action, testId }) => {
    if (action === "stop")
      handleAudioTestDeviceStatus({ deviceId, testId, status: "COMPLETED" });
  };
  const stopped = await stopAudioTest(record.id);
  assert.equal(stopped.status, "CANCELLED");
  assert.deepEqual(playbackCompletions, [false]);
  assert.equal(confirmationClears, 1);
  assert.equal(isDeviceAudioBusy(deviceId), false);
  publishAudioControl = async () => undefined;
});

test("answer capture has its own busy state and closes the confirmation window on exit", async () => {
  const deviceId = `audio-fixture-${randomUUID()}`;
  playbackCompletions.length = 0;
  confirmationClears = 0;
  const record = await testTts({
    deviceId,
    text: "要打开换气吗",
    target: "DEVICE",
    listenAfterPlayback: true,
  });
  assert.ok(record && "id" in record);
  handleAudioTestDeviceStatus({
    deviceId,
    testId: record.id,
    status: "PLAYING",
  });
  assert.deepEqual(playbackCompletions, []);
  handleAudioTestDeviceStatus({
    deviceId,
    testId: record.id,
    status: "LISTENING",
  });
  assert.deepEqual(playbackCompletions, [true]);
  assert.equal(isDeviceAudioBusy(deviceId), true);
  handleAudioTestDeviceStatus({
    deviceId,
    testId: record.id,
    status: "PLAYING",
  });
  handleAudioTestDeviceStatus({
    deviceId,
    testId: record.id,
    status: "COMPLETED",
  });
  assert.equal(confirmationClears, 1);
  assert.equal(isDeviceAudioBusy(deviceId), false);
});

test("stop remains available while waiting for an answer", async () => {
  const deviceId = `audio-fixture-${randomUUID()}`;
  playbackCompletions.length = 0;
  confirmationClears = 0;
  const record = await testTts({
    deviceId,
    text: "要打开换气吗",
    target: "DEVICE",
    listenAfterPlayback: true,
  });
  assert.ok(record && "id" in record);
  handleAudioTestDeviceStatus({
    deviceId,
    testId: record.id,
    status: "LISTENING",
  });
  const actions: string[] = [];
  publishAudioControl = async ({ action }) => {
    actions.push(action);
  };
  const stopped = await stopAudioTest(record.id);
  assert.equal(stopped.status, "CANCELLED");
  assert.deepEqual(actions, ["stop"]);
  assert.equal(confirmationClears, 1);
  assert.equal(isDeviceAudioBusy(deviceId), false);
  publishAudioControl = async () => undefined;
});

test("stop published during play delivery is repeated after play publish completes", async () => {
  const deviceId = `audio-fixture-${randomUUID()}`;
  let releasePlay: (() => void) | undefined;
  const actions: string[] = [];
  publishAudioControl = async ({ action }) => {
    actions.push(action);
    if (action === "play")
      await new Promise<void>((resolve) => {
        releasePlay = resolve;
      });
  };
  let createdId = "";
  const delivery = testTts(
    { deviceId, text: "测试", target: "DEVICE" },
    {
      onCreated: (id) => {
        createdId = id;
      },
    },
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(createdId);
  await stopAudioTest(createdId);
  releasePlay!();
  const record = await delivery;
  assert.equal(record?.status, "CANCELLED");
  assert.deepEqual(actions, ["play", "stop", "stop"]);
  publishAudioControl = async () => undefined;
});
