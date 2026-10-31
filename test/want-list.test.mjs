import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { wantKey, isWanted, stillWanted, cardOrder, priceWords, foundNote } from '../src/renderer/js/want-list.js';

const require = createRequire(import.meta.url);
const main = require('../src/main/want-list');

test('the shelf knows a wanted album as main does', () => {
  for (const [artist, title] of [['Nirvana', 'Nevermind (Remastered)'], ['System of a Down', 'Toxicity - 2011 Remaster'], ['Björk', 'Homogenic'], ['Сплин', 'Гранатовый альбом'], ['!!!', '!!!'], ['Pearl Jam', 'Ten (Deluxe Edition)']]) {
    assert.strictEqual(wantKey(artist, title), main.wantKey(artist, title), `${artist} / ${title}`);
  }
});

test('on the list or not, and how many are still wanted', () => {
  const items = main.add(main.add([], { artist: 'Radiohead', title: 'Amnesiac' }, 1), { artist: 'Björk', title: 'Homogenic' }, 2);
  assert.ok(isWanted(items, 'RADIOHEAD', 'Amnesiac (Collector\'s Edition)'));
  assert.ok(!isWanted(items, 'Radiohead', 'Kid A'));
  assert.ok(!isWanted(null, 'Radiohead', 'Amnesiac'));
  const crossed = main.crossOff(items, [{ id: 'x', artist: 'Radiohead', title: 'Amnesiac' }], 5).items;
  assert.strictEqual(stillWanted(crossed), 1);
  assert.deepStrictEqual(cardOrder(crossed).map((x) => x.title), ['Homogenic', 'Amnesiac']); // crossed off at the end
});

test('a card\'s price line', () => {
  assert.strictEqual(priceWords(undefined), 'LOOKING ON DISCOGS…');
  assert.strictEqual(priceWords({ error: 'OFFLINE' }), 'DISCOGS UNAVAILABLE');
  assert.strictEqual(priceWords(null), 'DISCOGS UNAVAILABLE');
  assert.strictEqual(priceWords({ releaseId: null }), 'NOT ON DISCOGS');
  assert.strictEqual(priceWords({ releaseId: 1, price: { lowest: 7.5, currency: 'USD' } }), 'from $7.50 on Discogs');
  assert.strictEqual(priceWords({ releaseId: 1, price: { lowest: null, currency: 'USD' } }), 'not for sale');
});

test('the status line when wanted albums turn up', () => {
  assert.strictEqual(foundNote([]), '');
  assert.strictEqual(foundNote([{ artist: 'Radiohead', title: 'Amnesiac' }]), 'FOUND IT: RADIOHEAD — AMNESIAC · CROSSED OFF YOUR WANT LIST');
  assert.strictEqual(foundNote([{ artist: 'A', title: 'B' }, { artist: 'C', title: 'D' }]), '2 ALBUMS FROM YOUR WANT LIST TURNED UP ★');
});
