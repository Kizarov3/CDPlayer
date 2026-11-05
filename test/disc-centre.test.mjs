import test from 'node:test';
import assert from 'node:assert';
import { holeCentre } from '../src/renderer/js/disc-centre.js';

// A photo of a disc as grey values: `shade(x, y)` over a size × size picture.
const picture = (size, shade) => {
  const a = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) a[y * size + x] = shade(x, y);
  return a;
};
const near = (found, x, y, within = 1.5) => found && Math.abs(found.x - x) <= within && Math.abs(found.y - y) <= within;
const SIZE = 256, GUESS = { x: 128, y: 128, r: 120 };

test('a white hole in a dark disc, off the middle of the scan: found where it really is', () => {
  const g = picture(SIZE, (x, y) => (Math.hypot(x - 134, y - 137) < 21 ? 250 : 20));
  assert.ok(near(holeCentre(g, SIZE, SIZE, GUESS), 134, 137));
});

test('a dark hole in a pale disc, its inner ring round it too: the same middle', () => {
  const g = picture(SIZE, (x, y) => { const d = Math.hypot(x - 120, y - 123); return d < 14 ? 10 : d < 30 ? 120 : 225; });
  assert.ok(near(holeCentre(g, SIZE, SIZE, GUESS), 120, 123));
});

test('print across the middle does not pull it off the hole', () => {
  const g = picture(SIZE, (x, y) => {
    if (Math.hypot(x - 131, y - 125) < 20) return 245;
    return (y > 160 && y < 175 && x % 12 < 6) || (x > 90 && x < 100 && y % 9 < 4) ? 200 : 25;
  });
  assert.ok(near(holeCentre(g, SIZE, SIZE, GUESS), 131, 125));
});

test('no hole to see: nothing found, rather than a guess', () => {
  assert.strictEqual(holeCentre(picture(SIZE, () => 40), SIZE, SIZE, GUESS), null); // (black on black)
  const stripes = picture(SIZE, (x) => (x % 40 < 20 ? 30 : 220));
  assert.strictEqual(holeCentre(stripes, SIZE, SIZE, GUESS), null);
});

test('a circle far from where a hole could be is not taken for it', () => {
  const g = picture(SIZE, (x, y) => (Math.hypot(x - 128, y - 60) < 20 ? 250 : 20));
  assert.strictEqual(holeCentre(g, SIZE, SIZE, GUESS), null);
});
