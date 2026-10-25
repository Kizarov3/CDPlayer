'use strict';
/**
 * Streamed songs (YouTube Music, YouTube, SoundCloud), through yt-dlp: it finds where a song's sound is, and the
 * cdp:// scheme serves it from there (cdp://app/stream?u=<the song's page>) — same origin, so Web Audio hears it and
 * the EQ, spatial audio and the visualizer work as for a file — a piece at a time (YouTube slows a whole song asked
 * for at once to the speed it plays at, and a seek would wait for it).
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHUNK = 1024 * 1024; // what's asked of the server at a time
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const CANDIDATES = ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp'];

// yt-dlp: the app's own copy (got from yt-dlp's releases when streaming is first turned on, and got again when it's a
// few days old: YouTube changes, yt-dlp follows), or one the user installed. The release as a folder (.zip), not one
// file: that one unpacks itself each time it's run, some 3 s before every search.
const OWN = {
  darwin: ['yt-dlp_macos.zip', 'yt-dlp_macos'], win32: ['yt-dlp_win.zip', 'yt-dlp.exe'],
  linux: process.arch === 'arm64' ? ['yt-dlp_linux_aarch64.zip', 'yt-dlp_linux_aarch64'] : ['yt-dlp_linux.zip', 'yt-dlp_linux'],
}[process.platform];
const RELEASES = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
const STALE = 3 * 24 * 60 * 60 * 1000;
const ownDir = () => (store && OWN ? path.join(store.dataDir(), 'bin', 'yt-dlp') : null);
const ownPath = () => (ownDir() ? path.join(ownDir(), OWN[1]) : null);
function ytDlpPath() {
  const own = ownPath();
  if (own && fs.existsSync(own)) return own;
  return CANDIDATES.find((p) => fs.existsSync(p)) || (process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
}

/** Whether yt-dlp is there to stream with: its version, or null. */
function available() {
  return new Promise((resolve) => {
    execFile(ytDlpPath(), ['--version'], { timeout: 30000 }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
  });
}

/** yt-dlp's latest release into the app's own folder, checked against the sums it's published with. */
let installing = null;
function install() {
  if (installing) return installing;
  installing = (async () => {
    if (!OWN || !ownDir()) throw new Error('No yt-dlp for this system');
    const [asset] = OWN;
    const get = async (name) => {
      const res = await fetch(RELEASES + name, { redirect: 'follow' });
      if (!res.ok) throw new Error(`${name}: ${res.status}`);
      return res;
    };
    const sums = await (await get('SHA2-256SUMS')).text();
    const want = (new RegExp(`^([0-9a-f]{64})\\s+\\*?${asset.replace(/\./g, '\\.')}$`, 'm').exec(sums) || [])[1];
    if (!want) throw new Error('No checksum');
    const zip = Buffer.from(await (await get(asset)).arrayBuffer());
    if (require('crypto').createHash('sha256').update(zip).digest('hex') !== want) throw new Error('Checksum mismatch');
    // unpacked beside the one there is, then put in its place (one in use — Windows won't let it go — stays till next time)
    const dir = ownDir(), fresh = `${dir}.new`, old = `${dir}.old`;
    for (const d of [fresh, old]) fs.rmSync(d, { recursive: true, force: true });
    require('./unzip').extract(zip, fresh);
    try {
      if (fs.existsSync(dir)) fs.renameSync(dir, old);
      fs.renameSync(fresh, dir);
    } catch (e) {
      if (!fs.existsSync(dir) && fs.existsSync(old)) fs.renameSync(old, dir);
      fs.rmSync(fresh, { recursive: true, force: true });
      throw e;
    }
    fs.rmSync(old, { recursive: true, force: true });
    return available();
  })();
  installing.finally(() => { installing = null; }).catch(() => {});
  return installing;
}
// The app's own copy got again in the background once it's a few days old (the one being used meanwhile).
let freshened = false;
function freshen() {
  if (freshened) return;
  freshened = true;
  try { if (Date.now() - fs.statSync(ownPath()).mtimeMs > STALE) install().catch(() => {}); } catch { /* none of its own */ }
}

function run(args, timeout = 30000) {
  freshen();
  return new Promise((resolve, reject) => {
    // YouTube's checks are puzzles in JavaScript: the app itself (Electron, run as Node) solves them for yt-dlp, so no
    // other JavaScript runtime (deno) is needed. (Homebrew's yt-dlp is given its own folder on the PATH too.)
    // yt-dlp runs it with --permission: Node's permission model, no files, no processes, for YouTube's script.
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', PATH: [path.dirname(ytDlpPath()), process.env.PATH || ''].join(path.delimiter) };
    const js = ['--no-js-runtimes', '--js-runtimes', `node:${process.execPath}`];
    execFile(ytDlpPath(), [...js, ...args], { timeout, maxBuffer: 64 * 1024 * 1024, env }, (err, stdout, stderr) => {
      if (err) { reject(new Error(String(stderr || err.message).trim().split('\n').pop())); return; }
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
    });
  });
}

/** A streamed song's address: its page on YouTube Music, YouTube or SoundCloud (the queue and the history keep it). */
const PAGE = /^https:\/\/(music\.youtube\.com|www\.youtube\.com|youtube\.com|soundcloud\.com|api\.soundcloud\.com)\//;
const isStreamPage = (p) => typeof p === 'string' && PAGE.test(p);
const sourceOf = (p) => (/soundcloud\.com/.test(p) ? 'SOUNDCLOUD' : 'YOUTUBE MUSIC');

// What's known of each streamed song — its name, album, length, cover — kept in streams.json, so the queue, the
// changer and the history still name it after a restart. (store: { readText, writeText }, given by main.js)
let store = null, known = null, saveTimer = null;
function setStore(s) { store = s; }
function songs() {
  if (!known) { try { known = new Map(Object.entries(JSON.parse((store && store.readText('streams.json')) || '{}'))); } catch { known = new Map(); } }
  return known;
}
function remember(page, info) {
  const had = songs().get(page) || {};
  const next = { ...had };
  for (const [k, v] of Object.entries(info)) if (v != null && v !== '') next[k] = v;
  songs().set(page, next);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store && store.writeText('streams.json', JSON.stringify(Object.fromEntries(songs()))), 1000);
}
const songInfo = (page) => songs().get(page) || null;

