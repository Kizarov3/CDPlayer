'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { findMoves, movesOf, movePlays, newestFirst, moveHistory, moveAlbumId, prefixOf } = require('../src/main/relocate');

test('a music folder moved to another drive: each song found, in one group', () => {
  const found = findMoves(
    ['/Volumes/Old/Music/Radiohead/OK Computer/01 Airbag.flac', '/Volumes/Old/Music/Radiohead/OK Computer/02 Paranoid Android.flac'],
    ['/Users/me/Music/Radiohead/OK Computer/01 Airbag.flac', '/Users/me/Music/Radiohead/OK Computer/02 Paranoid Android.flac', '/Users/me/Music/Björk/Post/01 Army of Me.flac'],
  );
  assert.strictEqual(found.moves.get('/Volumes/Old/Music/Radiohead/OK Computer/01 Airbag.flac'), '/Users/me/Music/Radiohead/OK Computer/01 Airbag.flac');
  assert.deepStrictEqual(found.groups.map(({ from, to, count }) => ({ from, to, count })), [{ from: '/Volumes/Old', to: '/Users/me', count: 2 }]);
});

test('a song that could be either of two on the shelf is left where it was', () => {
  const found = findMoves(['/old/CD1/01 Intro.mp3'], ['/new/A/CD1/01 Intro.mp3', '/new/B/CD1/01 Intro.mp3']);
  assert.strictEqual(found.moves.size, 0);
});

test('of two, the one whose path ends the more the same way is the song', () => {
  const found = findMoves(['/old/A/CD1/01 Intro.mp3'], ['/new/A/CD1/01 Intro.mp3', '/new/B/CD1/01 Intro.mp3']);
  assert.strictEqual(found.moves.get('/old/A/CD1/01 Intro.mp3'), '/new/A/CD1/01 Intro.mp3');
});

test('a file alone, with no folder in common, is not taken for another', () => {
  assert.strictEqual(findMoves(['/old/x/01.mp3'], ['/new/y/01.mp3']).moves.size, 0);
});

test('from a Mac to Windows, case and separators aside; a cue sheet track too', () => {
  const found = findMoves(['/Users/me/Music/Air/Moon Safari/air.cue#3'], ['D:\\Music\\AIR\\Moon Safari\\air.cue#3']);
  assert.strictEqual(found.moves.size, 1);
  assert.deepStrictEqual(found.groups.map(({ from, to }) => ({ from, to })), [{ from: '/Users/me', to: 'D:' }]);
});

test('movesOf: only the group asked for', () => {
  const found = findMoves(['/a/X/Y/1.mp3', '/b/P/Q/2.mp3'], ['/c/X/Y/1.mp3', '/d/P/Q/2.mp3']);
  const g = found.groups.find((x) => x.from === '/a');
  assert.deepStrictEqual([...movesOf(found, g.key)], [['/a/X/Y/1.mp3', '/c/X/Y/1.mp3']]);
});

test('plays move with their songs, in their order; two that become one are added up', () => {
  const moves = new Map([['/old/a', '/new/a']]);
  const r = movePlays({
    counts: new Map([['/old/a', 3], ['/x', 1], ['/new/a', 2]]),
    last: new Map([['/old/a', 50], ['/x', 60], ['/new/a', 70]]),
    first: new Map([['/old/a', 10], ['/new/a', 40]]),
  }, moves);
  assert.deepStrictEqual([...r.counts], [['/x', 1], ['/new/a', 5]]);
  assert.deepStrictEqual([...r.last], [['/x', 60], ['/new/a', 70]]);
  assert.deepStrictEqual([...r.first], [['/new/a', 10]]);
});

test('HISTORY: moved, each once, newest first, those with no time last', () => {
  const h = moveHistory(['/x', '/old/a', '/new/a', '/untimed'], new Map([['/old/a', '/new/a']]));
  assert.deepStrictEqual(h, ['/x', '/new/a', '/untimed']);
  assert.deepStrictEqual(newestFirst(['/untimed', '/x', '/new/a'], new Map([['/x', 1], ['/new/a', 2]])), ['/new/a', '/x', '/untimed']);
});

test('an album known by its folder moves with it; one known by its tags stays as it is', () => {
  assert.strictEqual(moveAlbumId('\n\n/Volumes/Old/Music/Untagged', '/Volumes/Old', '/Users/me'), '\n\n/Users/me/Music/Untagged');
  assert.strictEqual(moveAlbumId('\n\n/Volumes/Older/Music', '/Volumes/Old', '/Users/me'), '\n\n/Volumes/Older/Music', 'not a folder inside it');
  assert.strictEqual(moveAlbumId('radiohead\nokcomputer\n', '/Volumes/Old', '/Users/me'), 'radiohead\nokcomputer\n');
  assert.strictEqual(moveAlbumId('\nsoundtrack\n/Users/me/Music/OST', '/Users/me', 'D:'), '\nsoundtrack\nD:\\Music\\OST');
});

test('prefixOf', () => {
  assert.strictEqual(prefixOf('/a/b/c', 2), '/a');
  assert.strictEqual(prefixOf('C:\\Music\\x.mp3', 2), 'C:');
});
