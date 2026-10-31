import test from 'node:test';
import assert from 'node:assert';
import { artistKeys, similarPool, similarOnShelf, createSimilarLookup } from '../src/renderer/js/similar-shelf.js';

const album = (artist, title, extra = {}) => ({ id: `${artist}/${title}`, artist, title, plays: 0, lastPlayed: null, tracks: [{ path: `/m/${artist}/${title}/1.flac` }], ...extra });
const titles = (list) => list.map((a) => a.title);
const LIKE_MASSIVE = [{ name: 'Portishead', match: 1 }, { name: 'Tricky', match: 0.8 }, { name: 'Björk', match: 0.5 }, { name: 'Massive Attack', match: 0.4 }];

const mezz = album('Massive Attack', 'Mezzanine');
const SHELF = [
  mezz, album('Massive Attack', 'Blue Lines'),
  album('Björk', 'Homogenic'),
  album('Portishead', 'Dummy'), album('Portishead', 'Third', { plays: 9 }),
  album('Tricky', 'Maxinquaye'),
  album('Nirvana', 'Nevermind'),
  album('Various Artists', 'Trip-Hop Classics'),
];

test('IF YOU LIKE THIS: albums of yours by the likest artists, one each first; not the artist\'s own, not compilations', () => {
  assert.deepStrictEqual(titles(similarOnShelf(mezz, SHELF, LIKE_MASSIVE)), ['Third', 'Maxinquaye', 'Homogenic', 'Dummy']);
  assert.deepStrictEqual(titles(similarOnShelf(mezz, SHELF, LIKE_MASSIVE, { limit: 2 })), ['Third', 'Maxinquaye']);
});

test('nothing like it on the shelf, or nothing known: none — no one else\'s albums', () => {
  assert.deepStrictEqual(similarOnShelf(mezz, SHELF, [{ name: 'Morcheeba', match: 1 }]), []);
  assert.deepStrictEqual(similarOnShelf(mezz, SHELF, []), []);
  assert.strictEqual(similarOnShelf(album('', 'Untitled'), SHELF, LIKE_MASSIVE).length, 5); // (no artist: nothing of its own to leave out; five at most)
});

test('an album\'s editions count once — the most played of them', () => {
  const ten = album('Pearl Jam', 'Ten'), deluxe = album('Pearl Jam', 'Ten (Deluxe Edition)', { plays: 3 });
  const found = similarOnShelf(album('Soundgarden', 'Superunknown'), [ten, deluxe, album('Pearl Jam', 'Vs.')], [{ name: 'Pearl Jam', match: 1 }]);
  assert.deepStrictEqual(titles(found), ['Ten (Deluxe Edition)', 'Vs.']);
});

test('names compared as the shelf does; a collaboration is each of its artists\'', () => {
  assert.deepStrictEqual(artistKeys('Jay-Z & Kanye West'), ['jayzkanyewest', 'jayz', 'kanyewest']);
  assert.deepStrictEqual(artistKeys('Florence and the Machine'), ['florenceandthemachine']);
  assert.deepStrictEqual(artistKeys('Various Artists'), []);
  const watch = album('Jay-Z & Kanye West', 'Watch the Throne');
  assert.deepStrictEqual(titles(similarOnShelf(album('Nas', 'Illmatic'), [watch], [{ name: 'KANYE WEST', match: 1 }])), ['Watch the Throne']);
  // …and one of its artists' own album isn't "like" it
  assert.deepStrictEqual(similarOnShelf(album('Kanye West', 'Graduation'), [watch], [{ name: 'Jay-Z', match: 1 }]), []);
});

test('the pool for the changer: every album like it, the likest first, with each one\'s place', () => {
  const pool = similarPool('Massive Attack', SHELF, LIKE_MASSIVE);
  assert.deepStrictEqual(pool.map((p) => [p.album.title, p.rank]), [['Third', 0], ['Dummy', 0], ['Maxinquaye', 1], ['Homogenic', 2]]);
  assert.deepStrictEqual(similarPool(null, SHELF, null), []);
});

test('the lookup asks once for each artist; an empty answer is asked again later', async () => {
  const asked = [];
  let answer = [];
  const look = createSimilarLookup(async (artist) => { asked.push(artist); return answer; });
  assert.strictEqual(look.known('Massive Attack'), null);
  assert.deepStrictEqual(await look.get('Massive Attack'), []);
  answer = LIKE_MASSIVE;
  assert.deepStrictEqual(await look.get('massive attack'), LIKE_MASSIVE);
  await look.get('MASSIVE ATTACK');
  assert.strictEqual(asked.length, 2);
  assert.deepStrictEqual(look.known('Massive Attack'), LIKE_MASSIVE);
  const failing = createSimilarLookup(async () => { throw new Error('offline'); });
  assert.deepStrictEqual(await failing.get('A'), []);
  assert.deepStrictEqual(await look.get(''), []);
});