// A song's page → where its sound is, kept till a little before the address runs out (YouTube's say when: expire=).
const found = new Map();
function expiry(url) {
  const m = /[?&]expire=(\d+)/.exec(url);
  return m ? Number(m[1]) * 1000 - 10 * 60 * 1000 : Date.now() + 60 * 60 * 1000;
}
const asking = new Map();
async function resolve(page, { fresh = false } = {}) {
  if (!isStreamPage(page)) throw new Error('Not a stream page');
  const had = found.get(page);
  if (had && !fresh && had.until > Date.now()) return had;
  if (!fresh && asking.has(page)) return asking.get(page);
  const job = (async () => {
    const info = await run(['-f', 'bestaudio', '-J', '--no-playlist', '--', page]);
    const entry = {
      url: info.url, headers: info.http_headers || {}, size: info.filesize || info.filesize_approx || null,
      type: info.ext === 'webm' ? 'audio/webm' : info.ext === 'm4a' ? 'audio/mp4' : info.ext === 'mp3' ? 'audio/mpeg' : 'application/octet-stream',
      codec: String(info.acodec || info.ext || '').toUpperCase(), bitrate: info.abr ? Math.round(info.abr) : null, sampleRate: info.asr || null,
      until: expiry(info.url),
      // YouTube's address answers only a few seconds after it's given (yt-dlp waits too: "as required by the site")
      readyAt: Date.now() + (/googlevideo\.com/.test(info.url) ? 4000 : 0),
    };
    if (/m3u8/.test(info.protocol || '')) { entry.whole = await joinPieces(info.url, entry.headers); entry.size = entry.whole.length; keepFew(page); }
    remember(page, {
      title: songTitle(info.track || info.title), artist: artistName(info.artist || (info.artists && info.artists[0]) || info.uploader), album: info.album,
      year: info.release_year, duration: info.duration, cover: songInfo(page)?.cover || bestThumb(info.thumbnails),
    });
    found.set(page, entry);
    return entry;
  })();
  asking.set(page, job);
  try { return await job; } finally { asking.delete(page); }
}
// A song SoundCloud gives only in pieces (HLS): its pieces fetched and put together, the whole song kept in memory —
// a few songs' worth at a time. One locked (EXT-X-KEY: DRM) isn't played.
async function joinPieces(url, headers) {
  const get = async (u) => {
    const res = await fetch(u, { headers: { 'User-Agent': headers['User-Agent'] || 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`Upstream ${res.status}`);
    return res;
  };
  const list = await (await get(url)).text();
  if (/#EXT-X-KEY:(?!METHOD=NONE)/.test(list)) throw new Error('Protected song');
  const map = /#EXT-X-MAP:URI="([^"]+)"/.exec(list);
  const parts = [...(map ? [map[1]] : []), ...list.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))]
    .map((u) => new URL(u, url).href);
  const out = new Array(parts.length);
  let next = 0;
  const worker = async () => { while (next < parts.length) { const i = next++; out[i] = Buffer.from(await (await get(parts[i])).arrayBuffer()); } };
  await Promise.all(Array.from({ length: 6 }, worker));
  return Buffer.concat(out);
}
const WHOLE_KEPT = 4;
function keepFew(page) {
  const whole = [...found].filter(([p, e]) => e.whole && p !== page).map(([p]) => p);
  whole.slice(0, Math.max(0, whole.length - (WHOLE_KEPT - 1))).forEach((p) => found.delete(p));
}
/** The next song's address asked for now, so it's ready (YouTube's few seconds waited) by the time it's needed. */
function prepare(page) { if (isStreamPage(page)) resolve(page).catch(() => {}); }

// (YouTube's channels made for an artist's music are named "<artist> - Topic")
// (a song uploaded as a file is often named after it: "Xtal.mp3")
const songTitle = (s) => (s ? String(s).replace(/\.(mp3|wav|flac|m4a|aiff?|ogg)$/i, '') : null);
const artistName = (s) => (s ? String(s).replace(/ - Topic$/, '') : null);
const bestThumb = (list) => {
  const l = (list || []).filter((x) => x && x.url);
  return l.length ? l.reduce((a, b) => ((b.width || 0) > (a.width || 0) ? b : a)).url : null;
};

/**
 * What `query` finds: albums on YouTube Music, or songs on SoundCloud — [{ kind: 'album'|'song', page, title,
 * artist, year, cover, count, duration }]. YouTube Music's search names only where each album is: the first few
 * are opened to name them.
 */
const ALBUMS_NAMED = 8;
async function search(query, where = 'youtube') {
  if (where === 'soundcloud') {
    const r = await run(['--flat-playlist', '-J', '--', `scsearch12:${query}`]);
    return (r.entries || []).map((e) => {
      const page = e.url;
      const song = { kind: 'song', page, title: songTitle(e.title), artist: e.uploader || null, duration: e.duration || null, cover: bestThumb(e.thumbnails) };
      remember(page, { title: song.title, artist: song.artist, duration: song.duration, cover: song.cover });
      return song;
    });
  }
  const r = await run(['--flat-playlist', '-J', '--', `https://music.youtube.com/search?q=${encodeURIComponent(query)}#albums`]);
  const pages = (r.entries || []).map((e) => e.url).filter(Boolean).slice(0, ALBUMS_NAMED);
  const named = await Promise.all(pages.map((pg) => album(pg).catch(() => null)));
  return named.filter((a) => a && a.tracks.length).map((a) => ({ kind: 'album', ...a, count: a.tracks.length }));
}

/** An album (or playlist) page → { title, artist, cover, page, tracks: [{ page, title, artist, duration }] }. */
async function album(page) {
  if (!isStreamPage(page)) throw new Error('Not a stream page');
  const r = await run(['--flat-playlist', '-J', '--', page]);
  const title = String(r.title || '').replace(/^Album - /, '');
  const tracks = (r.entries || []).map((e) => ({
    page: e.url && /^https?:/.test(e.url) ? e.url.replace('https://www.youtube.com/watch', 'https://music.youtube.com/watch') : `https://music.youtube.com/watch?v=${e.id}`,
    title: e.title || null, artist: artistName((e.artists && e.artists[0]) || e.channel || e.uploader), duration: e.duration || null,
  }));
  const artist = tracks.length && tracks.every((t) => t.artist === tracks[0].artist) ? tracks[0].artist : (tracks[0] && tracks[0].artist) || null;
  const cover = bestThumb(r.thumbnails);
  tracks.forEach((t, i) => remember(t.page, { title: t.title, artist: t.artist, albumArtist: artist, album: title, duration: t.duration, cover, track: i + 1, of: tracks.length }));
  return { title, artist, cover, page: r.webpage_url || page, tracks };
}

// A cover's picture, as a data: URL (as a file's own cover is), kept for the session.
const pictures = new Map();
async function coverData(url) {
  if (!url) return null;
  if (pictures.has(url)) return pictures.get(url);
  const job = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const type = res.headers.get('content-type') || 'image/jpeg';
      return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
    } catch { return null; }
  })();
  pictures.set(url, job);
  return job;
}

