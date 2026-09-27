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

test('TTML becomes enhanced LRC: a stamp per word, syllables joined, the line end kept, the head left out', () => {
  assert.strictEqual(ttmlToLrc(TTML),
    "[00:08.84]<00:08.84>Now <00:09.15>he's <00:10.00>es<00:10.20>press<00:10.40>o<00:12.34>\n" +
    '[01:02.50]<01:02.50>Rock <01:03.00>& roll<01:05.00>\n[bg: <01:04.00>(ooh)]');
  assert.strictEqual(ttmlToLrc(TTML, { words: false }), "[00:08.84]Now he's espresso\n[01:02.50]Rock & roll");
  assert.strictEqual(ttmlDuration(TTML), 185.5);
});

// Unison's real shape (Espresso, In the End): every word and line has an end; singers v1/v2; backing vocals.
const TIMED = `<tt xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body dur="3:00"><div>
<p begin="8.835" end="12.339" ttm:agent="v1"><span begin="8.835" end="9.155">Now</span> <span begin="9.155" end="9.587">he's</span> <span begin="10.056" end="10.328">thinkin'</span></p>
<p begin="16.712" end="19.112" ttm:agent="v2"><span begin="16.712" end="17.016">It</span> <span begin="17.016" end="17.600">starts</span><span ttm:role="x-bg"><span begin="18.0" end="18.3">(oh</span> <span begin="18.3" end="18.9">no)</span></span></p>
</div></body></tt>`;

test('TTML with word ends: gaps between words and the line end are stamped, singers prefixed, backing vocals on a [bg: line', () => {
  assert.strictEqual(ttmlToLrc(TIMED),
    "[00:08.84]v1:<00:08.84>Now <00:09.15>he's <00:09.59> <00:10.06>thinkin'<00:10.33> <00:12.34>\n" + // 9.155 rounds down in floating point, as in the test above
    '[00:16.71]v2:<00:16.71>It <00:17.02>starts<00:17.60> <00:19.11>\n[bg: <00:18.00>(oh <00:18.30>no)<00:18.90>]'); // the last word ends when it does; the line when its backing vocals do
});

test('singers are numbered v1, v2… in the order they first sing, whatever the document calls them', () => {
  const group = TIMED.replace('ttm:agent="v1"', 'ttm:agent="v1000"').replace('ttm:agent="v2"', 'ttm:agent="Chester"');
  assert.deepStrictEqual(ttmlToLrc(group).split('\n').filter((l) => !l.startsWith('[bg:')).map((l) => l.slice(10, 13)), ['v1:', 'v2:']);
});

