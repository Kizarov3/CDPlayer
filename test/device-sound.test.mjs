// Each output keeps its own sound, by the name of the device the sound reaches.
import test from 'node:test';
import assert from 'node:assert';
import { deviceKey, soundOf, sameSound } from '../src/renderer/js/device-sound.js';

const devices = [
  { kind: 'audiooutput', deviceId: 'default', label: 'Default - AirPods Pro (Bluetooth)' },
  { kind: 'audiooutput', deviceId: 'a1', label: 'AirPods Pro (Bluetooth)' },
  { kind: 'audiooutput', deviceId: 'b2', label: 'MacBook Air Speakers (Built-in)' },
  { kind: 'audioinput', deviceId: 'c3', label: 'MacBook Air Microphone' },
];

test('the device the sound reaches: the one picked, or the system default as it is now', () => {
  assert.strictEqual(deviceKey(devices, 'b2'), 'MACBOOK AIR SPEAKERS');
  assert.strictEqual(deviceKey(devices, ''), 'AIRPODS PRO');
  assert.strictEqual(deviceKey(devices, 'gone'), 'AIRPODS PRO');
  assert.strictEqual(deviceKey([], ''), null);
});

test('the sound an output keeps, and whether two are the same', () => {
  const state = { eq: [1, 2], mono: false, spatial: true, spatialAmount: 40, volume: 0.3 };
  const kept = soundOf(state);
  assert.deepStrictEqual(kept, { eq: [1, 2], mono: false, spatial: true, spatialAmount: 40 });
  state.eq[0] = 5;
  assert.strictEqual(kept.eq[0], 1); // a copy
  assert.ok(sameSound(kept, { eq: [1, 2], mono: false, spatial: true, spatialAmount: 40 }));
  assert.ok(!sameSound(kept, soundOf(state)));
});
