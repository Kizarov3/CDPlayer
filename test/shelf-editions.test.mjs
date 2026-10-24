import test from 'node:test';
import assert from 'node:assert';
import { groupEditions, editionName } from '../src/renderer/js/shelf-editions.js';

const album = (artist, title, extra = {}) => ({ id: `${artist}/${title}`, artist, title, year: null, plays: 0, lastPlayed: null, tracks: [], ...extra });
const names = (list) => list.map((a) => (a.editions ? `${a.title} ×${a.editions.length}` : a.title));

test('editions of one album stand as one, where the first of them stood; the one played last in front', () => {
  const ten = album('Pearl Jam', 'Ten', { year: '1991', lastPlayed: 100 }), deluxe = album('Pearl Jam', 'Ten (Deluxe Edition)', { year: '2009', lastPlayed: 200 });
  const shelf = [album('Nirvana', 'Nevermind'), ten, album('Pearl Jam', 'Vs.'), deluxe];
  assert.deepStrictEqual(names(groupEditions(shelf)), ['Nevermind', 'Ten (Deluxe Edition) ×2', 'Vs.']);
  assert.deepStrictEqual(deluxe.editions, [ten, deluxe]);
  assert.strictEqual(ten.editions, null);
  // none played: the most played, else the first
  assert.deepStrictEqual(names(groupEditions([album('A', 'X', { plays: 1 }), album('A', 'X - 2011 Remaster', { plays: 5 })])), ['X - 2011 Remaster ×2']);
  assert.deepStrictEqual(names(groupEditions([album('A', 'X'), album('A', 'X [Remastered]')])), ['X ×2']);
});

test('not editions: another artist, a compilation, untagged music, a set’s separate discs', () => {
  const shelf = [album('A', 'Hits'), album('B', 'Hits (Remastered)'), album('Various Artists', 'Now 5'), album('Various Artists', 'Now 5 (Deluxe)'),
    album(null, 'Music'), album(null, 'Music (Deluxe)'), album('C', 'Live (Disc 1)'), album('C', 'Live (Disc 2)')];
  assert.deepStrictEqual(names(groupEditions(shelf)), shelf.map((a) => a.title));
  assert.ok(shelf.every((a) => a.editions === null));
});

test('grouped afresh each time: an album no longer with its other edition stands alone again', () => {
  const a = album('A', 'X'), b = album('A', 'X (Deluxe)', { lastPlayed: 5 });
  groupEditions([a, b]);
  assert.deepStrictEqual(names(groupEditions([b])), ['X (Deluxe)']);
});

test('an edition’s name: the words its title has beyond the others’, else its year when theirs differ, else nothing', () => {
  const ten = album('Pearl Jam', 'Ten', { year: '1991' }), deluxe = album('Pearl Jam', 'Ten (Deluxe Edition)', { year: '2009' }), tail = album('Pearl Jam', 'Ten - 2009 Remaster', { year: '2009' });
  const all = [ten, deluxe, tail];
  assert.strictEqual(editionName(deluxe, all), 'Deluxe Edition');
  assert.strictEqual(editionName(tail, all), '2009 Remaster');
  assert.strictEqual(editionName(ten, all), '1991');
  assert.strictEqual(editionName(album('A', 'X [Remastered] (Bonus Tracks)'), [album('A', 'X'), album('A', 'X [Remastered] (Bonus Tracks)')]), 'Remastered · Bonus Tracks');
  assert.strictEqual(editionName(album('A', 'X', { year: '1990' }), [album('A', 'X', { year: '1990' }), album('A', 'X (Mono)', { year: '1990' })]), '');
});
