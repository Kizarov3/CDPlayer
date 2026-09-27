import test from 'node:test';
import assert from 'node:assert';
import { parseLrc, formatLyricsForDisplay, currentLineIndex, wordProgress } from '../src/renderer/js/lyrics.js';

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

test('enhanced LRC: words with their own times, stamps kept out of the text', () => {
  const [line] = parseLrc("[00:08.84]<00:08.84>Now <00:09.15>he's <00:10.00>es<00:10.20>press<00:10.40>o");
  assert.strictEqual(line.text, "Now he's espresso");
  assert.deepStrictEqual(line.words, [
    { time: 8.84, text: 'Now ' }, { time: 9.15, text: "he's " }, { time: 10, text: 'es' }, { time: 10.2, text: 'press' }, { time: 10.4, text: 'o' },
  ]);
  assert.strictEqual(formatLyricsForDisplay('[00:01.00]<00:01.00>Hello <00:01.50>world'), 'Hello world');
});

test('a repeated line with word stamps gets them shifted to each time it is sung', () => {
  const lines = parseLrc('[00:10.00][01:10.00]<00:10.00>La <00:10.50>la');
  assert.deepStrictEqual(lines[1].words.map((w) => w.time), [70, 70.5]);
});

test('word progress: sung words full, the current one partly, the rest empty', () => {
  const [line] = parseLrc('[00:10.00]<00:10.00>One <00:11.00>two <00:12.00>three');
  assert.deepStrictEqual(wordProgress(line, 20, 11.5), [1, 0.5, 0]);
  // The last word lasts until the next line, but no longer than 1.2 seconds.
  assert.deepStrictEqual(wordProgress(line, 30, 12.6), [1, 1, 0.5]);
  // A line without word stamps fills as one piece.
  const [plain] = parseLrc('[00:10.00]Whole line');
  assert.deepStrictEqual(wordProgress(plain, 12, 11), [0.5]);
});
