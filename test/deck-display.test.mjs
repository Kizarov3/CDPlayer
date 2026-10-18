import test from 'node:test';
import assert from 'node:assert';
import { SEGMENTS, timeCells, trackCells } from '../src/renderer/js/deck-display.js';

test('the display\'s time keeps its width: no leading zero, a sign cell for the time left', () => {
  assert.strictEqual(timeCells(0), '  0:00');
  assert.strictEqual(timeCells(187), '  3:07');
  assert.strictEqual(timeCells(187, { left: true }), '- 3:07');
  assert.strictEqual(timeCells(754), ' 12:34');
  assert.strictEqual(timeCells(-5), '  0:00');
  assert.strictEqual(timeCells(6000), ' 100:00', 'over 99 minutes: a third cell');
});

test('the track number: two cells, -- for none', () => {
  assert.deepStrictEqual([trackCells(3), trackCells(12), trackCells(0), trackCells(140)], ['03', '12', '--', '99']);
});

test('every character the display shows has its segments', () => {
  for (const ch of '0123456789- ') assert.ok(typeof SEGMENTS[ch] === 'string', ch);
  assert.strictEqual(SEGMENTS[8].length, 7);
  assert.strictEqual(SEGMENTS[1], 'bc');
});
