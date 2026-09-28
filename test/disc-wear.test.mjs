import test from 'node:test';
import assert from 'node:assert';
import { wearFor } from '../src/renderer/js/disc-wear.js';

const SEED = 'Radiohead\nOK Computer';
const marks = (w) => (w ? w.scratches.length + w.rings.length + w.scuffs.length + w.prints.length + w.chips.length : 0);

test('a disc played fewer than ten times is as good as new', () => {
  for (const n of [0, 1, 9]) assert.strictEqual(wearFor(n, SEED), null);
});

test('the more a disc is played, the more worn it gets', () => {
  let last = 0;
  for (const n of [10, 20, 50, 80, 100, 150, 300, 1000]) {
    const m = marks(wearFor(n, SEED));
    assert.ok(m >= last, `${n} plays: ${m} marks, fewer than ${last}`);
    last = m;
  }
  assert.ok(marks(wearFor(10, SEED)) > 0);
  assert.ok(marks(wearFor(1000, SEED)) > marks(wearFor(10, SEED)));
});

test('rings and a first fingerprint at 50 plays, chips round the rim at 100', () => {
  const light = wearFor(49, SEED), worn = wearFor(50, SEED), heavy = wearFor(100, SEED);
  assert.strictEqual(light.rings.length + light.prints.length + light.chips.length, 0);
  assert.ok(worn.rings.length > 0);
  assert.strictEqual(worn.prints.length, 1);
  assert.strictEqual(worn.chips.length, 0);
  assert.ok(heavy.prints.length >= 2 && heavy.prints.length <= 3);
  assert.ok(heavy.chips.length > 0);
  assert.ok(wearFor(10000, SEED).prints.length <= 3);
});

test('the same disc always has the same marks, and another disc has its own', () => {
  assert.deepStrictEqual(wearFor(120, SEED), wearFor(120, SEED));
  assert.notDeepStrictEqual(wearFor(120, SEED).scratches, wearFor(120, 'Korn\nIssues').scratches);
});

test('playing it more keeps every mark it already had, where it was', () => {
  const before = wearFor(60, SEED), after = wearFor(200, SEED);
  for (const kind of ['scratches', 'rings', 'scuffs', 'prints', 'chips']) {
    assert.deepStrictEqual(after[kind].slice(0, before[kind].length), before[kind], kind);
  }
});

test('marks stay on the printed part of the disc, off the hub', () => {
  const w = wearFor(1000, SEED);
  for (const s of [...w.scratches, ...w.rings, ...w.scuffs, ...w.prints]) {
    assert.ok(s.r >= 0.4 && s.r <= 0.97, `r = ${s.r}`);
  }
  for (const c of w.chips) assert.ok(c.a >= 0 && c.a < Math.PI * 2);
});

test('the key changes only when the marks do', () => {
  assert.strictEqual(wearFor(12, SEED).key, wearFor(12, SEED).key);
  assert.notStrictEqual(wearFor(12, SEED).key, wearFor(300, SEED).key);
});
