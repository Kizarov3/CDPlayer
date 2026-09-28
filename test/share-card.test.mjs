import test from 'node:test';
import assert from 'node:assert';
import { cardLyric, cardSubtitle } from '../src/renderer/js/share-card.js';

const lines = [{ time: 1, text: 'Hello there' }, { time: 5, text: '' }, { time: 9, text: '  And again  ' }];

test('the card quotes the line being sung, not a break between lines, and nothing before the first line', () => {
  assert.strictEqual(cardLyric(lines, 3), 'Hello there');
  assert.strictEqual(cardLyric(lines, 6), null);          // an instrumental break
  assert.strictEqual(cardLyric(lines, 12), 'And again');
  assert.strictEqual(cardLyric(lines, 0.5), null);
  assert.strictEqual(cardLyric([], 3), null);             // untimed lyrics: no line to quote
});

test('under the artist: the album and its year, whichever are known', () => {
  assert.strictEqual(cardSubtitle({ album: 'Doolittle', credits: { released: '1989-04-17' } }), 'Doolittle · 1989');
  assert.strictEqual(cardSubtitle({ album: 'Doolittle', credits: {} }), 'Doolittle');
  assert.strictEqual(cardSubtitle({ credits: { released: '1989' } }), '1989');
  assert.strictEqual(cardSubtitle(null), '');
});
