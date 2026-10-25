'use strict';
// Streamed songs: yt-dlp and the servers are stood in for (execFile, fetch), so nothing goes online.
const test = require('node:test');
const assert = require('node:assert');
const { makeZip } = require('./zip-fixture');
const cp = require('child_process');

const infos = new Map(); // page → what yt-dlp says of it
cp.execFile = (cmd, args, opts, cb) => {
  const page = args[args.length - 1];
  if (args[0] === '--version') { cb(null, '2026.10.21\n', ''); return; }
  const info = infos.get(page);
  if (info) cb(null, JSON.stringify(info), ''); else cb(new Error('no'), '', 'ERROR: not found');
};
const files = new Map(); // address → bytes (or text)
let refuse = 0, drop = 0; // the next few asks answered 403 / dropped
const asked = []; // the ranges asked of the servers
global.fetch = async (url, { headers = {} } = {}) => {
  asked.push(`${url} ${headers.Range || ''}`);
  if (drop > 0) { drop--; throw new TypeError('fetch failed'); }
  if (refuse > 0) { refuse--; return new Response('', { status: 403 }); }
  const body = files.get(String(url));
  if (body == null) return new Response('', { status: 404 });
  if (typeof body === 'string') return new Response(body, { status: 200 });
  const m = /^bytes=(\d+)-(\d+)$/.exec(headers.Range || '');
  if (!m) return new Response(body, { status: 200 });
  const start = Number(m[1]), last = Math.min(Number(m[2]), body.length - 1);
  return new Response(body.subarray(start, last + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${last}/${body.length}` } });
};
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const streaming = require('../src/main/streaming');
const written = new Map();
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-stream-test-')); // never a real ~/.cdplayer
streaming.setStore({ readText: () => null, writeText: (n, s) => written.set(n, s), dataDir: () => home });

const bytes = (n, seed = 7) => Buffer.from(Array.from({ length: n }, (_, i) => (i * seed + (i >> 8)) & 255));
const ask = (page, range) => streaming.serveStream(new Request('cdp://app/stream', { headers: range ? { Range: range } : {} }), page);

test('a stream page is one on YouTube Music, YouTube or SoundCloud, nothing else', () => {
  for (const p of ['https://music.youtube.com/watch?v=x', 'https://www.youtube.com/watch?v=x', 'https://soundcloud.com/a/b', 'https://api.soundcloud.com/tracks/1']) {
    assert.ok(streaming.isStreamPage(p), p);
  }
  for (const p of ['/Users/me/Music/a.mp3', 'C:\\Music\\a.flac', 'http://soundcloud.com/a/b', 'https://example.com/a.mp3', 'spotify:track:1', null]) {
    assert.ok(!streaming.isStreamPage(p), String(p));
  }
});

test('the server is asked a piece at a time, and the player gets exactly the range it asked for', async () => {
  const page = 'https://soundcloud.com/someone/long-song';
  const song = bytes(2.5 * 1024 * 1024 + 123);
  files.set('https://cdn.example/long.mp3', song);
  infos.set(page, { url: 'https://cdn.example/long.mp3', ext: 'mp3', acodec: 'mp3', abr: 128, title: 'Long Song.mp3', uploader: 'someone', duration: 160 });
  const part = await ask(page, 'bytes=1000-2400000');
  assert.strictEqual(part.status, 206);
  assert.strictEqual(part.headers.get('content-range'), `bytes 1000-2400000/${song.length}`);
  assert.strictEqual(part.headers.get('content-type'), 'audio/mpeg');
  assert.ok(Buffer.from(await part.arrayBuffer()).equals(song.subarray(1000, 2400001)));
  const rest = await ask(page, 'bytes=2000000-'); // to the end, across the pieces
  assert.strictEqual(rest.headers.get('content-range'), `bytes 2000000-${song.length - 1}/${song.length}`);
  assert.ok(Buffer.from(await rest.arrayBuffer()).equals(song.subarray(2000000)));
  const whole = await ask(page);
  assert.strictEqual(whole.status, 200);
  assert.ok(Buffer.from(await whole.arrayBuffer()).equals(song));
});

test('a server not answering yet (403) is asked again', async () => {
  const page = 'https://soundcloud.com/someone/shy-song';
  const song = bytes(5000, 3);
  files.set('https://cdn.example/shy.mp3', song);
  infos.set(page, { url: 'https://cdn.example/shy.mp3', ext: 'mp3', title: 'Shy' });
  await streaming.resolve(page);
  refuse = 1;
  const r = await ask(page, 'bytes=0-99');
  assert.strictEqual(r.status, 206);
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(song.subarray(0, 100)));
});

test('a song SoundCloud gives in pieces (HLS) is put together, and served like a file', async () => {
  const page = 'https://api.soundcloud.com/tracks/42';
  const init = bytes(700, 5), parts = [bytes(40000, 11), bytes(40000, 13), bytes(12345, 17)];
  files.set('https://pieces.example/a/init.mp4?sig=1', init);
  parts.forEach((p, i) => files.set(`https://pieces.example/a/data00${i}.m4s?sig=1`, p));
  files.set('https://pieces.example/a/list.m3u8', ['#EXTM3U', '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-MAP:URI="init.mp4?sig=1"',
    ...parts.flatMap((_, i) => ['#EXTINF:10.0,', `data00${i}.m4s?sig=1`]), '#EXT-X-ENDLIST', ''].join('\n'));
  infos.set(page, { url: 'https://pieces.example/a/list.m3u8', protocol: 'm3u8_native', ext: 'm4a', acodec: 'mp4a.40.2', abr: 160, title: 'Pieces' });
  const all = Buffer.concat([init, ...parts]);
  const r = await ask(page, 'bytes=500-80999');
  assert.strictEqual(r.status, 206);
  assert.strictEqual(r.headers.get('content-range'), `bytes 500-80999/${all.length}`);
  assert.strictEqual(r.headers.get('content-type'), 'audio/mp4');
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(all.subarray(500, 81000)));
});

