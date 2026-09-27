import test from 'node:test';
import assert from 'node:assert';
import { ShakeDetector } from '../src/renderer/js/disc-noise.js';

test('shaking: four quick swings of the window, not an ordinary drag', () => {
  const shake = new ShakeDetector();
  let t = 0;
  const swing = (xs) => xs.map((x) => shake.feed(x, 100, (t += 40))).some(Boolean);
  assert.strictEqual(swing([0, 50, 100, 150, 200, 260, 320]), false, 'dragging one way');
  assert.strictEqual(swing([260, 200, 260, 200, 260]), true, 'back and forth');
  assert.strictEqual(swing([200, 260, 200, 260, 200]), false, 'not again straight away');
  const slow = new ShakeDetector();
  const slowSwing = [0, 60, 0, 60, 0, 60].map((x, i) => slow.feed(x, 0, i * 800));
  assert.strictEqual(slowSwing.some(Boolean), false, 'too slow to be a shake');
});
