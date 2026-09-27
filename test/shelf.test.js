'use strict';
// Grouping tracks into the albums on the shelf (no files or network).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const { groupAlbums } = require('../src/main/shelf');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const t = (p, info) => ({ path: p, info: { title: path.basename(p), artist: null, album: null, albumArtist: null, year: null, track: null, disc: 1, duration: 60, ...info } });

test('tracks of one album, in disc and track order, across CD1/CD2 folders', () => {
  const albums = groupAlbums([
    t('/m/Korn/FtL/CD2/01.flac', { album: 'Follow the Leader', artist: 'Korn', albumArtist: 'Korn', disc: 2, track: 1, year: '1998' }),
    t('/m/Korn/FtL/CD1/02.flac', { album: 'Follow the Leader', artist: 'Korn', albumArtist: 'Korn', disc: 1, track: 2, year: '1998' }),
    t('/m/Korn/FtL/CD1/01.flac', { album: 'Follow the Leader', artist: 'Korn', albumArtist: 'Korn', disc: 1, track: 1, year: '1998-08-18' }),
  ]);
  assert.strictEqual(albums.length, 1);
  const [a] = albums;
  assert.deepStrictEqual(a.tracks.map((x) => x.path), ['/m/Korn/FtL/CD1/01.flac', '/m/Korn/FtL/CD1/02.flac', '/m/Korn/FtL/CD2/01.flac']);
  assert.strictEqual(a.discs, 2);
  assert.strictEqual(a.artist, 'Korn');
  assert.strictEqual(a.folder, '/m/Korn/FtL');
  assert.strictEqual(a.duration, 180);
});

test('same album name by different artists in different folders stays apart; a compilation stays together', () => {
  const albums = groupAlbums([
    t('/m/a/1.mp3', { album: 'Greatest Hits', artist: 'Queen' }),
    t('/m/b/1.mp3', { album: 'Greatest Hits', artist: 'ABBA' }),
    t('/m/now/1.mp3', { album: 'Now 50', artist: 'Someone' }),
    t('/m/now/2.mp3', { album: 'Now 50', artist: 'Someone Else' }),
  ]);
  assert.deepStrictEqual(albums.map((a) => `${a.artist} — ${a.title} (${a.tracks.length})`), [
    'ABBA — Greatest Hits (1)', 'Queen — Greatest Hits (1)', 'Various Artists — Now 50 (2)',
  ]);
});

test('untagged music is shelved by folder; sorting ignores a leading "The"', () => {
  const albums = groupAlbums([
    t('/m/Tapes/Summer Mix/b.mp3', {}), t('/m/Tapes/Summer Mix/a.mp3', {}),
    t('/m/x/1.mp3', { album: 'Abbey Road', artist: 'The Beatles', year: '1969' }),
    t('/m/y/1.mp3', { album: 'Blue', artist: 'Joni Mitchell', year: '1971' }),
  ]);
  assert.deepStrictEqual(albums.map((a) => a.title), ['Abbey Road', 'Blue', 'Summer Mix']);
  assert.deepStrictEqual(albums[2].tracks.map((x) => path.basename(x.path)), ['a.mp3', 'b.mp3']);
  assert.strictEqual(albums[2].artist, null);
});
