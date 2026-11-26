'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createSpotifyShelf } = require('../src/main/spotify-shelf');

const album = (id, artist, title, extra = {}) => ({ id: `spotify:album:${id}`, spotify: { id, cover: null, total: 1 }, title, artist, tracks: [{ path: `spotify:track:${id}1`, title: 'x' }], ...extra });
function make({ kept = null, answer = { albums: [] }, connected = true } = {}) {
  let saved = kept, now = 1e12, asked = 0;
  const s = createSpotifyShelf({ fetchAlbums: async () => { asked++; return typeof answer === 'function' ? answer() : answer; }, read: () => saved, write: (t) => { saved = t; }, now: () => now, connected: () => connected });
  return { s, later: (ms) => { now += ms; }, asked: () => asked, saved: () => saved };
}

test("saved albums go on the shelf beside the files', not when the same album is there as files", async () => {
  const { s } = make({ answer: { albums: [album('a', 'Radiohead', 'OK Computer'), album('b', 'Radiohead', 'Kid A')] } });
  await s.refresh();
  const files = [{ id: 'f', artist: 'RADIOHEAD', title: 'OK Computer', tracks: [{ path: '/m/1.flac' }] }];
  assert.deepStrictEqual(s.albumsBeside(files).map((a) => a.id), ['spotify:album:b']);
});

test('kept between runs: the shelf opens with them at once, and asks Spotify again only after a while', async () => {
  const first = make({ answer: { albums: [album('a', 'A', 'One')] } });
  await first.s.refresh();
  const again = make({ kept: first.saved(), answer: { albums: [album('a', 'A', 'One'), album('b', 'B', 'Two')] } });
  assert.deepStrictEqual(again.s.albumsBeside([]).map((a) => a.title), ['One']);
  assert.strictEqual(again.s.stale(), false);
  again.later(11 * 60e3);
  assert.strictEqual(again.s.stale(), true);
  assert.strictEqual(await again.s.refresh(), true, 'changed: the shelf is told');
  assert.strictEqual(await again.s.refresh(), false, 'the same again: not told');
  assert.deepStrictEqual(again.s.albumsBeside([]).map((a) => a.title), ['One', 'Two']);
});

test('signed out, or Spotify not answering: none shown if signed out, the last ones kept if only offline', async () => {
  const on = make({ answer: { albums: [album('a', 'A', 'One')] } });
  await on.s.refresh();
  const offline = make({ kept: on.saved(), answer: { error: 'OFFLINE' } });
  assert.strictEqual(await offline.s.refresh(), false);
  assert.strictEqual(offline.s.albumsBeside([]).length, 1);
  const out = make({ kept: on.saved(), connected: false });
  assert.deepStrictEqual(out.s.albumsBeside([]), []);
  assert.strictEqual(out.s.stale(), false, 'nothing asked when not connected');
});

test('one album saved or taken out: the shelf has it at once, without reading the whole library again', async () => {
  const { s } = make({ answer: { albums: [album('a', 'A', 'One'), album('b', 'B', 'Two')] } });
  await s.refresh();
  s.forget('spotify:album:a');
  assert.deepStrictEqual(s.albumsBeside([]).map((a) => a.title), ['Two']);
  assert.strictEqual(s.stale(), true, 'and read again next time, to have the one saved');
  assert.strictEqual(s.coverOf('spotify:track:b1'), null);
});

test("dust on a saved album gathers from when it came on the shelf, not from when it was saved on Spotify years ago", async () => {
  const { s, later, saved } = make({ answer: { albums: [album('a', 'A', 'One', { added: 1000 })] } });
  await s.refresh();
  assert.strictEqual(s.onShelfSince('spotify:album:a'), 1e12);
  later(5000);
  await s.refresh();
  assert.strictEqual(s.onShelfSince('spotify:album:a'), 1e12, 'kept, not moved on each read');
  const again = make({ kept: saved(), answer: { albums: [album('a', 'A', 'One'), album('b', 'B', 'Two')] } });
  again.later(9000);
  await again.s.refresh();
  assert.deepStrictEqual([again.s.onShelfSince('spotify:album:a'), again.s.onShelfSince('spotify:album:b')], [1e12, 1e12 + 9000]);
});
