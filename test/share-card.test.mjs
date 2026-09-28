import test from 'node:test';
import assert from 'node:assert';
import { cardSubtitle } from '../src/renderer/js/share-card.js';

test('under the artist: the album and its year, whichever are known', () => {
  assert.strictEqual(cardSubtitle({ album: 'Doolittle', credits: { released: '1989-04-17' } }), 'Doolittle · 1989');
  assert.strictEqual(cardSubtitle({ album: 'Doolittle', credits: {} }), 'Doolittle');
  assert.strictEqual(cardSubtitle({ credits: { released: '1989' } }), '1989');
  assert.strictEqual(cardSubtitle(null), '');
});

test('the lines to pick from: timed lyrics with the one being sung picked, breaks and blanks left out', async () => {
  const { lyricChoices } = await import('../src/renderer/js/share-card.js');
  const lrc = '[ar:Pixies]\n[00:01.00]Got me a movie\n[00:05.00]\n[00:09.00]  I want you to know  \n[00:12.00]Slicing up eyeballs';
  assert.deepStrictEqual(lyricChoices(lrc, 10), { lines: ['Got me a movie', 'I want you to know', 'Slicing up eyeballs'], picked: 1 });
  assert.strictEqual(lyricChoices(lrc, 6).picked, -1);  // in a break: no line, until one is picked
  assert.strictEqual(lyricChoices(lrc, 0).picked, -1);
});

test('untimed lyrics can be picked from too — nothing picked to start with — and section labels are left out', async () => {
  const { lyricChoices } = await import('../src/renderer/js/share-card.js');
  assert.deepStrictEqual(lyricChoices('[Verse 1]\nGot me a movie\n\n  I want you to know\n[Chorus]', 30), { lines: ['Got me a movie', 'I want you to know'], picked: -1 });
  assert.deepStrictEqual(lyricChoices(null, 3), { lines: [], picked: -1 });
});

test('picked lines go on the card in the song\'s order, "…" where lines were skipped, ten at most', async () => {
  const { quoteLines, MAX_QUOTE_LINES } = await import('../src/renderer/js/share-card.js');
  const lines = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
  assert.strictEqual(MAX_QUOTE_LINES, 10);
  assert.deepStrictEqual(quoteLines(lines, [3]), ['d']);
  assert.deepStrictEqual(quoteLines(lines, [4, 1, 2, 2]), ['b', 'c', '…', 'e']);
  assert.deepStrictEqual(quoteLines(lines, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), lines.slice(0, 10));
  assert.strictEqual(quoteLines(lines, []), null);
});

test('the quote gets smaller as it gets longer, and ten long lines still fit', async () => {
  const { layoutQuote } = await import('../src/renderer/js/share-card.js');
  const measure = (text, size) => text.length * size * 0.5; // a stand-in for the canvas's text measuring
  const one = layoutQuote(['Got me a movie'], measure, 460, 300);
  assert.strictEqual(one.size, 28);
  const long = 'Slicing up eyeballs, I want you to know, girlie so groovy';
  const ten = layoutQuote(Array(10).fill(long), measure, 460, 300);
  assert.ok(ten.size < 28 && ten.size >= 14, `size ${ten.size}`);
  assert.ok(ten.rows.length * ten.lineHeight <= 300, `${ten.rows.length} rows of ${ten.lineHeight}`);
  assert.ok(ten.rows.every((r) => measure(r.text, ten.size) <= 460));
  assert.strictEqual(ten.rows[0].text.startsWith('“'), true);
  assert.strictEqual(ten.rows[ten.rows.length - 1].text.endsWith('”'), true);
});
