'use strict';
/**
 * The CD shelf: every album in the music folder (the same folder Search looks in), for the shelf of jewel-case spines.
 * Tracks are grouped into albums by their tags — album artist and album, so a multi-disc set split into CD1/CD2
 * folders is still one album — or, for untagged music, by the folder they're in. What each file's tags say is kept in
 * a cache in the data folder, so only new or changed files are read again next time.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { nativeImage } = require('electron');
const store = require('./store');
const library = require('./library');
const metadata = require('./metadata');
const cue = require('./cue');
const { sameName } = require('./same-name');

const CACHE_FILE = 'shelf-cache.json';
const CACHE_VERSION = 2; // bump when trackInfo() reads files differently, so old entries are read again
const CONCURRENCY = 6;
const COVER_FILE = /^(cover|folder|front|album|albumart|albumartlarge)\.(jpe?g|png|webp)$/i;
const DISC_FOLDER = /^(cd|disc|disk)\s*\d+$/i;
const THUMB = 256;

// The file whose size and date say whether a cached entry is still right (a cue track: its sheet).
const sourceOf = (p) => { const ref = cue.parseRef(p); return ref ? ref.cuePath : p; };
// The folder an album lives in: a "CD1"/"Disc 2" folder counts as its parent, the album's own folder.
function albumFolder(p) {
  const dir = path.dirname(sourceOf(p));
  return DISC_FOLDER.test(path.basename(dir)) ? path.dirname(dir) : dir;
}

// A track in a "CD2" / "Disc 2" folder is on disc 2, when its tags don't say.
function discFromFolder(p) {
  const m = /(\d+)\s*$/.exec(path.basename(path.dirname(sourceOf(p))));
  return m && DISC_FOLDER.test(path.basename(path.dirname(sourceOf(p)))) ? parseInt(m[1], 10) : null;
}

/** What the shelf needs to know about one track. */
async function trackInfo(p) {
  const d = await metadata.getDetails(p, { withCover: false });
  const c = d.credits || {};
  const ref = cue.parseRef(p);
  const year = /\d{4}/.exec(c.released || '');
  return {
    title: d.title, artist: d.artist || null, album: d.album || null, albumArtist: c.albumArtist || null,
    year: year ? year[0] : null, track: ref ? ref.number : (c.track && c.track.no) || null,
    disc: (c.disc && c.disc.no) || discFromFolder(p) || 1, duration: d.duration || 0, artistMbid: c.albumArtistMbid || null,
  };
}

/**
 * Tracks ([{ path, info }]) → albums, sorted by artist (ignoring a leading "The"; no artist last), then year, then title. An album's artist is its album artist,
 * or its tracks' artist when they share one, or "Various Artists". Its tracks are in disc, then track, then file
 * order; `discs` counts the discs (a double album gets a double-width case on the shelf).
 */

