import test from 'node:test';
import assert from 'node:assert';
import { stickersFor, NEW_DAYS } from '../src/renderer/js/shelf-stickers.js';

const DAY = 86400000, now = Date.UTC(2026, 8, 28);
const albums = Array.from({ length: 300 }, (_, i) => ({ artist: `Artist ${i}`, title: `Album ${i}`, added: null }));

test('the same album always gets the same obi, catalog number and price', () => {
  for (const a of albums.slice(0, 20)) assert.deepStrictEqual(stickersFor({ ...a }, now), stickersFor(a, now));
});

test('about a third of albums are Japanese editions with an obi and a yen price; some others have a dollar price', () => {
  const s = albums.map((a) => stickersFor(a, now));
  const obi = s.filter((x) => x.obi);
  assert.ok(obi.length > 60 && obi.length < 140, `${obi.length} obis`);
  for (const x of obi) {
    assert.match(x.obi.catalog, /^[A-Z]{4}-\d{5}$/);
    assert.match(x.price, /^¥\d,\d{3}$/);
  }
  const dollars = s.filter((x) => !x.obi && x.price);
  assert.ok(dollars.length > 20, `${dollars.length} dollar prices`);
  for (const x of dollars) assert.match(x.price, /^\$\d{1,2}\.99$/);
  assert.ok(s.some((x) => !x.obi && !x.price), 'some cases have no sticker at all');
});

test(`NEW for ${NEW_DAYS} days after an album turns up`, () => {
  const a = albums[0];
  assert.strictEqual(stickersFor({ ...a, added: now - DAY }, now).isNew, true);
  assert.strictEqual(stickersFor({ ...a, added: now - (NEW_DAYS + 1) * DAY }, now).isNew, false);
  assert.strictEqual(stickersFor({ ...a, added: null }, now).isNew, false);
});
