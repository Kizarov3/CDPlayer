import test from 'node:test';
import assert from 'node:assert';
import { noteLook, cleanNote, NOTE_MAX, NOTE_COLORS } from '../src/renderer/js/shelf-notes.js';
import { matchesFilter } from '../src/renderer/js/shelf-order.js';

test('a note has the same colour and tilt every time, and the colours go round the albums', () => {
  assert.deepStrictEqual(noteLook('korn\nissues\n'), noteLook('korn\nissues\n'));
  const colors = new Set(Array.from({ length: 60 }, (_, i) => noteLook(`artist ${i}\nalbum\n`).color));
  assert.strictEqual(colors.size, NOTE_COLORS.length);
  for (let i = 0; i < 60; i++) { const { tilt } = noteLook(`a${i}`); assert.ok(Math.abs(tilt) <= 4 && Math.abs(tilt) >= 1, `${tilt}`); }
});

test('a note is trimmed, keeps at most one blank line in a row, and fits on the paper', () => {
  assert.strictEqual(cleanNote('  hello  '), 'hello');
  assert.strictEqual(cleanNote('a\n\n\n\nb'), 'a\n\nb');
  assert.strictEqual(cleanNote('a  \t\n  b'), 'a\n  b');
  assert.strictEqual(cleanNote('   \n  '), '');
  assert.strictEqual([...cleanNote('я'.repeat(500))].length, NOTE_MAX);
  assert.strictEqual(cleanNote(null), '');
});

test('the shelf\'s filter finds albums by artist, title, year and their note', () => {
  const a = { artist: 'Tool', title: 'Lateralus', year: '2001', note: 'For the long drive\nnorth' };
  assert.ok(matchesFilter(a, 'tool 2001'));
  assert.ok(matchesFilter(a, 'LONG drive'));
  assert.ok(matchesFilter(a, ''));
  assert.ok(!matchesFilter(a, 'korn'));
  assert.ok(matchesFilter({ artist: null, title: 'X', year: null }, 'x'));
});
