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
