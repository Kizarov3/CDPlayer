'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.CDPLAYER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-listens-'));
const listens = require('../src/main/listens');
const { yearOnShelf } = require('../src/main/year-shelf');
const { createAlbumStory } = require('../src/main/album-story');
const importPlays = require('../src/main/import-plays');
const store = require('../src/main/store');

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

test('the log reads back what it wrote, oldest first, with when it was begun', () => {
  const log = listens.empty(at(2026, 1, 1));
  listens.add(log, at(2026, 3, 1), '/m/b.mp3');
  const text = listens.format(log) + listens.lineOf([at(2026, 2, 1), '/m/a.mp3']);
  const back = listens.parse(text);
  assert.strictEqual(back.since, at(2026, 1, 1));
  assert.deepStrictEqual(back.list, [[at(2026, 2, 1), '/m/a.mp3'], [at(2026, 3, 1), '/m/b.mp3']]);
  assert.deepStrictEqual(listens.parse('junk\n0\tx\n').list, []);
});

test('begun from each song’s first and last play, a play once; merged twice, counted once', () => {
  const first = new Map([['/a', 100], ['/b', 300]]), last = new Map([['/a', 200], ['/b', 300]]);
  const log = listens.seed(first, last, 1000);
  assert.strictEqual(log.since, 1000);
  assert.deepStrictEqual(log.list, [[100, '/a'], [200, '/a'], [300, '/b']]);
  listens.merge(log, [[150, '/c'], [200, '/a'], [150, '/c'], [0, '/x'], [5, 'bad\npath']]);
  assert.deepStrictEqual(log.list, [[100, '/a'], [150, '/c'], [200, '/a'], [300, '/b']]);
});

test('the oldest go past the limit; moved songs keep their plays', () => {
  const log = listens.empty();
  for (let i = 1; i <= 10; i++) log.list.push([i, `/s${i}`]);
  listens.trim(log, 4);
  assert.deepStrictEqual(log.list.map((x) => x[0]), [7, 8, 9, 10]);
  listens.move(log, new Map([['/s8', '/new/s8']]));
  assert.strictEqual(log.list[1][1], '/new/s8');
  assert.strictEqual(listens.add(listens.empty(), 1, 'a\nb'), false);
});

test('ON THIS DAY: songs played on this date in a year before, the most recent year', () => {
  const log = listens.empty();
  log.list.push([at(2023, 10, 31), '/a'], [at(2025, 10, 31), '/a'], [at(2025, 10, 30), '/b'], [at(2026, 10, 31, 8), '/c']);
  const found = listens.onThisDay(log, at(2026, 10, 31, 20));
  assert.deepStrictEqual([...found], [['/a', 1]]);
});

const albums = [
  { id: 'A', title: 'Alpha', artist: 'Ann', year: '1999', added: at(2020, 1, 1), arrived: at(2020, 1, 1), tracks: [{ path: '/a1', duration: 600 }, { path: '/a2', duration: 600 }] },
  { id: 'B', title: 'Beta', artist: 'Bob', added: at(2026, 5, 1), arrived: at(2026, 5, 1), tracks: [{ path: '/b1', duration: 300 }] },
  { id: 'C', title: 'Gamma', artist: 'Cy', added: at(2026, 6, 1), arrived: at(2026, 6, 1), tracks: [{ path: '/c1', duration: 300 }] },
];

