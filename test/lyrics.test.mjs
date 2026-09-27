import test from 'node:test';
import assert from 'node:assert';
import { parseLrc, formatLyricsForDisplay, currentLineIndex, wordProgress, lineState } from '../src/renderer/js/lyrics.js';

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

test('word ends: a stamp with no word after it ends the word before; one at the end ends the line', () => {
  const [line] = parseLrc("[00:08.84]<00:08.84>Now <00:09.16>he's <00:09.59> <00:10.06>thinkin'<00:12.34>");
  assert.strictEqual(line.text, "Now he's thinkin'");
  assert.deepStrictEqual(line.words, [
    { time: 8.84, text: 'Now ' }, { time: 9.16, end: 9.59, text: "he's " }, { time: 10.06, end: 12.34, text: "thinkin'" },
  ]);
  assert.strictEqual(line.end, 12.34);
});

test('singers and backing vocals, shifted with a repeated line', () => {
  const lines = parseLrc('[00:16.71][01:16.71]v2:<00:16.71>It <00:17.02>starts<00:19.11>\n[bg: <00:18.00>(oh <00:18.30>no)<00:18.90>]');
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0].agent, 'v2');
  assert.strictEqual(lines[0].text, 'It starts');
  assert.deepStrictEqual(lines[0].bg, [{ time: 18, text: '(oh ' }, { time: 18.3, end: 18.9, text: 'no)' }]);
  const r = (x) => Math.round(x * 100) / 100; // shifted times are sums of decimals
  assert.deepStrictEqual(lines[1].bg.map((w) => r(w.time)), [78, 78.3]);
  assert.strictEqual(r(lines[1].end), 79.11);
});

test('the lyrics as text: no singer prefixes, backing vocals as their words', () => {
  assert.strictEqual(formatLyricsForDisplay('[00:16.71]v2:<00:16.71>It <00:17.02>starts\n[bg: <00:18.00>(oh <00:18.30>no)]'), 'It starts\n(oh no)');
});

test('line state: singing until the line ends, then not until the next line', () => {
  const lines = parseLrc('[00:01.00]<00:01.00>a<00:02.00>\n[00:09.00]b');
  assert.deepStrictEqual(lineState(lines, 1.5), { index: 0, singing: true });
  assert.deepStrictEqual(lineState(lines, 4), { index: 0, singing: false });
  assert.deepStrictEqual(lineState(lines, 9.5), { index: 1, singing: true });
  assert.deepStrictEqual(lineState(lines, 0.5), { index: -1, singing: false });
});
