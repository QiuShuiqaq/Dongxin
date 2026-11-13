import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isOperationalDevice } from './operationsDeviceVisibility.js';

test('a physical Lichuang MQTT pilot is visible to operations', () => {
  assert.equal(isOperationalDevice({
    id: 'DX-PILOT-001', model: 'DX-AI-BATH-C3-LICHUANG-AUDIO', protocol: 'MQTT',
  }), true);
});

test('simulators and unprovisioned development identities stay hidden', () => {
  for (const device of [
    { id: 'DX-PILOT-001', model: 'DX-AI-BATH-C3-LICHUANG-AUDIO', protocol: 'SIMULATOR' as const },
    { id: 'DX-C3-LICHUANG-AUDIO-001', model: 'DX-AI-BATH-C3-LICHUANG-AUDIO', protocol: 'MQTT' as const },
    { id: 'DX-PILOT-001', model: 'DX-AI-BATH-C3-DEVKIT', protocol: 'MQTT' as const },
    { id: 'DX-PILOT-001', model: 'LICHUANG-SIMULATOR', protocol: 'MQTT' as const },
    { id: 'DX-PILOT-001', model: 'DX-AI-BATH-C3-LICHUANG-AUDIO', protocol: 'HTTP' as const },
    { id: 'DX-PILOT-001-extra!', model: 'DX-AI-BATH-C3-LICHUANG-AUDIO', protocol: 'MQTT' as const },
  ]) {
    assert.equal(isOperationalDevice(device), false, device.id + '/' + device.protocol + '/' + device.model);
  }
});

test('ordinary physical product models remain visible', () => {
  assert.equal(isOperationalDevice({ id: 'DX-100001', model: 'DX-AI-BATH-01', protocol: 'MQTT' }), true);
});
