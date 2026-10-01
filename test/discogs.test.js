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

test('a tie: the pressing most people have — the likeliest to be yours', () => {
  const r = (id, have) => ({ id, title: 'Radiohead - Kid A', year: '2000', community: { have } });
  assert.strictEqual(discogs.pickRelease([r(1, 502), r(2, 9000), r(3, 40)], album).id, 2);
  assert.strictEqual(discogs.pickRelease([r(1, 502), { ...r(2, 9000), year: '2009' }], album).id, 1); // the year still counts first
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

// A fake Discogs and MusicBrainz, a clock that sleep() moves on, and storage in memory.
function rig({ routes = {}, mb = {}, files = {} } = {}) {
  const clock = { now: 1000 * DAY }, calls = [], stored = { ...files };
  const fetchJson = async (url, init = {}) => {
    calls.push({ url: url.replace('https://api.discogs.com/', ''), at: clock.now, auth: (init.headers || {}).Authorization || null });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const answer = key ? routes[key] : { status: 404 };
    const value = typeof answer === 'function' ? answer(url) : answer;
    if (value && value.status) { const e = new Error(`HTTP ${value.status}`); e.status = value.status; throw e; }
    if (value instanceof Error) throw value;
    return value;
  };
  const engine = discogs.createDiscogs({
    fetchJson, mbFetch: async (q) => { if (!(q.split('?')[0] in mb)) throw new Error('404'); return mb[q.split('?')[0]]; },
    read: (f) => stored[f] ?? null, write: (f, text) => { stored[f] = text; return true; },
    now: () => clock.now, sleep: async (ms) => { clock.now += ms; }, userAgent: 'test',
  });
  return { engine, calls, clock, stored };
}
const release = (id, extra = {}) => ({ id, master_id: 21491, country: 'UK', year: 2000, labels: [{ name: 'Parlophone', catno: 'X1' }], formats: [{ name: 'CD' }], community: { have: 50, want: 10 }, ...extra });
const stats = (value, n = 3) => ({ num_for_sale: n, lowest_price: value === null ? null : { value, currency: 'USD' } });
const found = (...results) => ({ results });

test('found by the MusicBrainz release in the tags, then priced', async () => {
  const { engine, calls } = rig({
    mb: { 'release/f9e0e4e5-1d7e-4e8d-9a46-3f1d2e6f6b1d': { relations: [{ url: { resource: 'https://www.discogs.com/release/77' } }] } },
    routes: { 'releases/77': release(77), 'marketplace/stats/77': stats(12.5) },
  });
  const entry = await engine.lookup({ ...album, mbReleaseId: 'f9e0e4e5-1d7e-4e8d-9a46-3f1d2e6f6b1d' });
  assert.strictEqual(entry.releaseId, 77);
  assert.deepStrictEqual(entry.price, { lowest: 12.5, currency: 'USD', forSale: 3 });
  assert.deepStrictEqual(calls.map((c) => c.url.split('?')[0]), ['releases/77', 'marketplace/stats/77']);
});

test('a MusicBrainz link to a master: its main release', async () => {
  const { engine } = rig({
    mb: { 'release/f9e0e4e5-1d7e-4e8d-9a46-3f1d2e6f6b1d': { relations: [{ url: { resource: 'https://www.discogs.com/master/21491' } }] } },
    routes: { 'masters/21491': { main_release: 88 }, 'releases/88': release(88), 'marketplace/stats/88': stats(5) },
  });
  assert.strictEqual((await engine.lookup({ ...album, mbReleaseId: 'f9e0e4e5-1d7e-4e8d-9a46-3f1d2e6f6b1d' })).releaseId, 88);
});

test('no MusicBrainz ID: the barcode first, then artist and title', async () => {
  const hit = { id: 5, title: 'Radiohead - Kid A', year: '2000', label: ['Parlophone'], catno: '', barcode: [] };
  const a = rig({ routes: { 'barcode=724352775324': found(hit), 'releases/5': release(5), 'marketplace/stats/5': stats(9) } });
  assert.strictEqual((await a.engine.lookup(album)).releaseId, 5);
  assert.match(a.calls[0].url, /database\/search\?barcode=724352775324/);
  const b = rig({ routes: { 'barcode=': found(), 'release_title=Kid%20A': found(hit), 'releases/5': release(5), 'marketplace/stats/5': stats(9) } });
  assert.strictEqual((await b.engine.lookup(album)).releaseId, 5);
  assert.match(b.calls[1].url, /artist=Radiohead&release_title=Kid%20A&format=CD&type=release/);
});

test('not on Discogs: kept a week, then asked again', async () => {
  const { engine, calls, clock } = rig({ routes: { 'database/search': found() } });
  const first = await engine.lookup({ ...album, barcode: null });
  assert.strictEqual(first.releaseId, null);
  await engine.lookup({ ...album, barcode: null });
  assert.strictEqual(calls.length, 1);
  clock.now += 8 * DAY;
  await engine.lookup({ ...album, barcode: null });
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(engine.notFound(), [{ id: album.id, title: 'Kid A', artist: 'Radiohead' }]);
});

test('requests wait their turn: 2.5 s apart, 1.1 s with a token', async () => {
  const hit = { id: 5, title: 'Radiohead - Kid A' };
  const routes = { 'database/search': found(hit), 'releases/5': release(5), 'marketplace/stats/5': stats(9), 'oauth/identity': { username: 'me' } };
  const a = rig({ routes });
  await a.engine.lookup({ ...album, barcode: null });
  assert.deepStrictEqual(a.calls.slice(1).map((c, i) => c.at - a.calls[i].at), [2500, 2500]);
  const b = rig({ routes });
  assert.deepStrictEqual(await b.engine.setToken('abc'), { ok: true, username: 'me' });
  await b.engine.lookup({ ...album, barcode: null });
  const timed = b.calls.slice(1);
  assert.deepStrictEqual(timed.slice(1).map((c, i) => c.at - timed[i].at), [1100, 1100]);
  assert.ok(timed.every((c) => c.auth === 'Discogs token=abc'));
});

test('too many requests: a minute\'s wait, then on', async () => {
  let n = 0;
  const { engine, calls } = rig({ routes: { 'releases/5': () => (n++ ? release(5) : { status: 429 }), 'marketplace/stats/5': stats(9) } });
  const entry = await engine.choose(album, 5);
  assert.strictEqual(entry.releaseId, 5);
  assert.ok(calls[1].at - calls[0].at >= 60000);
});

test('a token that stops working is dropped, and requests go on without it', async () => {
  let n = 0;
  const { engine, calls } = rig({ routes: { 'oauth/identity': { username: 'me' }, 'releases/5': () => (n++ ? release(5) : { status: 401 }), 'marketplace/stats/5': stats(9) } });
  await engine.setToken('abc');
  await engine.choose(album, 5);
  assert.strictEqual(engine.settings().token, false);
  assert.strictEqual(engine.settings().tokenDropped, true);
  assert.strictEqual(calls[calls.length - 1].auth, null);
});

test('a token Discogs refuses is not kept', async () => {
  const { engine } = rig({ routes: { 'oauth/identity': { status: 401 } } });
  assert.deepStrictEqual(await engine.setToken('bad'), { error: 'BAD_TOKEN' });
  assert.strictEqual(engine.settings().token, false);
});

test('a pressing chosen by hand stays chosen; only its price is refreshed', async () => {
  const { engine, calls, clock } = rig({ routes: { 'releases/9': release(9), 'marketplace/stats/9': stats(30), 'database/search': found({ id: 5, title: 'Radiohead - Kid A' }) } });
  await engine.choose(album, 9);
  clock.now += 40 * DAY;
  const again = await engine.lookup(album);
  assert.strictEqual(again.releaseId, 9);
  assert.strictEqual(again.by, 'user');
  assert.ok(!calls.some((c) => c.url.startsWith('database/search')));
});

test('a new currency: prices asked again in it', async () => {
  const { engine, calls } = rig({ routes: { 'releases/9': release(9), 'marketplace/stats/9': (url) => ({ num_for_sale: 1, lowest_price: { value: 10, currency: /EUR/.test(url) ? 'EUR' : 'USD' } }) } });
  await engine.choose(album, 9);
  assert.strictEqual(engine.setCurrency('EUR'), true);
  assert.strictEqual(engine.setCurrency('RUB'), false);
  const entry = await engine.lookup(album);
  assert.strictEqual(entry.price.currency, 'EUR');
  assert.match(calls[calls.length - 1].url, /curr_abbr=EUR/);
});

test('two lookups of one album at once make one set of requests', async () => {
  const { engine, calls } = rig({ routes: { 'releases/9': release(9), 'marketplace/stats/9': stats(3) } });
  await engine.choose(album, 9);
  engine.setCurrency('GBP');
  const [a, b] = await Promise.all([engine.lookup(album), engine.lookup(album)]);
  assert.strictEqual(a, b);
  assert.strictEqual(calls.filter((c) => /curr_abbr=GBP/.test(c.url)).length, 1);
});

test('appraising: every album in turn, the fresh ones skipped, stoppable, and stopped by a lost connection', async () => {
  const albums = [1, 2, 3].map((i) => ({ id: `a${i}`, artist: 'Radiohead', title: `T${i}` }));
  const routes = { 'release_title=T1': found({ id: 1, title: 'Radiohead - T1' }), 'release_title=T2': found({ id: 2, title: 'Radiohead - T2' }), 'release_title=T3': found({ id: 3, title: 'Radiohead - T3' }),
    'releases/': (url) => release(Number(/releases\/(\d+)/.exec(url)[1])), 'marketplace/stats/': stats(4) };
  const { engine } = rig({ routes });
  await engine.lookup(albums[0]);
  const seen = [];
  assert.deepStrictEqual(await engine.appraise(albums, (p) => seen.push([p.done, p.albumId])), { done: 3, total: 3 });
  assert.deepStrictEqual(seen, [[1, 'a1'], [2, 'a2'], [3, 'a3']]);
  const more = [4, 5].map((i) => ({ id: `b${i}`, artist: 'Radiohead', title: `T${i}` }));
  const r2 = rig({ routes: { ...routes, 'release_title=T4': found({ id: 4, title: 'Radiohead - T4' }) } });
  const run = r2.engine.appraise(more, () => r2.engine.stopAppraise());
  assert.strictEqual((await run).stopped, true);
  const r3 = rig({ routes: { 'database/search': new TypeError('fetch failed') } });
  const out = await r3.engine.appraise(more, () => {});
  assert.deepStrictEqual(out, { error: 'OFFLINE', done: 0, total: 2 });
});

test('a master\'s CD pressings, and a search to choose from', async () => {
  const { engine } = rig({ routes: {
    'masters/21491/versions': { versions: [{ id: 1, label: 'Parlophone', catno: 'X1', country: 'UK', released: '2000', title: 'Kid A', format: 'CD, Album' }] },
    'database/search': found({ id: 2, title: 'Radiohead - Kid A', label: ['EMI'], catno: 'Y2', country: 'Japan', year: '2000' }),
  } });
  assert.deepStrictEqual(await engine.versions(21491), [{ id: 1, label: 'Parlophone', catno: 'X1', country: 'UK', year: '2000', format: 'CD, Album' }]);
  assert.deepStrictEqual(await engine.search(album), [{ id: 2, title: 'Radiohead - Kid A', label: 'EMI', catno: 'Y2', country: 'Japan', year: '2000' }]);
});

test('pressings to choose from read cleanly: no "(2)" after a label, no "none" for a catalogue number', async () => {
  const { engine } = rig({ routes: { 'masters/7/versions': { versions: [{ id: 3, label: 'Parlophone (2)', catno: 'none', country: 'Russia', released: '1997', format: 'CD, Album, Unofficial Release' }] } } });
  assert.deepStrictEqual(await engine.versions(7), [{ id: 3, label: 'Parlophone', catno: null, country: 'Russia', year: '1997', format: 'CD, Album, Unofficial Release' }]);
});

test('what\'s kept survives a restart', async () => {
  const first = rig({ routes: { 'releases/9': release(9), 'marketplace/stats/9': stats(7) } });
  await first.engine.choose(album, 9);
  const again = rig({ files: first.stored });
  assert.strictEqual(again.engine.known([album.id, 'nope'])[album.id].price.lowest, 7);
  assert.deepStrictEqual(Object.keys(again.engine.known([album.id, 'nope'])), [album.id]);
});
