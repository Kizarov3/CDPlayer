'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-discogs-'));
process.env.CDPLAYER_HOME = home;
const discogs = require('../src/main/discogs');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const DAY = 86400e3;
const album = { id: 'radiohead\nkid a\n', artist: 'Radiohead', title: 'Kid A', year: '2000', barcode: '724352775324', catalog: '7243 5 27753 2 4', label: 'Parlophone' };

test('a MusicBrainz release\'s Discogs link: the release over the master', () => {
  const rel = (url) => ({ type: 'discogs', url: { resource: url } });
  assert.deepStrictEqual(discogs.discogsLink({ relations: [rel('https://www.discogs.com/master/21491'), rel('https://www.discogs.com/release/1360906-Radiohead-Kid-A')] }), { kind: 'release', id: 1360906 });
  assert.deepStrictEqual(discogs.discogsLink({ relations: [rel('https://www.discogs.com/master/21491')] }), { kind: 'master', id: 21491 });
  assert.strictEqual(discogs.discogsLink({ relations: [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q1' } }] }), null);
  assert.strictEqual(discogs.discogsLink(null), null);
});

test('the search result that is this album: barcode, then catalogue number, then year and label', () => {
  const r = (id, extra) => ({ id, title: 'Radiohead - Kid A', year: '2000', label: ['Parlophone'], catno: '', barcode: [], ...extra });
  assert.strictEqual(discogs.pickRelease([r(1), r(2, { barcode: ['7 24352 77532 4'] })], album).id, 2);
  assert.strictEqual(discogs.pickRelease([r(1), r(2, { catno: '7243 5 27753 2 4' })], album).id, 2);
  assert.strictEqual(discogs.pickRelease([r(1, { year: '2009' }), r(2)], album).id, 2);
  assert.strictEqual(discogs.pickRelease([r(1), r(2)], album).id, 1); // a tie keeps Discogs' order
  assert.strictEqual(discogs.pickRelease([r(1, { title: 'Radiohead - OK Computer' })], album), null);
  assert.strictEqual(discogs.pickRelease([r(1, { title: 'Muse - Kid A' })], album), null);
  assert.strictEqual(discogs.pickRelease([r(1, { title: 'Nirvana (2) - Nevermind' })], { ...album, artist: 'Nirvana', title: 'Nevermind' }).id, 1);
  assert.strictEqual(discogs.pickRelease([r(1, { title: 'Various - Kid A' })], { ...album, artist: 'Various Artists' }).id, 1);
  assert.strictEqual(discogs.pickRelease([], album), null);
});

test('a release, summed up', () => {
  const info = discogs.summarize({
    id: 1360906, master_id: 21491, country: 'UK', year: 2000, uri: 'https://www.discogs.com/release/1360906',
    labels: [{ name: 'Parlophone (2)', catno: '7243 5 27753 2 4' }], identifiers: [{ type: 'Matrix', value: 'x' }, { type: 'Barcode', value: '724352775324' }],
    formats: [{ name: 'CD', descriptions: ['Album', 'Enhanced'] }], community: { have: 21304, want: 3112 },
  });
  assert.deepStrictEqual(info, { id: 1360906, masterId: 21491, label: 'Parlophone', catno: '7243 5 27753 2 4', country: 'UK', year: '2000', formats: 'CD, Album, Enhanced', barcode: '724352775324', have: 21304, want: 3112, uri: 'https://www.discogs.com/release/1360906' });
  assert.deepStrictEqual(discogs.summarize({ id: 5, labels: [{ name: 'Not On Label', catno: 'none' }] }), { id: 5, masterId: null, label: 'Not On Label', catno: null, country: null, year: null, formats: null, barcode: null, have: 0, want: 0, uri: 'https://www.discogs.com/release/5' });
});

test('what needs looking up again', () => {
  const now = 1000 * DAY;
  const fresh = { releaseId: 1, by: 'auto', checkedAt: now - DAY, pricedAt: now - DAY, price: { lowest: 12, currency: 'USD', forSale: 3 } };
  assert.strictEqual(discogs.staleness(undefined, now, 'USD'), 'all');
  assert.strictEqual(discogs.staleness(fresh, now, 'USD'), null);
  assert.strictEqual(discogs.staleness(fresh, now, 'EUR'), 'price');
  assert.strictEqual(discogs.staleness({ ...fresh, pricedAt: now - 31 * DAY }, now, 'USD'), 'price');
  assert.strictEqual(discogs.staleness({ ...fresh, checkedAt: now - 181 * DAY }, now, 'USD'), 'all');
  assert.strictEqual(discogs.staleness({ ...fresh, by: 'user', checkedAt: now - 181 * DAY }, now, 'USD'), 'all');
  assert.strictEqual(discogs.staleness({ releaseId: null, checkedAt: now - 3 * DAY }, now, 'USD'), null);
  assert.strictEqual(discogs.staleness({ releaseId: null, checkedAt: now - 8 * DAY }, now, 'USD'), 'all');
});