/** A streamed song's details, shaped as metadata.getDetails' are for a file. */
async function details(page, { withCover = true } = {}) {
  const k = songInfo(page) || {}, f = found.get(page);
  const ext = f ? (f.codec === 'OPUS' ? 'OPUS' : f.codec || '') : '';
  return {
    path: page, title: k.title || page, artist: k.artist || null, album: k.album || null, nameGuessed: false, unnamed: false,
    credits: { ...(k.albumArtist ? { albumArtist: k.albumArtist } : {}), ...(k.year ? { released: String(k.year) } : {}), ...(k.track ? { track: { no: k.track, of: k.of || null } } : {}) },
    lyrics: null, duration: k.duration || 0, ext, stream: sourceOf(page),
    quality: [sourceOf(page), f && f.bitrate ? `${f.bitrate} KBPS` : null].filter(Boolean).join(' · '),
    format: f ? { sampleRate: f.sampleRate, bitsPerSample: null, lossless: false } : null,
    replayGain: null, cover: withCover ? await coverData(k.cover) : undefined,
  };
}

// One piece of the sound, `start`–`last`: the server's answer (asked again while it isn't answering yet, and for a new
// address once that has run out), and the whole song's size.
async function fetchPiece(page, start, last) {
  let entry = await resolve(page);
  if (entry.whole) return { res: new Response(entry.whole.subarray(start, last + 1), { status: 206 }), total: entry.whole.length };
  if (entry.readyAt > Date.now()) await wait(entry.readyAt - Date.now());
  const ask = () => fetch(entry.url, { headers: { 'User-Agent': entry.headers['User-Agent'] || 'Mozilla/5.0', Range: `bytes=${start}-${last}` } });
  let res = await ask();
  for (let tries = 0; (res.status === 403 || res.status === 410) && tries < 4; tries++) {
    await res.arrayBuffer().catch(() => {});
    if (tries >= 2) entry = await resolve(page, { fresh: true });
    await wait(Math.max(1000, entry.readyAt - Date.now()));
    res = await ask();
  }
  const total = Number((/\/(\d+)$/.exec(res.headers.get('content-range') || '') || [])[1]) || null;
  if (total) entry.size = total;
  return { res, total };
}

