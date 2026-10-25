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
function available(timeout = 30000) {
  return new Promise((resolve) => {
    execFile(ytDlpPath(), ['--version'], { timeout }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
  });
}

/** yt-dlp's latest release into the app's own folder, checked against the sums it's published with. */
let installing = null;
function install({ ifNew = false } = {}) {
  if (installing) return installing;
  installing = (async () => {
    if (!OWN || !ownDir()) throw new Error('No yt-dlp for this system');
    const [asset] = OWN;
    const get = async (name) => {
      const res = await fetch(RELEASES + name, { redirect: 'follow', signal: AbortSignal.timeout(5 * 60 * 1000) });
      if (!res.ok) throw new Error(`${name}: ${res.status}`);
      return res;
    };
    const sums = await (await get('SHA2-256SUMS')).text();
    const want = (new RegExp(`^([0-9a-f]{64})\\s+\\*?${asset.replace(/\./g, '\\.')}$`, 'm').exec(sums) || [])[1];
    if (!want) throw new Error('No checksum');
    // (asked a few days on: the one there is still the latest — its sum kept beside it — isn't fetched again)
    const kept = path.join(ownDir(), 'SHA256');
    if (ifNew && fs.existsSync(ownPath()) && (() => { try { return fs.readFileSync(kept, 'utf8').trim(); } catch { return null; } })() === want) {
      const now = new Date();
      fs.utimesSync(ownPath(), now, now);
      return available();
    }
    const zip = Buffer.from(await (await get(asset)).arrayBuffer());
    if (require('crypto').createHash('sha256').update(zip).digest('hex') !== want) throw new Error('Checksum mismatch');
    // Unpacked beside the one there is, then put in its place. The old one is only moved aside — a search may be running
    // it this moment — and thrown away at the next launch. (Windows' antivirus holds a file just written for a while,
    // and won't let a running one go: tried a few times, then the old one stays till next time.)
    const dir = ownDir(), fresh = `${dir}.new`, old = `${dir}.old`;
    for (const d of [fresh, old]) fs.rmSync(d, { recursive: true, force: true });
    require('./unzip').extract(zip, fresh);
    fs.writeFileSync(path.join(fresh, 'SHA256'), want);
    const move = async (from, to) => {
      for (let tries = 0; ; tries++) {
        try { fs.renameSync(from, to); return; } catch (e) { if (tries >= 5) throw e; await wait(500); }
      }
    };
    try {
      if (fs.existsSync(dir)) await move(dir, old);
      await move(fresh, dir);
    } catch (e) {
      if (!fs.existsSync(dir) && fs.existsSync(old)) fs.renameSync(old, dir);
      fs.rmSync(fresh, { recursive: true, force: true });
      throw e;
    }
    // (its first run, fresh from the internet, waits for the antivirus to look at it: on Windows half a minute and more)
    return available(180000);
  })();
  installing.finally(() => { installing = null; }).catch(() => {});
  return installing;
}
// The app's own copy got again in the background once it's a few days old (the one being used meanwhile).
let freshened = false;
function freshen() {
  if (freshened) return;
  freshened = true;
  try { if (Date.now() - fs.statSync(ownPath()).mtimeMs > STALE) install({ ifNew: true }).catch(() => {}); } catch { /* none of its own */ }
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
function setStore(s) {
  store = s;
  if (ownDir()) fs.rm(`${ownDir()}.old`, { recursive: true, force: true }, () => {}); // (yt-dlp's last copy, moved aside: see install)
}
function songs() {
  if (!known) { try { known = new Map(Object.entries(JSON.parse((store && store.readText('streams.json')) || '{}'))); } catch { known = new Map(); } }
  return known;
}
// What a search found is only held in memory: it goes into streams.json once the song is put to use (queued, played,
// its details asked for), or the file would grow with every song ever searched for.
const seen = new Map(), SEEN_MAX = 2000;
const merged = (had, info) => {
  const next = { ...had };
  for (const [k, v] of Object.entries(info)) if (v != null && v !== '') next[k] = v;
  return next;
};
function glimpse(page, info) {
  if (songs().has(page)) { remember(page, info); return; }
  seen.delete(page); // (to the end: the oldest let go first)
  seen.set(page, merged(seen.get(page) || {}, info));
  if (seen.size > SEEN_MAX) seen.delete(seen.keys().next().value);
}
function remember(page, info) {
  songs().set(page, merged(songs().get(page) || seen.get(page) || {}, info));
  seen.delete(page);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store && store.writeText('streams.json', JSON.stringify(Object.fromEntries(songs()))), 1000);
}
const songInfo = (page) => songs().get(page) || seen.get(page) || null;

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
    // the most the site gives without signing in: by bitrate, then rate (YouTube: Opus ~145k; SoundCloud: AAC 160k over MP3 128k / Opus 64k)
    const info = await run(['-f', 'bestaudio', '-S', 'abr,asr', '-J', '--no-playlist', '--', page]).catch((e) => {
      if (/is DRM protected/i.test(e.message)) remember(page, { locked: true }); // a label's song: said so, and marked where it's found
      throw e;
    });
    const entry = {
      chunks: had ? had.chunks : new Map(), used: Date.now(),
      url: info.url, headers: info.http_headers || {}, size: info.filesize || (had && had.size) || null,
      type: info.ext === 'webm' ? 'audio/webm' : info.ext === 'm4a' ? 'audio/mp4' : info.ext === 'mp3' ? 'audio/mpeg' : 'application/octet-stream',
      codec: String(info.acodec || info.ext || '').toUpperCase(), bitrate: info.abr ? Math.round(info.abr) : null, sampleRate: info.asr || null,
      until: expiry(info.url),
    };
    if (/m3u8/.test(info.protocol || '')) {
      try { entry.whole = await joinPieces(info.url, entry.headers); } catch (e) { if (e.message === 'Protected song') remember(page, { locked: true }); throw e; }
      entry.size = entry.whole.length;
    }
    remember(page, {
      title: songTitle(info.track || info.title), artist: artistName(info.artist || (info.artists && info.artists[0]) || info.uploader), album: info.album,
      year: info.release_year, duration: info.duration, cover: songInfo(page)?.cover || bestThumb(info.thumbnails),
    });
    if (isLocked(page)) remember(page, { locked: false }); // (it plays after all)
    found.set(page, entry);
    keepFew();
    return entry;
  })();
  asking.set(page, job);
  try { return await job; } finally { asking.delete(page); }
}
// A song SoundCloud gives only in pieces (HLS): its pieces fetched and put together, the whole song kept in memory —
// a few songs' worth at a time. One locked (EXT-X-KEY: DRM) isn't played.
async function joinPieces(url, headers) {
  const get = async (u) => {
    const res = await fetch(u, { headers: { 'User-Agent': headers['User-Agent'] || 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Upstream ${res.status}`);
    return res;
  };
  const list = await (await get(url)).text();
  if (/#EXT-X-KEY:(?!METHOD=NONE)/.test(list)) throw new Error('Protected song');
  const map = /#EXT-X-MAP:URI="([^"]+)"/.exec(list);
  const parts = [...(map ? [map[1]] : []), ...list.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))]
    .map((u) => new URL(u, url).href);
  const out = new Array(parts.length);
  let next = 0, size = 0, failed = false;
  const worker = async () => {
    while (next < parts.length && !failed) {
      const i = next++;
      try { out[i] = Buffer.from(await (await get(parts[i])).arrayBuffer()); } catch (e) { failed = true; throw e; }
      if ((size += out[i].length) > WHOLE_MAX) { failed = true; throw new Error('Too long a song'); }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return Buffer.concat(out);
}
// The sound kept in memory: a whole song SoundCloud gave in pieces, or the CHUNKs of one fetched so far (played, and
// read for its waveform, from the same pieces; seeking back costs nothing) — a few songs' worth, the one being played
// (served last) never let go.
const KEPT = 4, WHOLE_MAX = 200 * 1024 * 1024;
let playing = null;
function keepFew() {
  const held = [...found].filter(([p, e]) => p !== playing && (e.whole || e.chunks.size)).sort((a, b) => a[1].used - b[1].used);
  for (const [p, e] of held.slice(0, Math.max(0, held.length - (KEPT - 1)))) { if (e.whole) found.delete(p); else e.chunks.clear(); }
}
// YouTube's address answers only a while after it's given — mostly some 3 s, sometimes at once: asked again and again
// (a byte) till it does, rather than waited for the longest it may take.
function ready(entry) {
  if (entry.whole || entry.ready) return Promise.resolve();
  if (!entry.readying) {
    entry.readying = (async () => {
      for (const t0 = Date.now(); Date.now() - t0 < 10000; await wait(250)) {
        const res = await fetch(entry.url, { headers: { 'User-Agent': entry.headers['User-Agent'] || 'Mozilla/5.0', Range: 'bytes=0-0' }, signal: AbortSignal.timeout(5000) }).catch(() => null);
        if (res) await res.arrayBuffer().catch(() => {});
        if (res && res.status < 300) { entry.ready = true; return; }
      }
      entry.readying = null; // (not yet: tried again by the next one to ask)
    })();
  }
  return entry.readying;
}
/** A song about to be played (the next one, or one the mouse is on PLAY for): its address asked for now, and waited for. */
/** A song readied to play; → { locked } once it's known whether it can be (a label's, DRM: no). */
function prepare(page) {
  if (!isStreamPage(page)) return Promise.resolve(null);
  return resolve(page).then(ready).then(() => ({ locked: false }), () => ({ locked: isLocked(page) }));
}
const isLocked = (page) => !!(songInfo(page) || {}).locked;

// (YouTube's channels made for an artist's music are named "<artist> - Topic")
// (a song uploaded as a file is often named after it: "Xtal.mp3")
const songTitle = (s) => (s ? String(s).replace(/\.(mp3|wav|flac|m4a|aiff?|ogg)$/i, '') : null);
const artistName = (s) => (s ? String(s).replace(/ - Topic$/, '') : null);
// The smallest picture still sharp at a list's 34 px (×2): what the search's results show — as data, the page loads no
// picture from outside.
const smallThumb = (list) => {
  const l = (list || []).filter((x) => x && x.url).sort((a, b) => (a.width || 0) - (b.width || 0));
  return (l.find((x) => (x.width || 0) >= 68) || l[l.length - 1] || {}).url || null;
};
const withThumb = async (r, list) => ({ ...r, thumb: await coverData(smallThumb(list)) });
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
    return Promise.all((r.entries || []).map((e) => {
      const page = e.url;
      // (a song only SoundCloud's subscribers hear whole is 30 s exactly, a preview: a whole one is timed to the ms)
      const song = { kind: 'song', page, title: songTitle(e.title), artist: e.uploader || null, duration: e.duration || null, cover: bestThumb(e.thumbnails), locked: isLocked(page), preview: e.duration === 30 };
      glimpse(page, { title: song.title, artist: song.artist, duration: song.duration, cover: song.cover });
      return withThumb(song, e.thumbnails);
    }));
  }
  // The songs first (a song's name typed finds it, not the tribute albums named after it), then the albums — asked
  // for apart ('youtube-songs', 'youtube-albums') to be shown as each comes, or together.
  if (where === 'youtube-songs') return youTubeSongs(query);
  const albums = async () => {
    const r = await run(['--flat-playlist', '-J', '--', `https://music.youtube.com/search?q=${encodeURIComponent(query)}#albums`]);
    const pages = (r.entries || []).map((e) => e.url).filter(Boolean).slice(0, ALBUMS_NAMED);
    const named = await Promise.all(pages.map((pg) => album(pg).catch(() => null)));
    return Promise.all(named.filter((a) => a && a.tracks.length).map((a) => withThumb({ kind: 'album', ...a, count: a.tracks.length }, a.thumbnails)));
  };
  if (where === 'youtube-albums') return albums();
  const [songs, found] = await Promise.all([youTubeSongs(query).catch(() => []), albums()]);
  return [...songs, ...found];
}

// YouTube Music's own search, its songs: as its page asks for them, with each song's artist, album and length
// (yt-dlp's list of the same names only the titles). → [{ kind: 'song', page, title, artist, album, duration, cover }]
const SONGS_ONLY = 'EgWKAQIIAWoKEAkQBRAKEAMQBA==', SONGS_SHOWN = 6;
async function youTubeSongs(query) {
  const res = await fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', Origin: 'https://music.youtube.com', Referer: 'https://music.youtube.com/' },
    body: JSON.stringify({ context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20251020.01.00', hl: 'en' } }, query, params: SONGS_ONLY }),
  });
  if (!res.ok) return [];
  const items = [];
  (function walk(o) {
    if (!o || typeof o !== 'object' || items.length >= SONGS_SHOWN) return;
    if (o.musicResponsiveListItemRenderer) { items.push(o.musicResponsiveListItemRenderer); return; }
    for (const v of Object.values(o)) walk(v);
  })(await res.json());
  const songs = items.map(youTubeSong).filter(Boolean);
  return Promise.all(songs.map(({ thumbs, ...song }) => {
    glimpse(song.page, { title: song.title, artist: song.artist, album: song.album, duration: song.duration, cover: song.cover });
    return withThumb({ ...song, locked: isLocked(song.page) }, thumbs);
  }));
}
// One of its rows: the title (and the song's id) in the first column; "Artist • Album • 4:19" in the second.
function youTubeSong(it) {
  const cols = (it.flexColumns || []).map((c) => ((c.musicResponsiveListItemFlexColumnRenderer || {}).text || {}).runs || []);
  const id = ((((cols[0] || [])[0] || {}).navigationEndpoint || {}).watchEndpoint || {}).videoId || (it.playlistItemData || {}).videoId;
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  const typeOf = (r) => ((((r.navigationEndpoint || {}).browseEndpoint || {}).browseEndpointContextSupportedConfigs || {}).browseEndpointContextMusicConfig || {}).pageType;
  const meta = cols[1] || [];
  const artists = meta.filter((r) => typeOf(r) === 'MUSIC_PAGE_TYPE_ARTIST').map((r) => r.text);
  const album = (meta.find((r) => typeOf(r) === 'MUSIC_PAGE_TYPE_ALBUM') || {}).text || null;
  const time = (meta.map((r) => r.text).find((x) => /^\d+(:\d\d){1,2}$/.test(x.trim())) || '').trim();
  const thumbs = ((((it.thumbnail || {}).musicThumbnailRenderer || {}).thumbnail || {}).thumbnails || []).filter((x) => x && x.url);
  const big = thumbs.length ? thumbs[thumbs.length - 1].url.replace(/=w\d+-h\d+/, '=w544-h544') : null; // (its picture, asked for big)
  return {
    kind: 'song', page: `https://music.youtube.com/watch?v=${id}`, title: (cols[0] || []).map((r) => r.text).join('') || null,
    artist: artists.length ? artists.join(' & ') : null, album, cover: big, thumbs,
    duration: time ? time.split(':').reduce((s, n) => s * 60 + Number(n), 0) : null,
  };
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
  tracks.forEach((t, i) => glimpse(t.page, { title: t.title, artist: t.artist, albumArtist: artist, album: title, duration: t.duration, cover, track: i + 1, of: tracks.length }));
  return { title, artist, cover, thumbnails: r.thumbnails || [], page: r.webpage_url || page, tracks };
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
  if (seen.has(page)) remember(page, {}); // (in the queue or played: kept from now on)
  const k = songInfo(page) || {}, f = found.get(page);
  const ext = f ? (f.codec === 'OPUS' ? 'OPUS' : f.codec || '') : '';
  return {
    path: page, title: k.title || sourceOf(page), // (never the page's address: a song not found says only where it was from)
    artist: k.artist || null, album: k.album || null, nameGuessed: false, unnamed: false,
    credits: { ...(k.albumArtist ? { albumArtist: k.albumArtist } : {}), ...(k.year ? { released: String(k.year) } : {}), ...(k.track ? { track: { no: k.track, of: k.of || null } } : {}) },
    lyrics: null, duration: k.duration || 0, ext, stream: sourceOf(page),
    quality: [sourceOf(page), f && f.bitrate ? `${f.bitrate} KBPS` : null].filter(Boolean).join(' · '),
    format: f ? { sampleRate: f.sampleRate, bitsPerSample: null, lossless: false } : null,
    replayGain: null, cover: withCover ? await coverData(k.cover) : undefined,
  };
}

// The sound's `i`th CHUNK (and the whole song's size): from memory, or from the server — asked again while it isn't
// answering yet, for a new address once that has run out, and after a dropped connection.
async function chunk(page, i) {
  let entry = await resolve(page);
  entry.used = Date.now();
  if (entry.whole) return { data: entry.whole.subarray(i * CHUNK, (i + 1) * CHUNK), total: entry.whole.length };
  const kept = entry.chunks;
  if (!kept.has(i)) {
    const job = (async () => {
      await ready(entry);
      for (let tries = 0; ; tries++) {
        let res = null, data = null;
        try {
          res = await fetch(entry.url, { headers: { 'User-Agent': entry.headers['User-Agent'] || 'Mozilla/5.0', Range: `bytes=${i * CHUNK}-${(i + 1) * CHUNK - 1}` }, signal: AbortSignal.timeout(30000) });
          if (res.ok) data = Buffer.from(await res.arrayBuffer()); else await res.arrayBuffer().catch(() => {});
        } catch { /* dropped: asked again */ }
        if (data) {
          const total = Number((/\/(\d+)$/.exec(res.headers.get('content-range') || '') || [])[1]) || null;
          if (total) entry.size = total;
          return data;
        }
        const refused = res && (res.status === 403 || res.status === 410);
        if (res && !refused) throw new Error(`Upstream ${res.status}`);
        if (tries >= 4) throw new Error(`Upstream ${res ? res.status : 'gone'}`);
        if (refused && tries >= 2) { entry = await resolve(page, { fresh: true }); await ready(entry); } else await wait(500);
      }
    })();
    kept.set(i, job);
    job.catch(() => kept.delete(i));
    keepFew();
  }
  const data = await kept.get(i);
  return { data, total: (found.get(page) || entry).size || entry.size };
}

/**
 * cdp://app/stream?u=<page>: the song's sound. The player is answered with all it asks for (a piece shorter than that
 * it takes for the whole song), a CHUNK at a time as it's read; nothing more is fetched once it stops reading.
 */
async function serveStream(request, page) {
  if (!isStreamPage(page)) return new Response('Bad page', { status: 400 });
  playing = page;
  const m = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') || '');
  const start = m ? Number(m[1]) : 0;
  let first;
  try { first = await chunk(page, Math.floor(start / CHUNK)); } catch (e) { return new Response(`Not found: ${e.message}`, { status: 404 }); }
  const total = first.total;
  if (!total || start >= total) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${total || 0}` } });
  const end = Math.min(m && m[2] ? Number(m[2]) : total - 1, total - 1);
  let at = start, next = first, cancelled = false;
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const piece = next || await chunk(page, Math.floor(at / CHUNK));
        next = null;
        if (cancelled) return;
        const from = at % CHUNK;
        const take = piece.data.subarray(from, from + (end + 1 - at));
        if (!take.length) { controller.close(); return; } // (the server's song shorter than it said)
        at += take.length;
        controller.enqueue(take);
        if (at > end) controller.close();
      } catch (e) { if (!cancelled) controller.error(e); }
    },
    cancel() { cancelled = true; },
  });
  const type = (found.get(page) || {}).type || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Content-Length': String(end - start + 1) };
  if (!m) return new Response(body, { status: 200, headers });
  return new Response(body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${total}` } });
}

module.exports = { available, install, isStreamPage, isLocked, setStore, remember, songInfo, resolve, prepare, search, album, details, coverData, serveStream, ytDlpPath, youTubeSong };
