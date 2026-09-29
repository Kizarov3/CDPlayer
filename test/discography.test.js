'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const { createDiscography, artistKey } = require('../src/main/discography');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const DAY = 86400e3;
// A real-shaped MusicBrainz ID made of one hex digit: U('a') = 'aaaaaaaa-aaaa-…'.
const U = (c) => `${c.repeat(8)}-${c.repeat(4)}-${c.repeat(4)}-${c.repeat(4)}-${c.repeat(12)}`;
const group = (id, title, extra = {}) => ({ id, title, 'primary-type': 'Album', 'secondary-types': [], 'first-release-date': '1997-05-21', ...extra });
// MusicBrainz answered per request: [regex, json | Error] pairs; every request is recorded.
function mb(routes) {
  const asked = [];
  const fetch = async (q) => {
    asked.push(q);
    const route = routes.find(([re]) => re.test(q));
    if (!route) throw new Error(`unexpected ${q}`);
    if (route[1] instanceof Error) throw route[1];
    return typeof route[1] === 'function' ? route[1](q) : route[1];
  };
  return { fetch, asked };
}
function make(routes, { cache = '', now = 1000 * DAY } = {}) {
  const net = mb(routes);
  let saved = cache;
  const answers = [];
  const d = createDiscography({ mbFetch: net.fetch, read: () => saved, write: (t) => { saved = t; }, now: () => now, onAnswer: (a) => answers.push(a) });
  return { d, net, answers, saved: () => saved };
}

test('by the MusicBrainz ID from the tags: no search, every official album', async () => {
  const { d, net } = make([[/^release-group\?artist=aaaa/, { 'release-group-count': 2, 'release-groups': [group('rg1', 'OK Computer'), group('rg2', 'Creep', { 'primary-type': 'Single', 'first-release-date': '' })] }]]);
  const r = await d.discographyFor({ artist: 'Radiohead', mbid: U('a') });
  assert.strictEqual(r.state, 'found');
  assert.deepStrictEqual(r.groups, [
    { id: 'rg1', title: 'OK Computer', type: 'Album', secondary: [], year: '1997' },
    { id: 'rg2', title: 'Creep', type: 'Single', secondary: [], year: null },
  ]);
  assert.strictEqual(net.asked.length, 1);
  assert.match(net.asked[0], /release-group-status=website-default/);
  assert.match(net.asked[0], /&type=album&/, 'albums only: fewer pages to read');
});

test('by name: the result whose name, or one of its aliases, is the same', async () => {
  const { d } = make([
    [/^artist\?query=/, { artists: [{ id: 'dj', name: 'DJ Radiohead' }, { id: 'b1', name: 'Bjork Tribute' }, { id: 'bj', name: 'Björk Guðmundsdóttir', aliases: [{ name: 'Björk' }] }] }],
    [/^release-group\?artist=bj/, { 'release-group-count': 1, 'release-groups': [group('h', 'Homogenic')] }],
  ]);
  const r = await d.discographyFor({ artist: 'björk', mbid: null });
  assert.deepStrictEqual(r.groups.map((g) => g.id), ['h']);
});

test('nobody by that name: unknown, and asked again only after a week', async () => {
  const { d, net } = make([[/^artist\?query=/, { artists: [{ id: 'x', name: 'Someone Else' }] }]]);
  assert.deepStrictEqual(await d.discographyFor({ artist: 'Nova Drift', mbid: null }), { state: 'unknown', groups: [] });
  await d.discographyFor({ artist: 'Nova Drift', mbid: null });
  assert.strictEqual(net.asked.length, 1);
  const cached = make([[/^artist\?query=/, { artists: [] }]], { cache: JSON.stringify({ version: 1, artists: { [artistKey('Nova Drift')]: { mbid: null, fetched: 1000 * DAY - 8 * DAY, state: 'unknown', groups: [] } } }) });
  await cached.d.discographyFor({ artist: 'Nova Drift', mbid: null });
  assert.strictEqual(cached.net.asked.length, 1, 'more than a week old: asked again');
});

test('a found discography is kept 30 days', async () => {
  const entry = (age) => JSON.stringify({ version: 1, artists: { [artistKey('Tool')]: { mbid: U('e'), fetched: 1000 * DAY - age * DAY, state: 'found', groups: [{ id: 'l', title: 'Lateralus', type: 'Album', secondary: [], year: '2001' }] } } });
  const fresh = make([], { cache: entry(29) });
  assert.strictEqual((await fresh.d.discographyFor({ artist: 'Tool', mbid: U('e') })).groups[0].id, 'l');
  const stale = make([[/^release-group\?artist=eeee/, { 'release-group-count': 0, 'release-groups': [] }]], { cache: entry(31) });
  assert.deepStrictEqual((await stale.d.discographyFor({ artist: 'Tool', mbid: U('e') })).groups, []);
  assert.strictEqual(stale.net.asked.length, 1);
});