test('a locked song (DRM) is not played', async () => {
  const page = 'https://api.soundcloud.com/tracks/43';
  files.set('https://pieces.example/b/list.m3u8', '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x"\n#EXTINF:10.0,\ndata000.m4s\n');
  infos.set(page, { url: 'https://pieces.example/b/list.m3u8', protocol: 'm3u8_native', ext: 'm4a', title: 'Locked' });
  const r = await ask(page, 'bytes=0-');
  assert.strictEqual(r.status, 404);
});

test('a page that is not a stream is refused', async () => {
  assert.strictEqual((await ask('/etc/passwd', 'bytes=0-')).status, 400);
  assert.strictEqual((await ask('https://example.com/x.mp3', 'bytes=0-')).status, 400);
});

test("a streamed song's names: no file extension, no YouTube \"- Topic\", the album's artist", async () => {
  const page = 'https://music.youtube.com/watch?v=abc';
  files.set('https://cdn.example/abc.webm', bytes(10));
  infos.set(page, { url: 'https://cdn.example/abc.webm', ext: 'webm', acodec: 'opus', abr: 135.4, asr: 48000, title: 'Airbag', artists: ['Radiohead - Topic'], album: 'OK Computer', release_year: 1997, duration: 287 });
  streaming.remember(page, { albumArtist: 'Radiohead' });
  await streaming.resolve(page);
  const d = await streaming.details(page, { withCover: false });
  assert.strictEqual(d.title, 'Airbag');
  assert.strictEqual(d.artist, 'Radiohead');
  assert.strictEqual(d.album, 'OK Computer');
  assert.strictEqual(d.credits.albumArtist, 'Radiohead');
  assert.strictEqual(d.credits.released, '1997');
  assert.strictEqual(d.quality, 'YOUTUBE MUSIC · 135 KBPS');
  assert.strictEqual(d.stream, 'YOUTUBE MUSIC');
  const sc = await streaming.details('https://soundcloud.com/someone/long-song', { withCover: false });
  assert.strictEqual(sc.title, 'Long Song');
  assert.strictEqual(sc.stream, 'SOUNDCLOUD');
  assert.strictEqual((await streaming.details('https://music.youtube.com/watch?v=unknown', { withCover: false })).title, 'YOUTUBE MUSIC'); // (not its address)
});