/**
 * cdp://app/stream?u=<page>: the song's sound. The player is answered with all it asks for (a piece shorter than that
 * it takes for the whole song), fetched from the server a CHUNK at a time, one after another as it's read.
 */
async function serveStream(request, page) {
  if (!isStreamPage(page)) return new Response('Bad page', { status: 400 });
  const m = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') || '');
  const start = m ? Number(m[1]) : 0;
  let first, total;
  try { ({ res: first, total } = await fetchPiece(page, start, start + CHUNK - 1)); } catch (e) { return new Response(`Not found: ${e.message}`, { status: 404 }); }
  if (!first.ok || !total) return new Response(`Upstream ${first.status}`, { status: 502 });
  const end = Math.min(m && m[2] ? Number(m[2]) : total - 1, total - 1);
  let at = start, reader = first.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();
        if (!done) {
          const take = value.subarray(0, Math.max(0, end + 1 - at));
          at += take.length;
          if (take.length) controller.enqueue(take);
          if (at > end) { reader.cancel().catch(() => {}); controller.close(); }
          return;
        }
        if (at > end) { controller.close(); return; }
        try {
          const { res } = await fetchPiece(page, at, Math.min(end, at + CHUNK - 1));
          if (!res.ok) throw new Error(String(res.status));
          reader = res.body.getReader();
        } catch (e) { controller.error(e); return; }
      }
    },
    cancel() { reader.cancel().catch(() => {}); },
  });
  const type = (found.get(page) || {}).type || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Content-Length': String(end - start + 1) };
  if (!m) return new Response(body, { status: 200, headers });
  return new Response(body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${total}` } });
}

module.exports = { available, install, isStreamPage, setStore, remember, songInfo, resolve, prepare, search, album, details, coverData, serveStream, ytDlpPath };