test('every page is read, and a short page ends it even if the count says more', async () => {
  const many = Array.from({ length: 250 }, (_, i) => group(`g${i}`, `Single ${i}`, { 'primary-type': 'Single' }));
  const { d, net } = make([[/^release-group\?artist=aaaa/, (q) => {
    const offset = Number(/offset=(\d+)/.exec(q)[1]);
    return { 'release-group-count': 400, 'release-groups': many.slice(offset, offset + 100) };
  }]]);
  const r = await d.discographyFor({ artist: 'A', mbid: U('a') });
  assert.strictEqual(r.groups.length, 250);
  assert.deepStrictEqual(net.asked.map((q) => /offset=(\d+)/.exec(q)[1]), ['0', '100', '200']);
});

test('a full page means there may be more, whatever the count says', async () => {
  const many = Array.from({ length: 150 }, (_, i) => group(`g${i}`, `Album ${i}`));
  const { d, net } = make([[/^release-group\?artist=aaaa/, (q) => {
    const offset = Number(/offset=(\d+)/.exec(q)[1]);
    return { 'release-group-count': 100, 'release-groups': many.slice(offset, offset + 100) }; // the count is off
  }]]);
  assert.strictEqual((await d.discographyFor({ artist: 'A', mbid: U('a') })).groups.length, 150);
  assert.strictEqual(net.asked.length, 2);
});

test('offline: nothing cached, so it is asked again next time', async () => {
  const { d, saved } = make([[/^artist\?query=/, new Error('ENOTFOUND')]]);
  await assert.rejects(d.discographyFor({ artist: 'Korn', mbid: null }));
  assert.strictEqual(saved(), '');
});

test('the queue: one at a time, answers told; an artist scrolled away before its turn is dropped', async () => {
  const { d, net, answers } = make([[/^release-group\?artist=/, { 'release-group-count': 0, 'release-groups': [] }]]);
  d.want([{ artist: 'A', mbid: U('a') }, { artist: 'B', mbid: U('b') }, { artist: 'C', mbid: U('c') }]);
  d.want([{ artist: 'A', mbid: U('a') }, { artist: 'D', mbid: U('d') }]); // B and C went off screen
  await new Promise((r) => setTimeout(r, 20));
  assert.deepStrictEqual(net.asked.map((q) => /artist=(\w)/.exec(q)[1]), ['a', 'd']);
  assert.deepStrictEqual(answers.map((a) => a.key), [artistKey('A'), artistKey('D')]);
});

test('a release group\'s editions, each a tracklist, from up to five official releases', async () => {
  const { d, net } = make([[/^release\?release-group=rg1/, { releases: [
    { media: [{ tracks: [{ title: 'Airbag', length: 284400 }] }, { tracks: [{ title: 'Lucky', length: null }] }] },
    { media: [{ tracks: [{ title: 'Airbag', length: 284400 }] }] },
  ] }]]);
  assert.deepStrictEqual(await d.tracklist('rg1'), [
    [{ title: 'Airbag', length: 284.4 }, { title: 'Lucky', length: 0 }],
    [{ title: 'Airbag', length: 284.4 }],
  ]);
  await d.tracklist('rg1');
  assert.strictEqual(net.asked.length, 1, 'kept for the session');
  assert.match(net.asked[0], /status=official&inc=recordings&limit=5/);
});

test('the search looks at aliases too, so "Kino" finds Кино and not only bands named Kino', async () => {
  const { d, net } = make([
    [/^artist\?query=/, { artists: [{ id: 'kino', name: 'Кино', aliases: [{ name: 'Kino' }] }] }],
    [/^release-group\?artist=kino/, { 'release-group-count': 0, 'release-groups': [] }],
  ]);
  await d.discographyFor({ artist: 'Kino', mbid: null });
  assert.match(decodeURIComponent(net.asked[0]), /artist:"Kino" OR alias:"Kino"/);
});

test('an MBID tag that isn\'t one ID (a collaboration\'s "id1, id2", or junk): the first real ID, or else the name', async () => {
  const id1 = 'a74b1b7f-71a5-4011-9441-d0b5e4122711', id2 = '8bfac288-ccc5-448d-9573-c33ea2aa5c30';
  const { d, net } = make([
    [/^release-group\?artist=/, { 'release-group-count': 0, 'release-groups': [] }],
    [/^artist\?query=/, { artists: [{ id: 'found', name: 'Nova Drift' }] }],
  ]);
  await d.discographyFor({ artist: 'Radiohead', mbid: `${id1}, ${id2}` });
  assert.match(net.asked[0], new RegExp(`^release-group\\?artist=${id1}&`));
  await d.discographyFor({ artist: 'Nova Drift', mbid: 'not an id&x=1' });
  assert.match(net.asked[1], /^artist\?query=/);
  assert.match(net.asked[2], /^release-group\?artist=found&/);
});