test('an album asked for by something not a stream page is refused before yt-dlp sees it', async () => {
  await assert.rejects(streaming.album('--exec=touch /tmp/x'), /Not a stream page/);
  await assert.rejects(streaming.resolve('-o /tmp/x'), /Not a stream page/);
});

// A .zip as yt-dlp's releases are: files stored or deflated, the program runnable.

test('yt-dlp is got from its releases (the folder build) and kept only when it matches the published sum', async () => {
  const [asset, exe] = { darwin: ['yt-dlp_macos.zip', 'yt-dlp_macos'], win32: ['yt-dlp_win.zip', 'yt-dlp.exe'],
    linux: process.arch === 'arm64' ? ['yt-dlp_linux_aarch64.zip', 'yt-dlp_linux_aarch64'] : ['yt-dlp_linux.zip', 'yt-dlp_linux'] }[process.platform];
  const base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
  const program = bytes(3000, 19), lib = bytes(9000, 29);
  const zip = makeZip([{ name: exe, data: program, mode: 0o755, deflate: true }, { name: '_internal/lib.so', data: lib }]);
  files.set(base + asset, zip);
  files.set(base + 'SHA2-256SUMS', `${'0'.repeat(64)}  yt-dlp.tar.gz\n${crypto.createHash('sha256').update(zip).digest('hex')}  ${asset}\n`);
  assert.strictEqual(await streaming.install(), '2026.10.21');
  const at = path.join(home, 'bin', 'yt-dlp', exe);
  assert.ok(fs.readFileSync(at).equals(program));
  assert.ok(fs.readFileSync(path.join(home, 'bin', 'yt-dlp', '_internal', 'lib.so')).equals(lib));
  if (process.platform !== 'win32') assert.ok(fs.statSync(at).mode & 0o100, 'runnable');
  assert.strictEqual(streaming.ytDlpPath(), at);
  // a newer one replaces it
  const newer = bytes(3000, 31);
  const zip2 = makeZip([{ name: exe, data: newer, mode: 0o755 }]);
  files.set(base + asset, zip2);
  files.set(base + 'SHA2-256SUMS', `${crypto.createHash('sha256').update(zip2).digest('hex')}  ${asset}\n`);
  await streaming.install();
  assert.ok(fs.readFileSync(at).equals(newer));
  assert.ok(!fs.existsSync(path.join(home, 'bin', 'yt-dlp', '_internal')), 'the old folder is gone');
  // looked for again a few days on: the same release isn't downloaded again
  files.delete(base + asset);
  assert.strictEqual(await streaming.install({ ifNew: true }), '2026.10.21');
  assert.ok(fs.readFileSync(at).equals(newer));
  files.set(base + asset, zip2);
  files.set(base + asset, makeZip([{ name: exe, data: bytes(3000, 37) }])); // tampered with
  await assert.rejects(streaming.install(), /Checksum mismatch/);
  assert.ok(fs.readFileSync(at).equals(newer), 'the good copy stays');
});

test('a zip naming a place outside its folder is refused', () => {
  const unzip = require('../src/main/unzip');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-unzip-test-'));
  for (const name of ['../escaped', '/etc/escaped', 'a/../../escaped']) {
    assert.throws(() => unzip.extract(makeZip([{ name, data: bytes(10) }]), path.join(out, 'in')), /Bad name/, name);
  }
  assert.ok(!fs.existsSync(path.join(out, 'escaped')));
});

