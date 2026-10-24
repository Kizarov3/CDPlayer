// test/edge-shelf-dividers.test.mjs — the user's own dividers: SORT → MY DIVIDERS with odd names, and SHOW one of them
import test from 'node:test';
import assert from 'node:assert';
import { arrange } from '../src/renderer/js/shelf-order.js';
import { showsAlbum, showChoices } from '../src/renderer/js/shelf-show.js';

const album = (title, filedUnder, extra = {}) => ({ id: title, artist: 'A', title, year: null, added: null, plays: 0, filedUnder, ...extra });
const show = (items) => items.map((x) => (x.divider ? `[${x.divider}]` : x.title));

test('MY DIVIDERS: cards by name whatever the case, accents and other alphabets in their place, digits first', () => {
  const albums = [album('z', 'Zoo'), album('e', 'été'), album('c1', 'Car'), album('k', 'Ёлка'), album('a', 'apple'),
    album('n', '2024'), album('c2', 'car'), album('r', 'Rock & Roll'), album('r2', 'Rock')];
  assert.deepStrictEqual(show(arrange(albums, 'MINE')),
    ['[2024]', 'n', '[APPLE]', 'a', '[CAR]', 'c1', 'c2', '[ÉTÉ]', 'e', '[ROCK]', 'r2', '[ROCK & ROLL]', 'r', '[ZOO]', 'z', '[ЁЛКА]', 'k']);
});

test('MY DIVIDERS: no name, or an empty one, is NOT FILED, at the end, in the order they came', () => {
  const albums = [album('x', null), album('y', ''), album('f', 'Fav'), album('w', undefined)];
  assert.deepStrictEqual(show(arrange(albums, 'MINE')), ['[FAV]', 'f', '[NOT FILED]', 'x', 'y', 'w']);
  assert.deepStrictEqual(arrange([], 'MINE'), []);
});

test('SHOW a divider: its albums whatever the case, in any alphabet; one named like a SHOW is just a divider', () => {
  const albums = [album('a', 'For the Car'), album('b', 'FOR THE CAR'), album('c', 'Лето'), album('d', 'ЛЕТО'),
    album('e', 'ALL'), album('f', 'dusty', { touched: 1 }), album('g', null), album('h', '   ')];
  const c = showChoices(albums, 1);
  assert.deepStrictEqual(c.dividers.map((d) => `${d.show}|${d.label}|${d.count}`),
    ['FALL|ALL|1', 'FDUSTY|dusty|1', 'FFOR THE CAR|For the Car|2', 'FЛЕТО|Лето|2'], 'a name of only spaces is none');
  const ids = (s) => albums.filter((a) => showsAlbum(a, s, 1)).map((a) => a.id).join('');
  assert.strictEqual(ids('FFOR THE CAR'), 'ab');
  assert.strictEqual(ids('FЛЕТО'), 'cd');
  assert.strictEqual(ids('FALL'), 'e', 'not ALL');
  assert.strictEqual(ids('FDUSTY'), 'f');
  for (const d of c.dividers) assert.ok(!showsAlbum(album('g', null), d.show, 1), `unfiled never shows under ${d.show}`);
});

test('SORT and SHOW agree on which names are one divider', () => {
  // MY DIVIDERS (and the case's menu) tell names apart by toLocaleUpperCase; SHOW by toLowerCase.
  const albums = [album('a', 'Straße'), album('b', 'STRASSE')];
  const cards = arrange(albums, 'MINE').filter((x) => x.divider).map((x) => x.divider);
  assert.deepStrictEqual(cards, ['STRASSE'], 'one card on the shelf');
  assert.strictEqual(showChoices(albums).dividers.length, cards.length, 'so one divider to SHOW');
});