function groupAlbums(tracks) {
  // A song with no album artist belongs with the same-named album in its folder that has one (a song whose tags were
  // fixed from MusicBrainz, next to ones that weren't yet).
  const artistHere = new Map();
  for (const t of tracks) {
    if (t.info.album && t.info.albumArtist) artistHere.set(`${albumFolder(t.path)}\n${sameName(t.info.album)}`, t.info.albumArtist);
  }
  const groups = new Map();
  for (const t of tracks) {
    const i = t.info, folder = albumFolder(t.path);
    const albumArtist = i.albumArtist || (i.album && artistHere.get(`${folder}\n${sameName(i.album)}`)) || null;
    const key = i.album
      ? `${sameName(albumArtist)}\n${sameName(i.album)}\n${albumArtist ? '' : folder}`
      : `\n\n${folder}`;
    if (!groups.has(key)) groups.set(key, { id: key, title: i.album || path.basename(folder), folder, items: [] });
    groups.get(key).items.push(t);
  }
  const byName = (a, b) => library.byName(a.path, b.path);
  const albums = [...groups.values()].map((g) => {
    g.items.sort((a, b) => (a.info.disc - b.info.disc) || ((a.info.track || 1e4) - (b.info.track || 1e4)) || byName(a, b));
    const artists = new Set(g.items.map((t) => t.info.artist).filter(Boolean));
    const albumArtist = g.items.map((t) => t.info.albumArtist).find(Boolean);
    const years = g.items.map((t) => t.info.year).filter(Boolean).sort();
    return {
      id: g.id, title: g.title, folder: g.folder,
      artist: albumArtist || (artists.size === 1 ? [...artists][0] : artists.size ? 'Various Artists' : null),
      year: years[0] || null,
      artistMbid: g.items.map((t) => t.info.artistMbid).find(Boolean) || null,
      discs: Math.max(1, ...g.items.map((t) => t.info.disc || 1)),
      duration: g.items.reduce((s, t) => s + (t.info.duration || 0), 0),
      added: g.items.reduce((m, t) => (t.added && (m === null || t.added > m) ? t.added : m), null), // its newest track (a NEW sticker)
      tracks: g.items.map((t) => ({ path: t.path, title: t.info.title, artist: t.info.artist, duration: t.info.duration, track: t.info.track, disc: t.info.disc })),
    };
  });
  const sortName = (s) => String(s || '').replace(/^the\s+/i, '').toLowerCase();
  return albums.sort((a, b) => (!a.artist - !b.artist) // albums nobody's named the artist of go at the end
    || sortName(a.artist).localeCompare(sortName(b.artist), undefined, { numeric: true })
    || String(a.year || '').localeCompare(String(b.year || '')) || sortName(a.title).localeCompare(sortName(b.title), undefined, { numeric: true }));
}

// The shelf's cache for `folder`. One from an older CDPlayer that read tags differently: every track's tags are read
// again (no stamp matches), but when it first turned up is kept — otherwise the whole shelf would look newly added.
function readCache(folder) {
  try {
    const c = JSON.parse(store.readText(CACHE_FILE) || '');
    if (!c || c.folder !== folder || !c.tracks) return null;
    if (c.version === CACHE_VERSION) return c.tracks;
    return Object.fromEntries(Object.entries(c.tracks).map(([p, e]) => [p, { ...e, stamp: null }]));
  } catch { /* none yet, or unreadable: start over */ }
  return null;
}
async function statOf(p) {
  try { return await fsp.stat(sourceOf(p)); } catch { return null; }
}

/**
 * When the shelf first saw a track, for the NEW sticker. Remembered in the cache, so a file whose tags CDPlayer rewrote
 * (a newer date) isn't new again. On the very first read of a folder — or for tracks cached before this was kept —
 * the file's own date stands in, so the whole shelf isn't NEW at once; after that, a file that turns up is new now.
 */
function addedAt(prev, st, cacheFound, now) {
  if (prev && prev.added) return prev.added;
  if (!st) return null;
  if (!cacheFound || prev) return st.birthtimeMs > 0 ? Math.min(st.birthtimeMs, st.mtimeMs) : st.mtimeMs;
  return now;
}

