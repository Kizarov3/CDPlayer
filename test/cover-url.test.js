'use strict';
// The Discord cover lookup, against canned iTunes / Deezer answers (no network).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const { findCoverUrl } = require('../src/main/online');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const realFetch = global.fetch;
let asked = [];
function answer(itunes, deezer) {
  asked = [];
  global.fetch = async (url) => {
    asked.push(String(url));
    const body = /itunes/.test(url) ? { results: itunes ? [itunes] : [] } : { data: deezer ? [deezer] : [] };
    return { ok: true, status: 200, json: async () => body };
  };
}
test.after(() => { global.fetch = realFetch; });

test('the matching song\'s cover address, at 600×600', async () => {
  answer({ trackName: 'Solar Flare', artistName: 'Nova Drift', collectionName: 'Neon Skies', artworkUrl100: 'https://is1-ssl.mzstatic.com/x/100x100bb.jpg' });
  assert.strictEqual(await findCoverUrl({ artist: 'Nova Drift', title: 'Solar Flare' }), 'https://is1-ssl.mzstatic.com/x/600x600bb.jpg');
});

test('someone else\'s song is never used; Deezer is tried next', async () => {
  answer({ trackName: 'Totally Different', artistName: 'Other Band', collectionName: 'Hits', artworkUrl100: 'https://is1-ssl.mzstatic.com/y/100x100bb.jpg' },
    { title: 'Midnight Drive', artist: { name: 'Nova Drift' }, album: { title: 'Neon Skies', cover_xl: 'https://cdn-images.dzcdn.net/z.jpg' } });
  assert.strictEqual(await findCoverUrl({ artist: 'Nova Drift', title: 'Midnight Drive' }), 'https://cdn-images.dzcdn.net/z.jpg');
  answer({ trackName: 'Nope', artistName: 'Nobody', artworkUrl100: 'https://a/100x100bb.jpg' }, null);
  assert.strictEqual(await findCoverUrl({ artist: 'Nova Drift', title: 'Afterglow' }), null);
});

test('each song is looked up once', async () => {
  answer({ trackName: 'Low Orbit', artistName: 'Nova Drift', artworkUrl100: 'https://b/100x100bb.jpg' });
  await findCoverUrl({ artist: 'Nova Drift', title: 'Low Orbit' });
  const first = asked.length;
  assert.strictEqual(await findCoverUrl({ artist: 'Nova Drift', title: 'Low Orbit' }), 'https://b/600x600bb.jpg');
  assert.strictEqual(asked.length, first);
});

test('the same title by another artist is rejected (iTunes really answers this way)', async () => {
  answer({ trackName: 'Solar Flare', artistName: 'Timmy Littlefield', collectionName: 'Starlight Reverie', artworkUrl100: 'https://c/100x100bb.jpg' }, null);
  assert.strictEqual(await findCoverUrl({ artist: 'Nova Drift', title: 'Parallax Solar Flare' }), null);
  answer({ trackName: 'Solar Flare', artistName: 'Timmy Littlefield', artworkUrl100: 'https://c/100x100bb.jpg' }, null);
  assert.strictEqual(await findCoverUrl({ artist: 'Nova Drift', title: 'Solar Flare (Live)' }), null);
});

test('non-Latin titles and artists are checked too', async () => {
  answer({ trackName: 'Группа крови', artistName: 'Кино', artworkUrl100: 'https://d/100x100bb.jpg' });
  assert.strictEqual(await findCoverUrl({ artist: 'Кино', title: 'Группа крови' }), 'https://d/600x600bb.jpg');
  answer({ trackName: 'Звезда по имени Солнце', artistName: 'Кино', artworkUrl100: 'https://e/100x100bb.jpg' }, null);
  assert.strictEqual(await findCoverUrl({ artist: 'Кино', title: 'Пачка сигарет' }), null);
});
