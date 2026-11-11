import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bumpDeviceControlRevision } from '../deviceSimulator.js';
import { clearProactiveConfirmation, finishProactivePlayback, stageProactiveConfirmation, takeProactiveConfirmation } from './proactiveConfirmation.service.js';

test('proactive confirmation is unavailable until matching playback finishes', () => {
  const deviceId = 'proactive-fixture-1';
  stageProactiveConfirmation(deviceId, 'audio-1', 'HEAT_WEAK_ON');
  assert.equal(takeProactiveConfirmation(deviceId, '好的'), null);
  finishProactivePlayback(deviceId, 'wrong-id', true);
  assert.equal(takeProactiveConfirmation(deviceId, '好的'), null);
  finishProactivePlayback(deviceId, 'audio-1', true);
  assert.deepEqual(takeProactiveConfirmation(deviceId, '好的'), { intent: 'HEAT_WEAK_ON' });
  assert.equal(takeProactiveConfirmation(deviceId, '好的'), null);
});

test('cancelled playback and later local control never authorize a suggested action', () => {
  const deviceId = 'proactive-fixture-2';
  stageProactiveConfirmation(deviceId, 'audio-2', 'HEAT_WEAK_ON');
  finishProactivePlayback(deviceId, 'audio-2', false);
  assert.equal(takeProactiveConfirmation(deviceId, '可以'), null);
  stageProactiveConfirmation(deviceId, 'audio-3', 'HEAT_WEAK_ON');
  finishProactivePlayback(deviceId, 'audio-3', true);
  bumpDeviceControlRevision(deviceId);
  assert.equal(takeProactiveConfirmation(deviceId, '可以'), null);
  clearProactiveConfirmation(deviceId);
});

test('explicit refusal consumes the pending suggestion', () => {
  const deviceId = 'proactive-fixture-3';
  stageProactiveConfirmation(deviceId, 'audio-4', 'VENTILATION_ON');
  finishProactivePlayback(deviceId, 'audio-4', true);
  assert.deepEqual(takeProactiveConfirmation(deviceId, '不用了'), { declined: true });
  assert.equal(takeProactiveConfirmation(deviceId, '好'), null);
});

test('an ambiguous or compound answer cannot execute the suggested action', () => {
  const deviceId = 'proactive-fixture-4';
  stageProactiveConfirmation(deviceId, 'audio-5', 'HEAT_WEAK_ON');
  finishProactivePlayback(deviceId, 'audio-5', true);
  assert.equal(takeProactiveConfirmation(deviceId, '好，顺便开灯'), null);
  assert.equal(takeProactiveConfirmation(deviceId, '好'), null);
  stageProactiveConfirmation(deviceId, 'audio-6', 'HEAT_WEAK_ON');
  finishProactivePlayback(deviceId, 'audio-6', true);
  assert.deepEqual(takeProactiveConfirmation(deviceId, '好的，不过别开'), { declined: true });
  assert.equal(takeProactiveConfirmation(deviceId, '好'), null);
});
