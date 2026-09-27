'use strict';
// The shelf's cover lookup for a whole album, against canned iTunes / Deezer / MusicBrainz answers (no network).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const { findAlbumCoverUrl } = require('../src/main/online');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const realFetch = global.fetch;
let asked = [];
function answer({ itunes = [], deezer = [], mb = [], fail = false } = {}) {
  asked = [];
  global.fetch = async (url) => {
    asked.push(String(url));
    if (fail) throw new Error('offline');
    const body = /itunes/.test(url) ? { results: itunes } : /deezer/.test(url) ? { data: deezer } : { 'release-groups': mb };
    return { ok: true, status: 200, json: async () => body };
  };
}
test.after(() => { global.fetch = realFetch; });

test('the album is searched for by its name, not by one of its songs', async () => {
  answer({ itunes: [{ collectionName: 'Three Dollar Bill, Y\'all', artistName: 'Limp Bizkit', artworkUrl100: 'https://a/100x100bb.jpg' }] });
  const found = await findAlbumCoverUrl({ artist: 'Limp Bizkit', album: 'Three Dollar Bill Y\'All$' });
  assert.deepStrictEqual(found, { url: 'https://a/600x600bb.jpg', source: 'ITUNES' });
  assert.match(asked[0], /entity=album/);
  assert.match(decodeURIComponent(asked[0]), /Limp Bizkit Three Dollar Bill/);
});

test('the same artist\'s other album is never used (iTunes answers "Intro" with Chocolate Starfish)', async () => {
  answer({
    itunes: [{ collectionName: 'Chocolate Starfish and the Hot Dog Flavored Water', artistName: 'Limp Bizkit', artworkUrl100: 'https://wrong/100x100bb.jpg' }],
    deezer: [{ title: 'Three Dollar Bill, Yall$', artist: { name: 'Limp Bizkit' }, cover_xl: 'https://dz/right.jpg' }],
  });
  assert.deepStrictEqual(await findAlbumCoverUrl({ artist: 'Limp Bizkit', album: 'Three Dollar Bill Y\'All$' }), { url: 'https://dz/right.jpg', source: 'DEEZER' });
});

test('an edition in brackets still finds the album; another artist\'s album of that name does not', async () => {
  answer({ itunes: [
    { collectionName: 'Meteora', artistName: 'Some Tribute Band', artworkUrl100: 'https://x/100x100bb.jpg' },
    { collectionName: 'Meteora (Bonus Edition)', artistName: 'Linkin Park', artworkUrl100: 'https://lp/100x100bb.jpg' },
  ] });
  assert.deepStrictEqual(await findAlbumCoverUrl({ artist: 'Linkin Park', album: 'Meteora' }), { url: 'https://lp/600x600bb.jpg', source: 'ITUNES' });
});

test('MusicBrainz and the Cover Art Archive when the stores don\'t have it', async () => {
  answer({ mb: [{ id: 'rg-1', score: 100, title: 'Basement Tapes', 'artist-credit': [{ name: 'Nobody' }] }] });
  assert.deepStrictEqual(await findAlbumCoverUrl({ artist: 'Nobody', album: 'Basement Tapes' }),
    { url: 'https://coverartarchive.org/release-group/rg-1/front-500', source: 'MUSICBRAINZ' });
});

test('nothing found → null; offline → networkError, so it is asked again later', async () => {
  answer({});
  assert.strictEqual(await findAlbumCoverUrl({ artist: 'Nobody', album: 'Nothing' }), null);
  answer({ fail: true });
  assert.deepStrictEqual(await findAlbumCoverUrl({ artist: 'Nobody', album: 'Nothing' }), { networkError: true });
});
