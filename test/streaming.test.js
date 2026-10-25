'use strict';
// Streamed songs: yt-dlp and the servers are stood in for (execFile, fetch), so nothing goes online.
const test = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');

const infos = new Map(); // page → what yt-dlp says of it
cp.execFile = (cmd, args, opts, cb) => {
  const page = args[args.length - 1];
  if (args[0] === '--version') { cb(null, '2026.10.21\n', ''); return; }
  const info = infos.get(page);
  if (info) cb(null, JSON.stringify(info), ''); else cb(new Error('no'), '', 'ERROR: not found');
};
const files = new Map(); // address → bytes (or text)
let refuse = 0; // the next few asks answered 403
global.fetch = async (url, { headers = {} } = {}) => {
  if (refuse > 0) { refuse--; return new Response('', { status: 403 }); }
  const body = files.get(String(url));
  if (body == null) return new Response('', { status: 404 });
  if (typeof body === 'string') return new Response(body, { status: 200 });
  const m = /^bytes=(\d+)-(\d+)$/.exec(headers.Range || '');
  if (!m) return new Response(body, { status: 200 });
  const start = Number(m[1]), last = Math.min(Number(m[2]), body.length - 1);
  return new Response(body.subarray(start, last + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${last}/${body.length}` } });
};
const streaming = require('../src/main/streaming');
const written = new Map();
streaming.setStore({ readText: () => null, writeText: (n, s) => written.set(n, s) });

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
});