test('THE YEAR: hours, albums and artists played most, the busiest day, month by month — from the log', () => {
  const log = listens.empty(at(2026, 1, 1));
  log.list.push([at(2025, 12, 31), '/a1'], [at(2026, 2, 3), '/a1'], [at(2026, 2, 3, 14), '/a2'], [at(2026, 7, 1), '/b1'], [at(2026, 7, 2), '/gone']);
  const counts = new Map([['/a1', 5], ['/a2', 1], ['/b1', 1], ['/gone', 1]]);
  const through = { A: { n: 2, last: at(2026, 2, 3, 15) }, B: { n: 1, last: at(2025, 1, 1) } };
  const y = yearOnShelf({ log, albums, counts, through, year: 2026, now: at(2026, 10, 31) });
  assert.strictEqual(y.plays, 4);
  assert.strictEqual(y.minutes, 25); // 10 + 10 + 5 (the song that's gone: a play, no length known)
  assert.deepStrictEqual(y.albums.map((a) => [a.id, a.plays, a.minutes]), [['A', 2, 20], ['B', 1, 5]]);
  assert.strictEqual(y.albums[0].first, '/a1');
  assert.deepStrictEqual(y.artists.map((a) => a.name), ['Ann', 'Bob']);
  assert.deepStrictEqual(y.through.map((a) => a.id), ['A'], 'played through last in 2026');
  assert.deepStrictEqual(y.arrivals.map((a) => a.id), ['C'], 'came in this year, not played');
  assert.deepStrictEqual(y.busiest, { day: at(2026, 2, 3, 0), plays: 2, minutes: 20 });
  assert.strictEqual(y.strip.length, 12);
  assert.strictEqual(y.strip[1].minutes, 20);
  assert.deepStrictEqual(y.years, [2026, 2025]);
  assert.strictEqual(y.since, at(2026, 1, 1));
});

test('ALL TIME: every play counted, the days from the log, year by year', () => {
  const log = listens.empty(at(2026, 1, 1));
  log.list.push([at(2025, 12, 31), '/a1'], [at(2026, 7, 1), '/b1']);
  const counts = new Map([['/a1', 5], ['/b1', 1]]);
  const y = yearOnShelf({ log, albums, counts, through: { B: { n: 1, last: 1 } }, year: 'ALL', now: at(2026, 10, 31) });
  assert.strictEqual(y.plays, 6);
  assert.strictEqual(y.minutes, 55);
  assert.deepStrictEqual(y.strip, [{ year: 2025, minutes: 10 }, { year: 2026, minutes: 5 }]);
  assert.deepStrictEqual(y.through.map((a) => a.id), ['B']);
  assert.deepStrictEqual(y.arrivals.map((a) => a.id), ['C']);
});

test('the days albums came out, from the stories looked up before — in any language, only to the day', () => {
  const saved = JSON.stringify({ version: 2, entries: {
    'ru|n:radiohead|okcomputer': { fetched: 1, story: { released: '1997-05-21' } },
    'en|r:11111111-2222-3333-4444-555555555555': { fetched: 1, story: { released: '2000-10-02' } },
    'en|n:someone|yearonly': { fetched: 1, story: { released: '1990' } },
    'en|n:nobody|none': { fetched: 1, story: null },
  } });
  const story = createAlbumStory({ mbFetch: async () => ({}), fetchJson: async () => ({}), findGroup: async () => null, read: () => saved, write: () => {} });
  const of = story.releaseDates();
  assert.strictEqual(of({ artist: 'Radiohead', title: 'OK Computer' }), '1997-05-21');
  assert.strictEqual(of({ mbReleaseId: '11111111-2222-3333-4444-555555555555', artist: 'X', title: 'Y' }), '2000-10-02');
  assert.strictEqual(of({ artist: 'Someone', title: 'Year Only' }), null);
  assert.strictEqual(of({ artist: 'Nobody', title: 'None' }), null);
});

test('IMPORT PLAYS hands back each listen counted at its time, for the log', () => {
  const shelf = [{ id: 'A', title: 'Alpha', artist: 'Ann', tracks: [{ path: '/a1', title: 'Song', artist: 'Ann' }] }];
  const found = [{ source: 'lastfm', listens: [{ artist: 'Ann', title: 'Song', album: 'Alpha', at: at(2024, 3, 3) }, { artist: 'Zed', title: 'Other', album: null, at: at(2024, 3, 4) }] }];
  const done = importPlays.apply(found, shelf, { counts: new Map(), last: new Map(), first: new Map() });
  assert.deepStrictEqual(done.timed, [[at(2024, 3, 3), '/a1']]);
});

test('a line added to the end of a file in the data folder', () => {
  store.writeText('t-append.txt', 'a\n');
  store.appendText('t-append.txt', 'b\n');
  assert.strictEqual(store.readText('t-append.txt'), 'a\nb\n');
});
