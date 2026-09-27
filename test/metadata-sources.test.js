'use strict';
// MusicBrainz covers, Unison lyrics and the TTML they come in, against canned answers (no network).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const { ttmlToLrc, ttmlDuration, parseTime } = require('../src/main/ttml');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const TTML = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="Word">
<head><metadata><songwriters><songwriter>Somebody</songwriter></songwriters></metadata></head>
<body dur="3:05.500"><div begin="8.835">
<p begin="8.835" end="12.339"><span begin="8.835">Now</span> <span begin="9.155">he's</span> <span begin="10.0">es</span><span begin="10.2">press</span><span begin="10.4">o</span></p>
<p begin="1:02.5" end="1:05"><span begin="1:02.5">Rock</span> <span begin="1:03">&amp; roll</span><span ttm:role="x-bg"><span begin="1:04">(ooh)</span></span></p>
</div></body></tt>`;

test('TTML becomes enhanced LRC: a stamp per word, syllables joined, background vocals and head left out', () => {
  assert.strictEqual(ttmlToLrc(TTML), "[00:08.84]<00:08.84>Now <00:09.15>he's <00:10.00>es<00:10.20>press<00:10.40>o\n[01:02.50]<01:02.50>Rock <01:03.00>& roll");
  assert.strictEqual(ttmlToLrc(TTML, { words: false }), "[00:08.84]Now he's espresso\n[01:02.50]Rock & roll");
  assert.strictEqual(ttmlDuration(TTML), 185.5);
});

test('TTML time expressions', () => {
  assert.strictEqual(parseTime('8.835'), 8.835);
  assert.strictEqual(parseTime('01:23'), 83);
  assert.strictEqual(parseTime('1:02:03.5'), 3723.5);
  assert.strictEqual(parseTime('12.5s'), 12.5);
  assert.strictEqual(parseTime('500ms'), 0.5);
  assert.strictEqual(parseTime('soon'), null);
});

test('untimed TTML is plain text; no lines is nothing', () => {
  assert.strictEqual(ttmlToLrc('<tt><body><div><p>One</p><p>Two<br/>lines</p></div></body></tt>'), 'One\nTwo lines');
  assert.strictEqual(ttmlToLrc('<tt><body/></tt>'), '');
});

// ---- Network lookups, with fetch answered per host ----

const electron = require.resolve('electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: {
  shell: {},
  nativeImage: { createFromBuffer: (buf) => ({ isEmpty: () => !buf.length, toJPEG: () => buf }) },
} };
const { findCover, findLyrics } = require('../src/main/online');

const realFetch = global.fetch;
let asked = [];
function answer(routes) {
  asked = [];
  global.fetch = async (url) => {
    asked.push(String(url));
    const route = routes.find(([pattern]) => pattern.test(url));
    const body = route ? route[1] : null;
    if (body === null) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, json: async () => body, arrayBuffer: async () => Buffer.from(String(body)) };
  };
}
test.after(() => { global.fetch = realFetch; });
const NO_STORE_HITS = [[/itunes/, { results: [] }], [/deezer/, { data: [] }], [/lrclib/, []]];

test('MusicBrainz: the album named by the tag, and its cover from the Cover Art Archive', async () => {
  answer([...NO_STORE_HITS,
    [/release-group\?/, { 'release-groups': [
      { id: 'rg-other', score: 100, title: 'Neon Skies', 'artist-credit': [{ name: 'Somebody Else' }] },
      { id: 'rg-1', score: 100, title: 'Neon Skies', 'artist-credit': [{ name: 'Nova Drift' }] }] }],
    [/coverartarchive\.org\/release-group\/rg-1\/front-500/, 'JPEG']]);
  const found = await findCover({ artist: 'Nova Drift', title: 'Solar Flare', album: 'Neon Skies' });
  assert.strictEqual(found.source, 'MUSICBRAINZ');
  assert.strictEqual(found.url, 'https://coverartarchive.org/release-group/rg-1/front-500');
  assert.match(found.cover, /^data:image\/jpeg;base64,/);
  assert.ok(asked.some((u) => /musicbrainz\.org\/ws\/2\/release-group\?query=.*Neon%20Skies/.test(u)));
});

test('MusicBrainz without an album: the earliest official studio album, not a single, live record or compilation', async () => {
  const release = (id, date, type, extra = {}) => ({ status: 'Official', date, 'release-group': { id, title: id, 'primary-type': type, ...extra } });
  answer([...NO_STORE_HITS,
    [/recording\?/, { recordings: [
      { score: 100, title: 'Got the Life', 'artist-credit': [{ name: 'Korn' }], releases: [
        release('single', '1998-06', 'Single'),
        release('live', '1997', 'Album', { 'secondary-types': ['Live'] }),
        release('best-of', '2004', 'Album', { 'secondary-types': ['Compilation'] }),
        release('follow-the-leader', '1998-08-18', 'Album'),
        { ...release('bootleg', '1996', 'Album'), status: 'Bootleg' }] },
      { score: 100, title: 'Some Other Song', 'artist-credit': [{ name: 'Korn' }], releases: [release('wrong', '1994', 'Album')] }] }],
    [/release-group\/follow-the-leader\//, 'JPEG']]);
  const found = await findCover({ artist: 'Korn', title: 'Got The Life (Official Video)' });
  assert.strictEqual(found.url, 'https://coverartarchive.org/release-group/follow-the-leader/front-500');
});

test('no MusicBrainz cover: falls back to the first store hit as before', async () => {
  answer([[/itunes/, { results: [{ trackName: 'Other', artistName: 'Band', artworkUrl100: 'https://a/100x100bb.jpg' }] }],
    [/deezer/, { data: [] }], [/musicbrainz/, { recordings: [], 'release-groups': [] }], [/https:\/\/a\//, 'JPEG']]);
  const found = await findCover({ artist: 'Nova Drift', title: 'Afterglow' });
  assert.strictEqual(found.source, 'ITUNES');
  assert.strictEqual(found.name, undefined);
});

const unison = (data) => [/unison\.boidu\.dev/, { success: true, data }];

test('Unison lyrics when lrclib has none, as LRC', async () => {
  answer([...NO_STORE_HITS, unison({ song: 'Espresso', artist: 'Sabrina Carpenter', format: 'ttml', lyrics: TTML })]);
  const found = await findLyrics({ artist: 'Sabrina Carpenter', title: 'Espresso', album: 'Espresso', duration: 186 });
  assert.strictEqual(found.lyrics, ttmlToLrc(TTML));
  assert.strictEqual(found.source, 'Unison');
  assert.ok(asked.some((u) => /unison\.boidu\.dev\/lyrics\?song=Espresso&artist=Sabrina%20Carpenter&album=Espresso&duration=186/.test(u)));
});

test('Unison lyrics for another recording length or another song are not used', async () => {
  answer([...NO_STORE_HITS, unison({ song: 'Espresso', artist: 'Sabrina Carpenter', format: 'ttml', lyrics: TTML })]);
  assert.strictEqual(await findLyrics({ artist: 'Sabrina Carpenter', title: 'Espresso', duration: 150 }), null);
  answer([...NO_STORE_HITS, unison({ song: 'Espresso', artist: 'Sabrina Carpenter', format: 'ttml', lyrics: TTML })]);
  assert.strictEqual(await findLyrics({ artist: 'Nova Drift', title: 'Solar Flare', duration: 186 }), null);
});

test('lrclib still comes first', async () => {
  answer([[/lrclib\.net\/api\/get/, { trackName: 'Espresso', artistName: 'Sabrina Carpenter', duration: 175, syncedLyrics: '[00:01.00]From lrclib' }],
    unison({ song: 'Espresso', artist: 'Sabrina Carpenter', format: 'ttml', lyrics: TTML })]);
  const found = await findLyrics({ artist: 'Sabrina Carpenter', title: 'Espresso', duration: 175 });
  assert.strictEqual(found.lyrics, '[00:01.00]From lrclib');
  assert.strictEqual(found.source, 'lrclib.net');
  assert.ok(!asked.some((u) => /unison/.test(u)));
});