test('one singer: no singer prefixes', () => {
  const solo = TIMED.replace(/ttm:agent="v2"/, 'ttm:agent="v1"');
  assert.ok(!/v1:|v2:/.test(ttmlToLrc(solo)));
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

test('a song with an album tag gets that album\'s cover, not a remix album the song search finds first', async () => {
  // What iTunes really answers for "Limp Bizkit Counterfeit": a guitar mix on New Old Songs before the album itself.
  answer([
    [/itunes.*entity=album/, { results: [{ collectionName: 'Three Dollar Bill, Y\'all', artistName: 'Limp Bizkit', artworkUrl100: 'https://tdb/100x100bb.jpg' }] }],
    [/itunes/, { results: [{ trackName: 'Counterfeit (Lethal Dose Extreme Guitar Mix)', artistName: 'Limp Bizkit', collectionName: 'New Old Songs', artworkUrl100: 'https://nos/100x100bb.jpg' }] }],
    [/deezer/, { data: [] }], [/musicbrainz/, { recordings: [], 'release-groups': [] }], [/https:\/\/(tdb|nos)\//, 'JPEG']]);
  const found = await findCover({ artist: 'Limp Bizkit', title: 'Counterfeit', album: 'Three Dollar Bill Y\'All$' });
  assert.strictEqual(found.url, 'https://tdb/600x600bb.jpg');
  assert.strictEqual(found.source, 'ITUNES');
});

test('no album tag, or an album nobody has: the song search as before', async () => {
  answer([[/itunes.*entity=album/, { results: [] }],
    [/itunes/, { results: [{ trackName: 'Afterglow', artistName: 'Nova Drift', artworkUrl100: 'https://song/100x100bb.jpg' }] }],
    [/deezer/, { data: [] }], [/musicbrainz/, { recordings: [], 'release-groups': [] }], [/https:\/\/song\//, 'JPEG']]);
  assert.strictEqual((await findCover({ artist: 'Nova Drift', title: 'Afterglow', album: 'Some Demo' })).url, 'https://song/600x600bb.jpg');
  assert.strictEqual((await findCover({ artist: 'Nova Drift', title: 'Afterglow' })).url, 'https://song/600x600bb.jpg');
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

test('word-timed Unison lyrics come before lrclib, which only times lines', async () => {
  answer([[/lrclib\.net\/api\/get/, { trackName: 'Espresso', artistName: 'Sabrina Carpenter', duration: 186, syncedLyrics: '[00:01.00]From lrclib' }],
    unison({ song: 'Espresso', artist: 'Sabrina Carpenter', format: 'ttml', lyrics: TTML })]);
  const found = await findLyrics({ artist: 'Sabrina Carpenter', title: 'Espresso', duration: 186 });
  assert.strictEqual(found.source, 'Unison');
  assert.strictEqual(found.lyrics, ttmlToLrc(TTML));
  assert.ok(!asked.some((u) => /lrclib/.test(u)), 'lrclib not asked');
});

test('Unison with line timing only: lrclib still comes first, and Unison is not asked twice', async () => {
  answer([[/lrclib\.net\/api\/get/, { trackName: 'Espresso', artistName: 'Sabrina Carpenter', duration: 175, syncedLyrics: '[00:01.00]From lrclib' }],
    unison({ song: 'Espresso', artist: 'Sabrina Carpenter', format: 'lrc', lyrics: '[00:01.00]From Unison' })]);
  const found = await findLyrics({ artist: 'Sabrina Carpenter', title: 'Espresso', duration: 175 });
  assert.strictEqual(found.lyrics, '[00:01.00]From lrclib');
  answer([...NO_STORE_HITS, unison({ song: 'Espresso', artist: 'Sabrina Carpenter', format: 'lrc', lyrics: '[00:01.00]From Unison' })]);
  const fallback = await findLyrics({ artist: 'Sabrina Carpenter', title: 'Espresso', duration: 175 });
  assert.strictEqual(fallback.lyrics, '[00:01.00]From Unison');
  assert.strictEqual(asked.filter((u) => /unison/.test(u)).length, 1);
});

test('NetEase word-timed lyrics when Unison has none, before lrclib', async () => {
  const yrc = '[19160,7770](19160,210,0)I (19370,1920,0)want (21290,1440,0)you (22730,120,0)to (22850,4080,0)know';
  answer([[/music\.163\.com\/api\/search/, { result: { songs: [{ id: 7, name: 'Knives Out', artists: [{ name: 'Radiohead' }], duration: 254900 }] } }],
    [/music\.163\.com\/api\/song\/lyric/, { code: 200, yrc: { lyric: yrc } }],
    [/lrclib\.net\/api\/get/, { trackName: 'Knives Out', artistName: 'Radiohead', duration: 255, syncedLyrics: '[00:19.16]I want you to know' }]]);
  const found = await findLyrics({ artist: 'Radiohead', title: 'Knives Out', duration: 254.9 });
  assert.strictEqual(found.source, 'NetEase');
  assert.match(found.lyrics, /<00:19\.37>want /);
  assert.ok(!asked.some((u) => /lrclib/.test(u)), 'lrclib not asked');
});

test('Kugou word-timed lyrics when neither Unison nor NetEase has them, before lrclib — checked against its line timing', async () => {
  const zlib = require('zlib');
  const KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
  const krc = '[63340,4560]<0,190,0>Denial <190,1000,0>seems <1190,430,0>it <1620,500,0>had <2120,560,0>to <2680,1880,0>come';
  const content = Buffer.concat([Buffer.from('krc1'), Buffer.from(zlib.deflateSync(Buffer.from(krc)).map((b, i) => b ^ KEY[i % 16]))]).toString('base64');
  answer([[/lyrics\.kugou\.com\/search/, { status: 200, candidates: [{ id: '9', accesskey: 'K9', song: 'Denial', singer: 'Sevendust', duration: 257305 }] }],
    [/lyrics\.kugou\.com\/download/, { status: 200, content }],
    [/lrclib\.net\/api\/get/, { trackName: 'Denial', artistName: 'Sevendust', duration: 257, syncedLyrics: '[01:02.71]Denial seems it had to come' }]]);
  const found = await findLyrics({ artist: 'Sevendust', title: 'Denial', duration: 257.27 });
  assert.strictEqual(found.source, 'Kugou');
  // lrclib's line timing is what Kugou's is checked against: 0.63 s apart, so Kugou's is moved onto it.
  assert.match(found.lyrics, /^\[01:02\.71\]<01:02\.71>Denial <01:02\.90>seems /);
});

test('Unison unreachable (a timeout, not a 404): asked once, then lrclib', async () => {
  asked = [];
  global.fetch = async (url) => {
    asked.push(String(url));
    if (/unison/.test(url)) throw new Error('The operation was aborted due to timeout');
    if (/lrclib\.net\/api\/get/.test(url)) return { ok: true, status: 200, json: async () => ({ trackName: 'Karma Police', artistName: 'Radiohead', duration: 264, syncedLyrics: '[00:01.00]Karma police' }) };
    return { ok: true, status: 200, json: async () => [] };
  };
  const found = await findLyrics({ artist: 'Radiohead', title: 'Karma Police (Remastered)', duration: 264 });
  assert.strictEqual(found && found.source, 'lrclib.net');
  assert.strictEqual(asked.filter((u) => /unison/.test(u)).length, 1);
});

// ---- Picking the recording and release for the Tags panel ----
const { pickRecording } = require('../src/main/online');
const rel = (title, date, extra = {}, group = {}) => ({ title, date, status: 'Official', count: 1, media: [{ position: 1, 'track-count': 12, track: [{ number: '3' }] }], 'release-group': { 'primary-type': 'Album', ...group }, ...extra });
const rec = (extra) => ({ score: 100, title: 'Solar Flare', 'artist-credit': [{ name: 'Nova Drift' }], length: 200000, releases: [], ...extra });

test('tags: the studio recording as long as the file, on its earliest dated album', () => {
  const found = pickRecording([
    rec({ disambiguation: 'live, 2019-05-01: Berlin', releases: [rel('Live in Berlin', '2019')] }),
    rec({ length: 260000, releases: [rel('Extended', '2018')] }),
    rec({ releases: [rel('Neon Skies', '2019'), rel('Neon Skies', '2019-03-01'), rel('Hits', '2015', {}, { 'secondary-types': ['Compilation'] }), rel('Solar Flare', '2018-12-01', {}, { 'primary-type': 'Single' })] }),
  ], { artist: 'Nova Drift', title: 'Solar Flare', duration: 201 });
  assert.strictEqual(found.release.title, 'Neon Skies');
  assert.strictEqual(found.release.date, '2019-03-01', 'a full date before a year-only one');
});

test('tags: the album the file names wins, and a box set loses to an album', () => {
  const recs = [rec({ releases: [rel('Neon Skies', '2019-03-01'), rel('Deluxe Box', '2010-01-01', { count: 5 }), rel('Summer Mix', '2021-06-01', {}, { 'secondary-types': ['Compilation'] })] })];
  assert.strictEqual(pickRecording(recs, { artist: 'Nova Drift', title: 'Solar Flare', duration: 200 }).release.title, 'Neon Skies');
  assert.strictEqual(pickRecording(recs, { artist: 'Nova Drift', title: 'Solar Flare', album: 'Summer Mix', duration: 200 }).release.title, 'Summer Mix');
});

test('tags: another artist\'s song, or a live take, is never picked', () => {
  assert.strictEqual(pickRecording([rec({ 'artist-credit': [{ name: 'Timmy Littlefield' }], releases: [rel('Other', '2019')] })], { artist: 'Nova Drift', title: 'Solar Flare', duration: 200 }), null);
  assert.strictEqual(pickRecording([rec({ disambiguation: 'live', releases: [rel('Live', '2019')] })], { artist: 'Nova Drift', title: 'Solar Flare', duration: 200 }), null);
  assert.ok(pickRecording([rec({ title: 'Solar Flare (Live)', disambiguation: 'live', releases: [rel('Live', '2019')] })], { artist: 'Nova Drift', title: 'Solar Flare (Live)', duration: 200 }));
});
