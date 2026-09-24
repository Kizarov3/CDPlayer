import test from 'node:test';
import assert from 'node:assert';
import { parseLrc, formatLyricsForDisplay, currentLineIndex } from '../src/renderer/js/lyrics.js';

test('LRC parsing: multiple stamps per line, headers skipped, sorted by time', () => {
  const lines = parseLrc('[ti:Song]\n[00:12.50]Second\n[00:01.00][01:00]Chorus\nuntimed');
  assert.deepStrictEqual(lines, [
    { time: 1, text: 'Chorus' }, { time: 12.5, text: 'Second' }, { time: 60, text: 'Chorus' },
  ]);
});

test('plain display strips timestamps and header tags', () => {
  assert.strictEqual(formatLyricsForDisplay('[ar:Me]\n[00:01.00]Hello\nWorld'), 'Hello\nWorld');
});

test('current line follows playback position', () => {
  const lines = parseLrc('[00:01.00]a\n[00:05.00]b');
  assert.strictEqual(currentLineIndex(lines, 0.5), -1);
  assert.strictEqual(currentLineIndex(lines, 1), 0);
  assert.strictEqual(currentLineIndex(lines, 9), 1);
});