let running = null;
/** Every album in the music folder. onProgress(done, total) while tags are being read. → { folder, name, albums } */
function scanAlbums(onProgress) {
  if (running) return running;
  running = (async () => {
    const folder = store.readLastPath();
    if (!folder || !store.isDir(folder)) return { folder: null, albums: [] };
    const files = await library.collectAudio([folder]);
    const found = readCache(folder), cached = found || {}, fresh = {}, now = Date.now();
    const tracks = new Array(files.length);
    let next = 0, done = 0;
    async function worker() {
      while (next < files.length) {
        const i = next++, p = files[i];
        const st = await statOf(p);
        const stamp = st ? `${st.size}:${Math.round(st.mtimeMs)}` : null;
        const added = addedAt(cached[p], st, !!found, now);
        let info = cached[p] && cached[p].stamp === stamp ? cached[p].info : null;
        if (!info) { try { info = await trackInfo(p); } catch { info = { title: path.basename(p), artist: null, album: null, albumArtist: null, year: null, track: null, disc: 1, duration: 0 }; } }
        fresh[p] = { stamp, info, added };
        tracks[i] = { path: p, info, added };
        if (++done % 20 === 0 && onProgress) onProgress(done, files.length);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    store.writeText(CACHE_FILE, JSON.stringify({ version: CACHE_VERSION, folder, tracks: fresh }));
    const albums = groupAlbums(tracks);
    onShelf = byTrack(albums);
    return { folder, name: path.basename(folder), albums };
  })().finally(() => { running = null; });
  return running;
}

// Which shelf album each track is on ({ id, paths }), from the last read of the shelf — or, before the shelf has
// been opened this time, from its cache. For disc wear, which counts the plays of a disc's whole album.
let onShelf = null;
function byTrack(albums) {
  const map = new Map();
  for (const a of albums) { const album = { id: a.id, paths: a.tracks.map((t) => t.path) }; for (const p of album.paths) map.set(p, album); }
  return map;
}
/**
 * When an album was last touched, for its dust: the latest of when it turned up in the music folder, when a song of it
 * was last played, when it was last wiped, and when dust started gathering at all (so nothing's dusty from before).
 */
function touchedAt(album, { lastPlayed, wiped, since }) {
  let t = Math.max(since || 0, album.added || 0, wiped.get(album.id) || 0);
  for (const track of album.tracks) t = Math.max(t, lastPlayed.get(track.path) || 0);
  return t || null;
}
/** Whether an album comes shrink-wrapped: it turned up after wrapping began, and it hasn't been played or unwrapped. */
function isWrapped(album, { since, torn }) {
  return !!since && !!album.added && album.added > since && !album.plays && !torn.has(album.id);
}
/** The shelf album `p` is on — { id, paths: its tracks, `p` included } — or null when it isn't on the shelf. */
function albumOf(p) {
  if (!onShelf) {
    const folder = store.readLastPath(), cached = folder ? readCache(folder) : null;
    onShelf = byTrack(cached ? groupAlbums(Object.entries(cached).map(([tp, e]) => ({ path: tp, info: e.info, added: e.added }))) : []);
  }
  return onShelf.get(p) || null;
}
const albumTracks = (p) => { const a = albumOf(p); return a ? a.paths : null; };

// ---- Covers ---------------------------------------------------------------------------------------------------

const thumbs = new metadata.Lru(400);
const ONLINE_FILE = 'shelf-covers.json';
const RETRY_AFTER_MS = 7 * 86400e3; // an album nobody had a cover for is asked about again after a week
function toThumb(img) {
  if (!img || img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const small = Math.max(width, height) > THUMB ? img.resize(width >= height ? { width: THUMB, quality: 'best' } : { height: THUMB, quality: 'best' }) : img;
  return `data:image/jpeg;base64,${small.toJPEG(85).toString('base64')}`;
}
// Covers found online for albums with no art of their own (a Music.app library keeps its artwork to itself), kept in
// the data folder so the shelf doesn't search again every time it opens: album -> { cover } or { none: when }.
// (Version 1 searched for an album's first song, which could be on another album: those answers are dropped.)
const ONLINE_VERSION = 2;
let online = null;
function readOnline() {
  if (!online) {
    try { const c = JSON.parse(store.readText(ONLINE_FILE) || '{}'); online = c && c.version === ONLINE_VERSION && c.albums ? c.albums : {}; } catch { online = {}; }
  }
  return online;
}
const onlineKey = ({ artist, album }) => `${String(artist).toLowerCase()}\n${String(album).toLowerCase()}`;

/**
 * The cover found online for the album { artist, album } (`find`: online.findAlbumCover — the album itself, not one
 * of its songs, which can be on another album too), made small by `shrink` before it's kept. → data URL or null.
 * Untagged music isn't searched for.
 */
async function onlineCover(query, { find = (q) => require('./online').findAlbumCover(q), shrink = (c) => c, now = Date.now() } = {}) {
  if (!query.artist || !query.album) return null;
  const known = readOnline(), key = onlineKey(query), entry = known[key];
  if (entry && (entry.cover || now - entry.none < RETRY_AFTER_MS)) return entry.cover || null;
  let found = null;
  try { found = await find(query); } catch { return null; }
  if (!found || (!found.cover && found.networkError)) return null; // offline: ask again next time
  const cover = found.cover ? shrink(found.cover) : null;
  known[key] = cover ? { cover } : { none: now };
  store.writeText(ONLINE_FILE, JSON.stringify({ version: ONLINE_VERSION, albums: known }));
  return cover;
}

/**
 * An album's cover, small: a cover/folder image beside its files, or else the art inside its first track, or else
 * the cover found online for it.
 */
// `online: false` looks only on this computer (and remembers nothing when there's nothing here), for sorting the
// whole shelf by colour without asking the web about every album.
// `local: true` counts only a cover in the files or beside them — not one found online before (LIBRARY CHECK).
const fromWeb = new Set();
async function albumCover(firstTrack, { online = true, local = false } = {}) {
  if (thumbs.get(firstTrack) !== undefined) return local && fromWeb.has(firstTrack) ? null : thumbs.get(firstTrack);
  let thumb = null;
  const dirs = [...new Set([path.dirname(sourceOf(firstTrack)), albumFolder(firstTrack)])];
  for (const dir of dirs) {
    try {
      const name = (await fsp.readdir(dir)).find((n) => COVER_FILE.test(n));
      if (name) { thumb = toThumb(nativeImage.createFromPath(path.join(dir, name))); if (thumb) break; }
    } catch { /* unreadable folder */ }
  }
  if (!thumb) {
    try {
      const d = await metadata.getDetails(firstTrack, { withCover: true });
      if (d.cover) thumb = toThumb(nativeImage.createFromDataURL(d.cover));
      else if (!online) return null;
      else {
        const query = { artist: (d.credits && d.credits.albumArtist) || d.artist, album: d.album };
        thumb = await onlineCover(query, { shrink: (c) => toThumb(nativeImage.createFromDataURL(c)) });
        if (thumb) fromWeb.add(firstTrack);
      }
    } catch { /* no art */ }
  }
  thumbs.set(firstTrack, thumb);
  return thumb;
}

/**
 * An album's cover at full size, for its booklet: the same places as albumCover() — a cover image beside its files,
 * the art inside its first track, or the album found online. → data URL or null.
 */
async function albumCoverFull(firstTrack) {
  for (const dir of [...new Set([path.dirname(sourceOf(firstTrack)), albumFolder(firstTrack)])]) {
    try {
      const name = (await fsp.readdir(dir)).find((n) => COVER_FILE.test(n));
      const img = name ? nativeImage.createFromPath(path.join(dir, name)) : null;
      if (img && !img.isEmpty()) return `data:image/jpeg;base64,${img.toJPEG(90).toString('base64')}`;
    } catch { /* unreadable folder */ }
  }
  try {
    const d = await metadata.getDetails(firstTrack, { withCover: true });
    if (d.cover) return d.cover;
    const artist = (d.credits && d.credits.albumArtist) || d.artist;
    if (!artist || !d.album) return null;
    const found = await require('./online').findAlbumCover({ artist, album: d.album });
    return found.cover || null;
  } catch { return null; }
}

/** A file's tags changed: its album's cover thumbnail is made again next time. */
function forget(filePath) { thumbs.delete(filePath); fromWeb.delete(filePath); onShelf = null; } // its tags changed: it may be on another album now

module.exports = { scanAlbums, albumOf, albumTracks, touchedAt, isWrapped, readCache, addedAt, albumCover, albumCoverFull, onlineCover, groupAlbums, albumFolder, forget };
