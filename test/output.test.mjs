import test from 'node:test';
import assert from 'node:assert';
import { pickOutput, outputName } from '../src/renderer/js/output.js';

const devices = [
  { deviceId: 'default', label: 'Default - MacBook Air Speakers (Built-in)' },
  { deviceId: 'spk', label: 'MacBook Air Speakers (Built-in)' },
  { deviceId: 'air2', label: 'AirPods Pro' },
];

test('the chosen output when it is there, by its id', () => {
  assert.strictEqual(pickOutput(devices, { id: 'air2', label: 'AirPods Pro' }), 'air2');
});

test('found by its name when its id changed (reconnected over Bluetooth)', () => {
  assert.strictEqual(pickOutput(devices, { id: 'air-old', label: 'AirPods Pro' }), 'air2');
});

test('the system default when the chosen one is gone, or none was chosen', () => {
  assert.strictEqual(pickOutput(devices, { id: 'usb', label: 'USB DAC' }), '');
  assert.strictEqual(pickOutput(devices, null), '');
  assert.strictEqual(pickOutput([], { id: 'air2', label: 'AirPods Pro' }), '');
});

test('what an output is called on the button', () => {
  assert.strictEqual(outputName(null), 'SYSTEM DEFAULT');
  assert.strictEqual(outputName({ label: 'MacBook Air Speakers (Built-in)' }), 'MACBOOK AIR SPEAKERS');
  assert.strictEqual(outputName({ label: 'AirPods Pro' }), 'AIRPODS PRO');
});
