import test from 'node:test';
import assert from 'node:assert';
import { moveItem } from '../src/renderer/js/queue-move.js';

const q = ['a', 'b', 'c', 'd', 'e'];

test('moving the playing row takes the index with it', () => {
  assert.deepStrictEqual(moveItem(q, 2, 2, 4), { queue: ['a', 'b', 'd', 'e', 'c'], index: 4 });
  assert.deepStrictEqual(moveItem(q, 2, 2, 0), { queue: ['c', 'a', 'b', 'd', 'e'], index: 0 });
});

test('a row moved from above to below the playing one lowers the index, and back raises it', () => {
  assert.deepStrictEqual(moveItem(q, 2, 0, 4), { queue: ['b', 'c', 'd', 'e', 'a'], index: 1 });
  assert.deepStrictEqual(moveItem(q, 2, 4, 0), { queue: ['e', 'a', 'b', 'c', 'd'], index: 3 });
});

test('a row moved without crossing the playing one leaves the index alone', () => {
  assert.deepStrictEqual(moveItem(q, 2, 3, 4), { queue: ['a', 'b', 'c', 'e', 'd'], index: 2 });
  assert.deepStrictEqual(moveItem(q, 4, 0, 3), { queue: ['b', 'c', 'd', 'a', 'e'], index: 4 });
});

test('one step is a swap of neighbours, the playing row following', () => {
  assert.deepStrictEqual(moveItem(q, 2, 1, 2), { queue: ['a', 'c', 'b', 'd', 'e'], index: 1 });
  assert.deepStrictEqual(moveItem(q, 2, 3, 2), { queue: ['a', 'b', 'd', 'c', 'e'], index: 3 });
});

test('moving a row to where it is changes nothing', () => {
  assert.deepStrictEqual(moveItem(q, 2, 1, 1), { queue: q, index: 2 });
});

test('out of range or not whole numbers: the inputs come back unchanged', () => {
  for (const [from, to] of [[-1, 2], [2, -1], [5, 0], [0, 5], [1.5, 2], [NaN, 1], ['1', 2], [undefined, 1]]) {
    assert.deepStrictEqual(moveItem(q, 2, from, to), { queue: q, index: 2 }, `${from} -> ${to}`);
  }
});

test('the same path twice: the index follows the row, not the path', () => {
  const twice = ['x', 'y', 'x', 'z'];
  assert.deepStrictEqual(moveItem(twice, 2, 2, 0), { queue: ['x', 'x', 'y', 'z'], index: 0 });
  assert.deepStrictEqual(moveItem(twice, 0, 2, 0), { queue: ['x', 'x', 'y', 'z'], index: 1 });
  assert.deepStrictEqual(moveItem(twice, 0, 0, 3), { queue: ['y', 'x', 'z', 'x'], index: 3 });
});

test('the queue given is not changed', () => {
  const given = ['a', 'b', 'c'];
  const out = moveItem(given, 0, 0, 2);
  assert.deepStrictEqual(given, ['a', 'b', 'c']);
  assert.notStrictEqual(out.queue, given);
});
