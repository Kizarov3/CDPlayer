import test from 'node:test';
import assert from 'node:assert';
import { showsAlbum, showChoices } from '../src/renderer/js/shelf-show.js';

const DAY = 86400e3, now = 400 * DAY;
const albums = [
  { id: 'a', year: '1997', genre: 'Rock', plays: 9, touched: now - 100 * DAY },
  { id: 'b', year: '1999', genre: 'rock ', plays: 0, wrapped: true, touched: now - 100 * DAY },
  { id: 'c', year: '2004', genre: 'Jazz', plays: 3, touched: now - DAY, bookmark: { track: 2 }, note: 'lent to Sam' },
  { id: 'd', year: null, plays: 0, touched: now },
];
const ids = (show) => albums.filter((a) => showsAlbum(a, show, now)).map((a) => a.id).join('');

test('each SHOW stands up only its albums', () => {
  assert.strictEqual(ids('ALL'), 'abcd');
  assert.strictEqual(ids('DUSTY'), 'a', 'shrink-wrapped is new, not dusty');
  assert.strictEqual(ids('WRAPPED'), 'b');
  assert.strictEqual(ids('LEFT'), 'c');
  assert.strictEqual(ids('NOTE'), 'c');
  assert.strictEqual(ids('UNPLAYED'), 'bd');
  assert.strictEqual(ids('Y1990'), 'ab');
  assert.strictEqual(ids('Grock'), 'ab', 'a genre, whatever its case');
});

test('the choices: only kinds there are, decades in order, genres most first', () => {
  const c = showChoices(albums, now);
  assert.deepStrictEqual(c.kinds.map((k) => `${k.show}${k.count}`), ['DUSTY1', 'WRAPPED1', 'LEFT1', 'NOTE1', 'UNPLAYED2']);
  assert.deepStrictEqual(c.decades.map((d) => `${d.decade}:${d.count}`), ['1990:2', '2000:1']);
  assert.deepStrictEqual(c.genres.map((g) => `${g.label}:${g.count}`), ['Rock:2', 'Jazz:1']);
});
