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

test('songs marked not to play are passed over: the run goes on past them and ends at the last one to play', () => {
  const s = runs.empty(), skip = (i) => i === 0 || i === 2 || i === 4; // an intro, a skit, an outro
  assert.strictEqual(runs.heard(s, 'A', 1, 5, 1, skip).through, false, 'the first one to play starts it');
  assert.deepStrictEqual(runs.bookmark(s, 'A', 5, 1), null, 'one song is just a song');
  assert.strictEqual(runs.heard(s, 'A', 3, 5, 3, skip).through, true, 'the skit and the outro passed over: played through');
  assert.strictEqual(runs.throughCount(s, 'A'), 1);
});

test('a song passed over but played anyway keeps the run; the bookmark is at the song heard last', () => {
  const s = runs.empty(), skip = (i) => i === 2;
  runs.heard(s, 'A', 0, 6, 0, skip); runs.heard(s, 'A', 1, 6, 1, skip);
  runs.heard(s, 'A', 2, 6, 2, skip); // picked by hand
  runs.heard(s, 'A', 3, 6, 3, skip);
  assert.deepStrictEqual(runs.bookmark(s, 'A', 6, 4), { track: 3, at: 3 });
  runs.heard(s, 'A', 3, 6, 5, skip); // the same one again: no break
  assert.deepStrictEqual(runs.bookmark(s, 'A', 6, 6), { track: 3, at: 3 });
  runs.heard(s, 'A', 1, 6, 7, skip); // out of order
  assert.strictEqual(runs.bookmark(s, 'A', 6, 8), null);
});

test('a run kept by 2.18.0 (only `next`) still gives its bookmark and goes on', () => {
  const s = runs.parse(JSON.stringify({ through: {}, runs: { A: { next: 3, last: 1 } } }));
  assert.deepStrictEqual(runs.bookmark(s, 'A', 5, 2), { track: 2, at: 1 });
  runs.heard(s, 'A', 3, 5, 2);
  assert.strictEqual(runs.heard(s, 'A', 4, 5, 3).through, true);
});
