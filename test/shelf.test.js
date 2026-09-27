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

test('one album whatever its punctuation, and a song without an album artist joins its album in the same folder', () => {
  const dir = "/m/Limp Bizkit/Three Dollar Bill Y'All$";
  const albums = groupAlbums([
    t(`${dir}/01 Intro.m4a`, { album: 'Three Dollar Bill, Yall$', artist: 'Limp Bizkit', albumArtist: 'Limp Bizkit', track: 1 }),
    t(`${dir}/02 Pollution.m4a`, { album: "Three Dollar Bill Y'All$", artist: 'Limp Bizkit', track: 2 }),
    t(`${dir}/03 Counterfeit.m4a`, { album: "THREE DOLLAR BILL Y'ALL$", artist: 'Limp Bizkit', track: 3 }),
  ]);
  assert.strictEqual(albums.length, 1);
  assert.deepStrictEqual(albums[0].tracks.map((x) => x.track), [1, 2, 3]);
  assert.strictEqual(albums[0].artist, 'Limp Bizkit');
});

test('different albums stay apart: another folder without album artists, or a name that differs in more than punctuation', () => {
  const albums = groupAlbums([
    t('/m/lb/tdb/01.m4a', { album: 'Three Dollar Bill, Yall$', artist: 'Limp Bizkit', albumArtist: 'Limp Bizkit' }),
    t('/m/other/01.m4a', { album: 'Three Dollar Bill Yall', artist: 'Cover Band' }),
    t('/m/lb/cs/01.m4a', { album: 'Chocolate Starfish', artist: 'Limp Bizkit' }),
  ]);
  assert.strictEqual(albums.length, 3);
});

// ---- Covers found online, for albums with no art of their own ------------------------------------------------------

const { onlineCover } = require('../src/main/shelf');
const counting = (answer) => { const f = async (q) => { f.calls.push(q); return typeof answer === 'function' ? answer(q) : answer; }; f.calls = []; return f; };

test('an album with no art of its own gets the cover found online, and it is remembered', async () => {
  const find = counting({ cover: 'data:image/jpeg;base64,AAAA', source: 'ITUNES' });
  const q = { artist: 'Radiohead', title: 'Airbag', album: 'OK Computer' };
  assert.strictEqual(await onlineCover(q, { find }), 'data:image/jpeg;base64,AAAA');
  assert.deepStrictEqual(find.calls, [q]);
  assert.strictEqual(await onlineCover({ ...q, title: 'Lucky' }, { find }), 'data:image/jpeg;base64,AAAA', 'same album: no second search');
  assert.strictEqual(find.calls.length, 1);
});

test('an album nobody has a cover for is not searched again for a week; a network failure is tried again', async () => {
  const q = { artist: 'Nobody', title: 'Demo', album: 'Basement Tapes' };
  const none = counting({ cover: null, source: null });
  assert.strictEqual(await onlineCover(q, { find: none, now: 1000 }), null);
  assert.strictEqual(await onlineCover(q, { find: none, now: 1000 + 86400e3 }), null);
  assert.strictEqual(none.calls.length, 1);
  await onlineCover(q, { find: none, now: 1000 + 8 * 86400e3 });
  assert.strictEqual(none.calls.length, 2, 'asked again after a week');

  const q2 = { artist: 'Offline', title: 'Song', album: 'Unplugged' };
  const down = counting({ cover: null, source: null, networkError: true });
  assert.strictEqual(await onlineCover(q2, { find: down }), null);
  await onlineCover(q2, { find: down });
  assert.strictEqual(down.calls.length, 2, 'a failed search is not remembered as "no cover"');
});

test('untagged music is never searched online', async () => {
  const find = counting({ cover: 'data:image/jpeg;base64,BBBB' });
  assert.strictEqual(await onlineCover({ artist: null, title: '01', album: null }, { find }), null);
  assert.strictEqual(find.calls.length, 0);
});

test('covers remembered by the old song-based search are not trusted', async () => {
  fs.writeFileSync(path.join(home, 'shelf-covers.json'), JSON.stringify({ 'limp bizkit\nthree dollar bill': { cover: 'data:image/jpeg;base64,WRONG' } }));
  delete require.cache[require.resolve('../src/main/shelf')];
  const fresh = require('../src/main/shelf');
  const find = counting({ cover: 'data:image/jpeg;base64,RIGHT' });
  assert.strictEqual(await fresh.onlineCover({ artist: 'Limp Bizkit', album: 'Three Dollar Bill' }, { find }), 'data:image/jpeg;base64,RIGHT');
  assert.strictEqual(find.calls.length, 1);
});
