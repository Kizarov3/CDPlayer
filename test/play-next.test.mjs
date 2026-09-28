import test from 'node:test';
import assert from 'node:assert';
import { insertNext, pinnedNext, afterRemove } from '../src/renderer/js/play-next.js';

test('play next goes straight after the song playing, and plays next even shuffled', () => {
  const r = insertNext(['a', 'b', 'c', 'd'], 1, null, ['x', 'y']);
  assert.deepStrictEqual(r.queue, ['a', 'b', 'x', 'y', 'c', 'd']);
  assert.deepStrictEqual(r.nextUp, { start: 2, end: 4 });
  assert.strictEqual(pinnedNext(1, r.nextUp, 6), 2);
  assert.strictEqual(pinnedNext(2, r.nextUp, 6), 3);
  assert.strictEqual(pinnedNext(3, r.nextUp, 6), -1); // played through: back to the usual order (or shuffle)
});

test('asked again, it goes after what was already to play next, so they play in the order asked for', () => {
  let r = insertNext(['a', 'b', 'c'], 0, null, ['x']);
  r = insertNext(r.queue, 0, r.nextUp, ['y', 'z']);
  assert.deepStrictEqual(r.queue, ['a', 'x', 'y', 'z', 'b', 'c']);
  assert.deepStrictEqual(r.nextUp, { start: 1, end: 4 });
  // Part way through them, it still goes after the rest of them.
  r = insertNext(r.queue, 2, r.nextUp, ['w']);
  assert.deepStrictEqual(r.queue, ['a', 'x', 'y', 'z', 'w', 'b', 'c']);
  assert.deepStrictEqual(r.nextUp, { start: 1, end: 5 });
});

test('once they have played (or another song was picked), play next starts afresh after the current song', () => {
  const r = insertNext(['a', 'x', 'b', 'c', 'd'], 3, { start: 1, end: 2 }, ['y']);
  assert.deepStrictEqual(r.queue, ['a', 'x', 'b', 'c', 'y', 'd']);
  assert.deepStrictEqual(r.nextUp, { start: 4, end: 5 });
  assert.strictEqual(pinnedNext(3, null, 6), -1);
});

test('removing a song from the queue keeps the songs to play next marked', () => {
  const nextUp = { start: 2, end: 4 };
  assert.deepStrictEqual(afterRemove(nextUp, 0), { start: 1, end: 3 }); // before them
  assert.deepStrictEqual(afterRemove(nextUp, 2), { start: 2, end: 3 }); // one of them
  assert.deepStrictEqual(afterRemove(nextUp, 5), nextUp);              // after them
  assert.strictEqual(afterRemove({ start: 2, end: 3 }, 2), null);       // the last of them
  assert.strictEqual(afterRemove(null, 1), null);
});