test('pieces fetched once are kept: the waveform and a seek back read them from memory', async () => {
  const page = 'https://soundcloud.com/someone/kept-song';
  const song = bytes(3 * 1024 * 1024 + 5, 41);
  files.set('https://cdn.example/kept.mp3', song);
  infos.set(page, { url: 'https://cdn.example/kept.mp3', ext: 'mp3', title: 'Kept' });
  await (await ask(page, 'bytes=0-')).arrayBuffer();
  const before = asked.filter((a) => a.startsWith('https://cdn.example/kept.mp3')).length;
  const again = Buffer.from(await (await ask(page)).arrayBuffer()); // the waveform's read of the whole song
  const back = Buffer.from(await (await ask(page, 'bytes=100-199')).arrayBuffer());
  assert.ok(again.equals(song));
  assert.ok(back.equals(song.subarray(100, 200)));
  assert.strictEqual(asked.filter((a) => a.startsWith('https://cdn.example/kept.mp3')).length, before, 'nothing asked of the server again');
});

test('a read stopped (a seek, the next song) fetches nothing more', async () => {
  const page = 'https://soundcloud.com/someone/stopped-song';
  files.set('https://cdn.example/stopped.mp3', bytes(6 * 1024 * 1024, 43));
  infos.set(page, { url: 'https://cdn.example/stopped.mp3', ext: 'mp3', title: 'Stopped' });
  const res = await ask(page, 'bytes=0-');
  const reader = res.body.getReader();
  await reader.read();
  await reader.cancel();
  await new Promise((r) => setTimeout(r, 50));
  const pieces = asked.filter((a) => a.startsWith('https://cdn.example/stopped.mp3') && !a.endsWith('bytes=0-0'));
  assert.ok(pieces.length <= 2, `${pieces.length} pieces asked`);
});

test('a dropped connection is asked again; a range past the end is answered 416', async () => {
  const page = 'https://soundcloud.com/someone/dropped-song';
  const song = bytes(4000, 47);
  files.set('https://cdn.example/dropped.mp3', song);
  infos.set(page, { url: 'https://cdn.example/dropped.mp3', ext: 'mp3', title: 'Dropped' });
  await streaming.resolve(page);
  drop = 1;
  const r = await ask(page, 'bytes=10-19');
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(song.subarray(10, 20)));
  const past = await ask(page, 'bytes=5000-');
  assert.strictEqual(past.status, 416);
  assert.strictEqual(past.headers.get('content-range'), 'bytes */4000');
});

test("a song in YouTube Music's search: its id, title, artists, album, length and a big picture", () => {
  const run = (text, pageType) => ({ text, ...(pageType ? { navigationEndpoint: { browseEndpoint: { browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } } } } } : {}) });
  const col = (runs) => ({ musicResponsiveListItemFlexColumnRenderer: { text: { runs } } });
  const item = {
    flexColumns: [col([{ text: 'Will You Be There', navigationEndpoint: { watchEndpoint: { videoId: 'aIuPDFw9dRU' } } }]),
      col([run('Michael Jackson', 'MUSIC_PAGE_TYPE_ARTIST'), run(' & '), run('The Cleveland Orchestra', 'MUSIC_PAGE_TYPE_ARTIST'), run(' • '), run('Dangerous', 'MUSIC_PAGE_TYPE_ALBUM'), run(' • '), run('7:40')])],
    thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://lh3.googleusercontent.com/x=w60-h60-l90-rj', width: 60 }, { url: 'https://lh3.googleusercontent.com/x=w120-h120-l90-rj', width: 120 }] } } },
  };
  const s = streaming.youTubeSong(item);
  assert.deepStrictEqual([s.page, s.title, s.artist, s.album, s.duration, s.cover],
    ['https://music.youtube.com/watch?v=aIuPDFw9dRU', 'Will You Be There', 'Michael Jackson & The Cleveland Orchestra', 'Dangerous', 460, 'https://lh3.googleusercontent.com/x=w544-h544-l90-rj']);
  assert.strictEqual(streaming.youTubeSong({ flexColumns: [col([{ text: 'x', navigationEndpoint: { watchEndpoint: { videoId: '../../etc' } } }])] }), null);
});
