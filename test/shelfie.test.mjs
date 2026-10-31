import test from 'node:test';
import assert from 'node:assert';
import { shelfieCrops, firstCrop, shelfieLine, completeCount, MAX_ROWS } from '../src/renderer/js/shelfie.js';

const spans = (crops) => crops.map((c) => [c.key, c.from, c.count]);

test('a long shelf: the rows in view, the first three and six, and its first twelve rows', () => {
  assert.deepStrictEqual(spans(shelfieCrops({ rows: 40, first: 7, inView: 3 })), [['VIEW', 7, 3], ['TOP3', 0, 3], ['TOP6', 0, 6], ['ALL', 0, MAX_ROWS]]);
  assert.strictEqual(shelfieCrops({ rows: 40, first: 7, inView: 3 })[3].label, 'FIRST 12 ROWS');
});

test('a short shelf: the whole of it, the same rows never offered twice', () => {
  // scrolled to the top, three rows in view: FIRST 3 ROWS is what's seen
  assert.deepStrictEqual(spans(shelfieCrops({ rows: 5, first: 0, inView: 3 })), [['VIEW', 0, 3], ['ALL', 0, 5]]);
  assert.strictEqual(shelfieCrops({ rows: 5, first: 0, inView: 3 })[1].label, 'THE WHOLE SHELF');
  assert.deepStrictEqual(spans(shelfieCrops({ rows: 2, first: 0, inView: 3 })), [['VIEW', 0, 2]]);
  assert.deepStrictEqual(shelfieCrops({ rows: 0, first: 0, inView: 3 }), []);
});

test('the rows in view stay on the shelf when it is scrolled to its end', () => {
  assert.deepStrictEqual(spans(shelfieCrops({ rows: 8, first: 7, inView: 3 }))[0], ['VIEW', 7, 1]);
  assert.deepStrictEqual(spans(shelfieCrops({ rows: 8, first: 30, inView: 3 }))[0], ['VIEW', 7, 1]);
});

test('picked to start with: a shelf of up to four rows whole, a longer one as it is seen', () => {
  assert.strictEqual(firstCrop(shelfieCrops({ rows: 4, first: 0, inView: 2 })), 2);
  assert.strictEqual(firstCrop(shelfieCrops({ rows: 9, first: 2, inView: 2 })), 0);
  assert.strictEqual(firstCrop(shelfieCrops({ rows: 1, first: 0, inView: 2 })), 0);
});

test('the line: discs (a double album twice), artists complete, and the worth when Discogs priced them', () => {
  const priced = (lowest, currency = 'EUR') => ({ releaseId: 1, price: { lowest, currency } });
  const albums = [{ discs: 2, pressing: priced(12.4) }, { discs: 1, pressing: priced(7.7) }, { discs: 1 }];
  assert.strictEqual(shelfieLine(albums, { complete: 2, currency: 'EUR' }), '4 DISCS · 2 COMPLETE ★ · WORTH €20+ ON DISCOGS');
  assert.strictEqual(shelfieLine(albums.slice(0, 2), { currency: 'EUR' }), '3 DISCS · WORTH €20 ON DISCOGS');
  // prices in another currency than the one set: no worth
  assert.strictEqual(shelfieLine(albums, { currency: 'USD' }), '4 DISCS');
  assert.strictEqual(shelfieLine([{}]), '1 DISC');
});

test('COMPLETE ★: artists shown that MusicBrainz says you have every studio album of', () => {
  const albums = [{ artist: 'Pixies', title: 'Doolittle' }, { artist: 'Pixies', title: 'Surfer Rosa' }, { artist: 'Low', title: 'Things We Lost in the Fire' }, { artist: 'Slint', title: 'Spiderland' }];
  const album = (title, id = title) => ({ id, title, type: 'Album', secondary: [] });
  const discogs = new Map([
    ['pixies', { state: 'found', groups: [album('Doolittle'), album('Surfer Rosa'), { ...album('Live'), secondary: ['Live'] }] }],
    ['low', { state: 'found', groups: [album('Things We Lost in the Fire'), album('Secret Name', 'sn')] }],
    ['slint', { state: 'unknown', groups: [] }],
  ]);
  assert.strictEqual(completeCount(albums, albums, discogs), 1);
  assert.strictEqual(completeCount(albums, albums, discogs, new Set(['sn'])), 2); // a missing one hidden: complete
  assert.strictEqual(completeCount(albums.slice(2), albums, discogs, new Set(['sn'])), 1); // only those shown
});
