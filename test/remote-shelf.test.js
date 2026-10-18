'use strict';
// The shelf as the phone sees it: names and numbers, never a file path.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { albumKey, phoneAlbums, phoneAlbum, byKey } = require('../src/main/remote-shelf');

const album = (id, over) => ({
  id, title: 'Album', artist: 'Artist', year: '1999', folder: `/music/${id}`, note: 'private note',
  added: 1700000000000, plays: 3, touched: 1710000000000, wrapped: false,
  tracks: [
    { path: `/music/${id}/01.flac`, title: 'One', artist: 'Artist', duration: 61, track: 1, disc: 1 },
    { path: `/music/${id}/02.flac`, title: 'Two', artist: 'Artist', duration: 62, track: 2, disc: 1 },
  ],
  ...over,
});

test('no path separator or folder reaches the phone', () => {
  const fixture = [album('C:\\Music\\A'), album('/music/B')];
  const json = JSON.stringify(phoneAlbums(fixture, {})) + JSON.stringify(fixture.map(phoneAlbum));
  assert.ok(!/[/\\]/.test(json), json);
  assert.ok(!json.includes('private note'));
});

test('keys are stable, 16 hex characters, and differ for same-titled albums in different folders', () => {
  const a = album('/m/x/Greatest Hits'), b = album('/m/y/Greatest Hits');
  const [pa, pb] = phoneAlbums([a, b], {});
  assert.match(pa.id, /^[0-9a-f]{16}$/);
  assert.strictEqual(pa.id, phoneAlbums([a], {})[0].id);
  assert.strictEqual(pa.id, albumKey(a.id));
  assert.notStrictEqual(pa.id, pb.id);
});

test('the listing carries counts and times, and the spine colour when the cache has one', () => {
  const a = album('/m/a'), b = album('/m/b');
  const [pa, pb] = phoneAlbums([a, b], { '/m/a': { spine: [1, 2, 3], main: [9, 9, 9] } });
  assert.deepStrictEqual(pa, { id: albumKey('/m/a'), title: 'Album', artist: 'Artist', year: '1999', n: 2, added: 1700000000000, plays: 3, touched: 1710000000000, wrapped: false, color: [1, 2, 3] });
  assert.strictEqual(pb.color, null);
  assert.strictEqual(phoneAlbums([a], null)[0].color, null);
});

test('one album for the phone: titles, durations, disc and track, no paths', () => {
  assert.deepStrictEqual(phoneAlbum(album('/m/a')), {
    id: albumKey('/m/a'), title: 'Album', artist: 'Artist', year: '1999',
    tracks: [{ title: 'One', duration: 61, disc: 1, track: 1 }, { title: 'Two', duration: 62, disc: 1, track: 2 }],
  });
});

test('byKey finds the album (and its paths) from a phone key', () => {
  const a = album('/m/a'), b = album('/m/b');
  const map = byKey([a, b]);
  assert.strictEqual(map.get(albumKey('/m/b')), b);
  assert.strictEqual(map.get('0000000000000000'), undefined);
});

test('3 000 albums gzip under 120 KB', () => {
  const many = Array.from({ length: 3000 }, (_, i) => album(`/music/Artist ${i % 400}/Album number ${i}`, {
    title: `Album number ${i}`, artist: `Artist ${i % 400}`, year: String(1960 + (i % 60)), plays: i % 17, added: 1700000000000 + i * 86400000, touched: 1700000000000 + i * 3600000,
  }));
  const colors = {};
  many.forEach((a, i) => { colors[a.id] = { spine: [(i * 7) % 256, (i * 13) % 256, (i * 29) % 256] }; });
  const size = zlib.gzipSync(JSON.stringify(phoneAlbums(many, colors))).length;
  assert.ok(size < 120 * 1024, `${size} bytes`);
});
