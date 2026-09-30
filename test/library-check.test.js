'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { libraryIssues } = require('../src/main/library-check');

const t = (path, info) => ({ path, info: { title: 'Song', artist: 'Artist', album: 'Album', albumArtist: null, year: '2000', track: 1, disc: 1, duration: 200, ...info } });

test('a song with no artist or album has no tags', () => {
  const r = libraryIssues([t('/a.mp3', { artist: null }), t('/b.mp3', { album: null }), t('/ok.mp3', {})]);
  assert.deepStrictEqual(r.untagged, ['/a.mp3', '/b.mp3']);
});

test('the same song in two files is a duplicate — not two songs that only share a title', () => {
  const r = libraryIssues([
    t('/m/Creep.mp3', { title: 'Creep', artist: 'Radiohead', duration: 238 }),
    t('/m/Creep.flac', { title: 'creep', artist: 'radiohead', duration: 239 }),
    t('/m/Creep (Stone Temple).mp3', { title: 'Creep', artist: 'Stone Temple Pilots', duration: 333 }),
    t('/m/Creep live.mp3', { title: 'Creep', artist: 'Radiohead', duration: 290 }),
  ]);
  assert.deepStrictEqual(r.duplicates, [['/m/Creep.mp3', '/m/Creep.flac']]);
});

test('an album missing track numbers, each disc on its own', () => {
  const song = (n, disc = 1) => t(`/m/A/${disc}-${n}.flac`, { album: 'Double', albumArtist: 'X', track: n, disc });
  const r = libraryIssues([song(1), song(2), song(4), song(1, 2), song(2, 2), song(3, 2), t('/m/B/1.mp3', { album: 'Whole', track: 1 }), t('/m/B/2.mp3', { album: 'Whole', track: 2 })]);
  assert.deepStrictEqual(r.gaps, [{ album: 'Double', artist: 'X', disc: 1, missing: [3], folder: '/m/A' }]);
});

test('a file that couldn\'t be read, or has no sound, is unreadable — not merely untagged', () => {
  const r = libraryIssues([t('/broken.mp3', { artist: null, album: null, duration: 0 })]);
  assert.deepStrictEqual(r.unreadable, ['/broken.mp3']);
  assert.deepStrictEqual(r.untagged, []);
});

test('nothing wrong, nothing listed', () => {
  assert.deepStrictEqual(libraryIssues([t('/ok.mp3', {})]), { untagged: [], duplicates: [], gaps: [], unreadable: [] });
});

test('an album you only have a few songs of isn\'t "missing" tracks — only one that lost one or two', () => {
  const song = (album, n) => t(`/m/${album}/${n}.flac`, { album, track: n });
  const few = [song('Toxicity', 6), song('Toxicity', 14)]; // two songs of fourteen: on purpose
  const lost = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12].map((n) => song('The Bends', n)); // 9 went missing
  const r = libraryIssues([...few, ...lost]);
  assert.deepStrictEqual(r.gaps.map((g) => [g.album, g.missing]), [['The Bends', [9]]]);
});
