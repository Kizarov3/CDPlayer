'use strict';
// test/edge-album-runs.test.js — runs with songs marked not to play, at their edges
const test = require('node:test');
const assert = require('node:assert');
const runs = require('../src/main/album-runs');

const skipping = (...ix) => (i) => ix.includes(i);

test('the first songs passed over: the run starts at the first one to play', () => {
  const s = runs.empty(), skip = skipping(0, 1);
  assert.strictEqual(runs.heard(s, 'A', 2, 4, 1, skip).through, false);
  assert.strictEqual(runs.heard(s, 'A', 3, 4, 2, skip).through, true);
  assert.strictEqual(runs.throughCount(s, 'A'), 1);
});

test('two passed over in a row: the run goes on past both; one of them played anyway keeps it', () => {
  const s = runs.empty(), skip = skipping(2, 3);
  runs.heard(s, 'A', 0, 6, 0, skip); runs.heard(s, 'A', 1, 6, 1, skip); runs.heard(s, 'A', 4, 6, 2, skip);
  assert.deepStrictEqual(runs.bookmark(s, 'A', 6, 3), { track: 4, at: 2 });
  assert.strictEqual(runs.heard(s, 'A', 5, 6, 3, skip).through, true);
  const t = runs.empty();
  runs.heard(t, 'A', 0, 6, 0, skip); runs.heard(t, 'A', 1, 6, 1, skip);
  runs.heard(t, 'A', 3, 6, 2, skip); // the second of them, picked by hand
  runs.heard(t, 'A', 4, 6, 3, skip);
  assert.strictEqual(runs.heard(t, 'A', 5, 6, 4, skip).through, true);
});

test('the first song passed over but played anyway starts the run too', () => {
  const s = runs.empty(), skip = skipping(0);
  runs.heard(s, 'A', 0, 3, 0, skip); runs.heard(s, 'A', 1, 3, 1, skip);
  assert.strictEqual(runs.heard(s, 'A', 2, 3, 2, skip).through, true);
});

test('jumping past the next one to play breaks the run', () => {
  const s = runs.empty(), skip = skipping(2);
  runs.heard(s, 'A', 0, 6, 0, skip); runs.heard(s, 'A', 1, 6, 1, skip);
  runs.heard(s, 'A', 4, 6, 2, skip); // 3 was next
  assert.strictEqual(runs.bookmark(s, 'A', 6, 3), null);
  assert.strictEqual(runs.heard(s, 'A', 5, 6, 3, skip).through, false);
  assert.strictEqual(runs.throughCount(s, 'A'), 0);
});

test('starting again from the first one to play restarts the run', () => {
  const s = runs.empty(), skip = skipping(0);
  runs.heard(s, 'A', 1, 6, 0, skip); runs.heard(s, 'A', 2, 6, 1, skip); runs.heard(s, 'A', 3, 6, 2, skip);
  assert.deepStrictEqual(runs.bookmark(s, 'A', 6, 3), { track: 3, at: 2 });
  runs.heard(s, 'A', 1, 6, 4, skip);
  assert.strictEqual(runs.bookmark(s, 'A', 6, 5), null, 'one song heard: just a song');
});

test('all songs after the first passed over: the first is played through at once, like a single', () => {
  const s = runs.empty(), skip = skipping(1, 2, 3);
  assert.strictEqual(runs.heard(s, 'A', 0, 4, 0, skip).through, true);
  assert.strictEqual(runs.bookmark(s, 'A', 4, 1), null);
});
