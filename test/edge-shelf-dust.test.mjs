// test/edge-shelf-dust.test.mjs — pickSome at its edges
import test from 'node:test';
import assert from 'node:assert';
import { pickSome } from '../src/renderer/js/shelf-dust.js';

const DAY = 86400000, now = Date.UTC(2026, 9, 1);
const seeded = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const shelf = Array.from({ length: 6 }, (_, k) => ({ id: `a${k}`, touched: now - k * 40 * DAY }));
const ids = (list) => list.map((a) => a.id);

test('pickSome: nothing from an empty shelf, none for n of 0 or less', () => {
  assert.deepStrictEqual(pickSome([], 3, now, seeded(1)), []);
  assert.deepStrictEqual(pickSome(shelf, 0, now, seeded(1)), []);
  assert.deepStrictEqual(pickSome(shelf, -2, now, seeded(1)), []);
});

test('pickSome: more asked than there are → every album once, the shelf itself left as it was', () => {
  const before = shelf.slice();
  const got = pickSome(shelf, 50, now, seeded(7));
  assert.strictEqual(got.length, shelf.length);
  assert.deepStrictEqual(new Set(ids(got)), new Set(ids(shelf)));
  assert.deepStrictEqual(shelf, before, 'not changed in place');
});

test('pickSome: the same seed picks the same albums in the same order; each pick different', () => {
  const a = ids(pickSome(shelf, 4, now, seeded(42))), b = ids(pickSome(shelf, 4, now, seeded(42)));
  assert.deepStrictEqual(a, b);
  assert.strictEqual(new Set(a).size, 4);
  assert.deepStrictEqual(ids(pickSome(shelf, 3, now, () => 0)), ['a0', 'a1', 'a2'], 'rnd 0: the first left each time');
  assert.deepStrictEqual(ids(pickSome(shelf, 3, now, () => 0.999999)), ['a5', 'a4', 'a3'], 'rnd ~1: the last left each time');
});
