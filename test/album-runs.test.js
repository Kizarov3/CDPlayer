'use strict';
const test = require('node:test');
const assert = require('node:assert');
const runs = require('../src/main/album-runs');

const DAY = 86400e3;

test('an album played from its first song to its last is played through', () => {
  const s = runs.empty();
  for (let i = 0; i < 3; i++) assert.strictEqual(runs.heard(s, 'A', i, 4, i).through, false);
  assert.strictEqual(runs.heard(s, 'A', 3, 4, 3).through, true);
  assert.strictEqual(runs.throughCount(s, 'A'), 1);
  assert.strictEqual(runs.bookmark(s, 'A', 4, 4), null, 'finished: no bookmark');
});

test('left half-way, a bookmark at the song that was playing', () => {
  const s = runs.empty();
  runs.heard(s, 'A', 0, 10, 0); runs.heard(s, 'A', 1, 10, 1); runs.heard(s, 'A', 2, 10, 2);
  assert.deepStrictEqual(runs.bookmark(s, 'A', 10, 3), { track: 2, at: 2 });
  assert.strictEqual(runs.bookmark(s, 'A', 10, 2 + 61 * DAY), null, 'forgotten after two months');
});

test('one song alone is no bookmark; out of order, or started part-way, is no run', () => {
  const s = runs.empty();
  runs.heard(s, 'A', 0, 10, 0);
  assert.strictEqual(runs.bookmark(s, 'A', 10, 1), null);
  runs.heard(s, 'A', 1, 10, 1); runs.heard(s, 'A', 5, 10, 2);
  assert.strictEqual(runs.bookmark(s, 'A', 10, 3), null);
  runs.heard(s, 'B', 3, 4, 0);
  assert.strictEqual(runs.heard(s, 'B', 3, 4, 0).through, false);
  assert.strictEqual(runs.throughCount(s, 'B'), 0);
});

test('the song playing heard again (after a restart, say) keeps the run', () => {
  const s = runs.empty();
  runs.heard(s, 'A', 0, 3, 0); runs.heard(s, 'A', 1, 3, 1); runs.heard(s, 'A', 1, 3, 2);
  assert.strictEqual(runs.heard(s, 'A', 2, 3, 3).through, true);
});

test('a single is played through at once; starting again restarts the run', () => {
  const s = runs.empty();
  assert.strictEqual(runs.heard(s, 'S', 0, 1, 0).through, true);
  runs.heard(s, 'A', 0, 5, 0); runs.heard(s, 'A', 1, 5, 1); runs.heard(s, 'A', 0, 5, 2);
  assert.strictEqual(runs.bookmark(s, 'A', 5, 3), null);
});

test('a broken file reads as nothing heard', () => {
  assert.deepStrictEqual(runs.parse('nope'), runs.empty());
});
