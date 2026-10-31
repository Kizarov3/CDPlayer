'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-want-'));
process.env.CDPLAYER_HOME = home;
const want = require('../src/main/want-list');
const discogs = require('../src/main/discogs');
const backup = require('../src/main/backup');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const GROUP = '1b022e01-4da6-387b-8658-8678046e4cef';
const memory = () => { const files = {}; return { files, read: (f) => files[f] ?? null, write: (f, s) => { files[f] = s; return true; } }; };

test('a wanted album is known by its artist and its title without its edition\'s words', () => {
  assert.strictEqual(want.wantKey('Nirvana', 'Nevermind (Remastered)'), want.wantKey('NIRVANA', 'nevermind'));
  assert.strictEqual(want.wantKey('System of a Down', 'Toxicity - 2011 Remaster'), want.wantKey('System Of A Down', 'Toxicity'));
  assert.notStrictEqual(want.wantKey('Nirvana', 'Nevermind'), want.wantKey('Nirvana', 'In Utero'));
  assert.notStrictEqual(want.wantKey('Nirvana', 'Nevermind'), want.wantKey('Nirvana UK', 'Nevermind'));
});

test('cards go on once each, and come off', () => {
  let items = want.add([], { artist: 'Radiohead', title: 'Amnesiac', year: '2001', groupId: GROUP }, 5);
  items = want.add(items, { artist: 'radiohead', title: 'Amnesiac (Collector\'s Edition)' }, 6); // the same album
  assert.strictEqual(items.length, 1);
  assert.deepStrictEqual(items[0], { key: want.wantKey('Radiohead', 'Amnesiac'), artist: 'Radiohead', title: 'Amnesiac', year: '2001', groupId: GROUP, added: 5, found: null });
  assert.strictEqual(want.add(items, { artist: '', title: 'No artist' }), items); // not a card
  assert.strictEqual(want.add(items, null), items);
  assert.deepStrictEqual(want.remove(items, items[0].key), []);
});

test('want-list.json read back as written; a broken one is an empty list', () => {
  const items = want.add(want.add([], { artist: 'A', title: 'One', groupId: 'not-an-id', year: 'soon' }, 1), { artist: 'B', title: 'Two' }, 2);
  assert.deepStrictEqual(want.parse(want.serialize(items)), items);
  assert.strictEqual(want.parse(want.serialize(items))[0].groupId, null);
  assert.strictEqual(want.parse(want.serialize(items))[0].year, null);
  assert.deepStrictEqual(want.parse('{oops'), []);
  assert.deepStrictEqual(want.parse(JSON.stringify({ version: 2, items })), []);
  assert.deepStrictEqual(want.parse(null), []);
});

test('an album turning up crosses its card off, by that album; played, the card goes', () => {
  let items = want.add(want.add([], { artist: 'Radiohead', title: 'Amnesiac' }, 1), { artist: 'Björk', title: 'Homogenic' }, 2);
  const shelf = [{ id: 'x', artist: 'Radiohead', title: 'Amnesiac (2009 Remaster)' }, { id: 'y', artist: 'Portishead', title: 'Dummy' }];
  const r = want.crossOff(items, shelf, 100);
  assert.deepStrictEqual(r.found.map((x) => x.title), ['Amnesiac']);
  assert.deepStrictEqual(r.items[0].found, { id: 'x', at: 100 });
  assert.strictEqual(r.items[1].found, null);
  // Already crossed off: not found again.
  assert.deepStrictEqual(want.crossOff(r.items, shelf, 200).found, []);
  assert.strictEqual(want.crossOff(r.items, shelf, 200).items, r.items);
  assert.deepStrictEqual([...want.foundIds(r.items)], ['x']);
  items = want.played(r.items, 'y');
  assert.strictEqual(items.length, 2);
  items = want.played(items, 'x');
  assert.deepStrictEqual(items.map((x) => x.title), ['Homogenic']);
});

test('the list kept in its file: written only when it changes', () => {
  const m = memory();
  let t = 10;
  const list = want.createWantList({ read: m.read, write: m.write, now: () => t });
  assert.deepStrictEqual(list.list(), []);
  assert.strictEqual(list.waiting(), false);
  list.add({ artist: 'Radiohead', title: 'Amnesiac' });
  assert.strictEqual(list.waiting(), true);
  const written = m.files[want.FILE];
  list.add({ artist: 'Radiohead', title: 'Amnesiac' });
  list.remove('nothing\nlike it');
  list.played('nope');
  assert.strictEqual(m.files[want.FILE], written);
  t = 20;
  const found = list.crossOff([{ id: 'x', artist: 'Radiohead', title: 'Amnesiac' }]);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(list.waiting(), false);
  const again = want.createWantList({ read: m.read, write: m.write });
  assert.deepStrictEqual(again.list()[0].found, { id: 'x', at: 20 });
  assert.deepStrictEqual([...again.foundIds()], ['x']);
  again.played('x');
  assert.deepStrictEqual(want.parse(m.files[want.FILE]), []);
});

test('the want list is in the backup', () => {
  assert.ok(backup.FILES.includes(want.FILE));
  fs.writeFileSync(path.join(home, want.FILE), want.serialize(want.add([], { artist: 'A', title: 'B' }, 1)));
  const made = backup.read(backup.make(home));
  assert.ok(made.files[want.FILE]);
});

test('a want list price is asked again after a week, a shelf album\'s after a month', () => {
  const DAY = 86400e3, now = 100 * DAY;
  const entry = { releaseId: 1, checkedAt: now - 10 * DAY, price: { lowest: 5, currency: 'USD' }, pricedAt: now - 8 * DAY };
  assert.strictEqual(discogs.staleness(entry, now, 'USD'), null);
  assert.strictEqual(discogs.staleness(entry, now, 'USD', 7), 'price');
  assert.strictEqual(discogs.staleness({ ...entry, pricedAt: now - 3 * DAY }, now, 'USD', 7), null);
});

test('the want list\'s Discogs entries are never among the shelf\'s albums not found', () => {
  const files = { 'discogs.json': JSON.stringify({ version: 1, albums: { 'want:a\nb': { releaseId: null, checkedAt: 1, title: 'B', artist: 'A' }, shelf1: { releaseId: null, checkedAt: 1, title: 'C', artist: 'D' } } }) };
  const d = discogs.createDiscogs({ fetchJson: async () => ({}), mbFetch: async () => null, read: (f) => files[f] ?? null, write: () => true });
  assert.deepStrictEqual(d.notFound().map((x) => x.id), ['shelf1']);
});
