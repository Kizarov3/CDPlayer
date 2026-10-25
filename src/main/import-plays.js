'use strict';
/**
 * IMPORT PLAYS: what you played elsewhere — Last.fm, ListenBrainz, Spotify, Apple Music — counted on your own songs.
 * A file (or a service's whole export, as its .zip) is read into listens ({ artist, title, album, at }) or, from Apple
 * Music's Library.xml, a total for each song ({ artist, title, album, count, at, file }). Each is found on the shelf by
 * its artist and title — the album choosing between the albums a song is on — and added to the song's plays, last and
 * first play. Imported twice, nothing's counted twice: each listen counted is remembered (a short hash of it) and passed
 * over the next time, while one not found on the shelf is left to be counted once it is there; an Apple Music total
 * adds only what it's grown by since (imports.json). Nor are CDPlayer's own plays counted again: ListenBrainz's listens
 * it sent itself, and Last.fm's from since it first scrobbled there (`own`).
 */
const crypto = require('crypto');
const { fileURLToPath } = require('url');
const unzip = require('./unzip');
const { sameName } = require('./same-name');

const HEARD = 30000; // Spotify counts a song started; Last.fm, one heard for 30 s or more — so do we

const SOURCE_NAMES = { spotify: 'SPOTIFY', lastfm: 'LAST.FM', listenbrainz: 'LISTENBRAINZ', apple: 'APPLE MUSIC' };

// --- reading -------------------------------------------------------------------------------------------------------

function fromJson(value) {
  const list = Array.isArray(value) ? value : value && Array.isArray(value.listens) ? value.listens : value && value.track_metadata ? [value] : null;
  if (!list || !list.length) return null;
  const one = list.find((x) => x && typeof x === 'object') || {};
  if ('master_metadata_track_name' in one) { // Spotify's extended streaming history
    return { source: 'spotify', listens: list.filter((x) => x.master_metadata_track_name && x.ms_played >= HEARD)
      .map((x) => ({ artist: x.master_metadata_album_artist_name, title: x.master_metadata_track_name, album: x.master_metadata_album_album_name, at: Date.parse(x.ts) })) };
  }
  if ('trackName' in one && 'endTime' in one) { // Spotify's account data (its last year)
    return { source: 'spotify', listens: list.filter((x) => x.trackName && x.msPlayed >= HEARD)
      .map((x) => ({ artist: x.artistName, title: x.trackName, album: null, at: Date.parse(`${String(x.endTime).replace(' ', 'T')}Z`) })) };
  }
  if ('listened_at' in one && one.track_metadata) return { source: 'listenbrainz', listens: list.map(listenBrainz).filter((x) => !x.ours) };
  return null;
}
function listenBrainz(x) {
  const m = (x && x.track_metadata) || {}, info = m.additional_info || {};
  const ours = [info.media_player, info.submission_client].includes('CDPlayer'); // sent by CDPlayer: counted here already
  return { artist: m.artist_name, title: m.track_name, album: m.release_name, at: Number(x.listened_at) * 1000, ...(ours ? { ours } : {}) };
}

function csvRows(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}
// Last.fm's scrobbles as the exporters people use write them: with a header (uts, artist, album, track…), or as
// "artist,album,track,date" with no header.
function fromCsv(text) {
  const rows = csvRows(text);
  if (!rows.length) return null;
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => head.findIndex((h) => names.includes(h));
  let artist = col('artist', 'artist_name'), title = col('track', 'title', 'track_name', 'name'), album = col('album', 'album_name');
  let uts = col('uts', 'timestamp', 'unix'), date = col('utc_time', 'date', 'time', 'played_at');
  let body = rows.slice(1);
  if (artist < 0 || title < 0) {
    if (rows[0].length !== 4) return null;
    [artist, album, title, date, uts, body] = [0, 1, 2, 3, -1, rows];
  }
  const when = (r) => {
    if (uts >= 0 && Number(r[uts]) > 0) { const n = Number(r[uts]); return n < 1e11 ? n * 1000 : n; }
    const d = String(r[date] || '').trim();
    return Date.parse(/\d{1,2}:\d{2}$/.test(d) ? `${d} UTC` : d);
  };
  return { source: 'lastfm', listens: body.map((r) => ({ artist: r[artist], title: r[title], album: album >= 0 ? r[album] : null, at: when(r) })) };
}

const entity = (s) => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
  if (named) return named;
  const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return Number.isFinite(code) ? String.fromCodePoint(code) : m;
});
// Apple Music's (iTunes') Library.xml: its Tracks dict, a dict for each song.
function fromLibraryXml(text) {
  const start = text.search(/<key>Tracks<\/key>\s*<dict>/);
  if (start < 0) return null;
  const totals = [];
  const songs = /<key>[^<]*<\/key>\s*<dict>([\s\S]*?)<\/dict>/g;
  songs.lastIndex = text.indexOf('<dict>', start) + 6;
  for (let m; (m = songs.exec(text));) {
    const f = {};
    for (const [, key, , value] of m[1].matchAll(/<key>([^<]*)<\/key>\s*<(string|integer|date)>([^<]*)<\/\2>/g)) f[entity(key)] = entity(value);
    const count = Number(f['Play Count']) || 0;
    if (!count || !f.Name) continue;
    let file = null;
    if (/^file:/i.test(f.Location || '')) {
      // read as the system that wrote it: file:///C:/… is Windows' (iTunes), file:///Users/… a Mac's — whichever this one is
      const url = f.Location.replace(/^file:\/\/localhost\//i, 'file:///');
      try { file = fileURLToPath(url, { windows: /^file:\/\/\/[a-z]:/i.test(url) }); } catch { /* not a path */ }
    }
    totals.push({ artist: f.Artist || f['Album Artist'], title: f.Name, album: f.Album, count, at: Date.parse(f['Play Date UTC']) || null, file });
    if (/^\s*<\/dict>/.test(text.slice(songs.lastIndex))) break; // the end of Tracks
  }
  return { source: 'apple', totals };
}

function fromText(name, text) {
  const t = text.replace(/^﻿/, '').trimStart();
  if (t.startsWith('<')) return /<plist/i.test(t.slice(0, 400)) ? fromLibraryXml(t) : null;
  if (t.startsWith('[') || (t.startsWith('{') && !/\.jsonl$/i.test(name))) {
    try { const r = fromJson(JSON.parse(t)); if (r) return r; } catch { /* JSON lines, maybe */ }
  }
  if (t.startsWith('{')) { // ListenBrainz's export: a listen a line
    const listens = [];
    for (const line of t.split('\n')) {
      if (!line.trim()) continue;
      try { const x = JSON.parse(line); if (x && x.track_metadata) { const l = listenBrainz(x); if (!l.ours) listens.push(l); } } catch { return null; }
    }
    return listens.length ? { source: 'listenbrainz', listens } : null;
  }
  return fromCsv(t);
}

/** A file picked ({ name, data: Buffer }) → [{ source, listens } | { source, totals }]: one for each export in it. */
function read({ name, data }) {
  if (data.length > 4 && data.readUInt32LE(0) === 0x04034b50) {
    const found = [];
    for (const e of unzip.entries(data)) {
      // Spotify's export has podcasts and videos too; only the music's counted
      if (e.name.endsWith('/') || !/\.(json|jsonl|csv|xml)$/i.test(e.name) || /podcast|video/i.test(e.name)) continue;
      const r = fromText(e.name, unzip.data(data, e).toString('utf8'));
      if (r) found.push(r);
    }
    return found;
  }
  const r = fromText(name, data.toString('utf8'));
  return r ? [r] : [];
}

// --- finding the songs on the shelf --------------------------------------------------------------------------------

// "Song - Remastered 2011", "Song (2009 Remaster)" are the song.
const plainTitle = (s) => String(s || '').replace(/\s*[-–(\[]\s*(\d{4}\s+)?(digital(ly)?\s+)?remaster(ed)?(\s+version)?(\s+\d{4})?\s*[)\]]?\s*$/i, '');
// "Artist feat. Someone" is Artist's; tags naming two ("A; B") are either's.
const artistsOf = (s) => String(s || '').replace(/\s+(feat\.?|ft\.|featuring)\s.*$/i, '').split(/\s*;\s*/).map(sameName).filter(Boolean);

function shelfIndex(albums) {
  const index = new Map(), paths = new Set();
  for (const a of albums) {
    for (const t of a.tracks) {
      paths.add(t.path);
      const title = sameName(plainTitle(t.title));
      if (!title) continue;
      const who = new Set([...artistsOf(t.artist), ...(a.artist === 'Various Artists' ? [] : artistsOf(a.artist))]);
      for (const artist of who) {
        const key = `${artist}\n${title}`;
        if (!index.has(key)) index.set(key, []);
        index.get(key).push({ path: t.path, album: sameName(a.title) });
      }
    }
  }
  return { index, paths };
}
function find({ index, paths }, x) {
  if (x.file && paths.has(x.file)) return x.file;
  const title = sameName(plainTitle(x.title));
  if (!title) return null;
  for (const artist of artistsOf(x.artist)) {
    const songs = index.get(`${artist}\n${title}`);
    if (!songs) continue;
    const album = sameName(x.album);
    return ((album && (songs.find((s) => s.album === album) || songs.find((s) => s.album.startsWith(album) || album.startsWith(s.album)))) || songs[0]).path;
  }
  return null;
}

// --- counting ------------------------------------------------------------------------------------------------------

// A listen counted, as remembered: 12 hex digits of its hash (a few hundred thousand fit in a few MB).
const listenKey = (source, x) => crypto.createHash('sha1').update(`${source}\n${x.at}\n${sameName(x.artist)}\n${sameName(x.title)}`).digest('hex').slice(0, 12);
// The maps again with the most recently played last, as plays.js keeps them (the oldest are dropped first).
const byLast = (map, last) => new Map([...map].sort(([a], [b]) => (last.get(a) || 0) - (last.get(b) || 0)));

/**
 * What `found` (read()'s, from every file picked) adds to `plays` ({ counts, last, first }, Maps by path) for the songs
 * on the shelf (`albums`, as scanAlbums gives them), with `before` (imports.json's) remembering what was imported, and
 * `own` when CDPlayer began scrobbling to a service ({ lastfm: ms }), its listens from then on being its own plays.
 * → { plays, imports, songs (the paths that got plays), added, already, missing, sources }
 */
function apply(found, albums, plays, before = {}, { own = {} } = {}) {
  const shelf = shelfIndex(albums), imports = JSON.parse(JSON.stringify(before || {}));
  const counts = new Map(plays.counts), last = new Map(plays.last), first = new Map(plays.first);
  const songs = new Set(), sources = new Set();
  let added = 0, already = 0, missing = 0;
  const play = (p, n, at, isListen) => {
    counts.set(p, (counts.get(p) || 0) + n); added += n; songs.add(p);
    if (at && at > (last.get(p) || 0)) last.set(p, at);
    if (isListen && at && (!first.has(p) || at < first.get(p))) first.set(p, at);
  };
  // Listens, a service at a time: the same listen twice (a file picked again, and in its .zip) counts once.
  const listens = new Map();
  for (const r of found.filter((x) => x.listens)) {
    sources.add(r.source);
    const seen = listens.get(r.source) || new Map();
    for (const x of r.listens) if (x.title && Number.isFinite(x.at) && x.at > 0) seen.set(`${x.at}\n${sameName(x.artist)}\n${sameName(x.title)}`, x);
    listens.set(r.source, seen);
  }
  const found1 = new Map();
  const where = (x) => { const k = `${x.file || ''}\n${x.artist}\n${x.title}\n${x.album}`; if (!found1.has(k)) found1.set(k, find(shelf, x)); return found1.get(k); };
  for (const [source, seen] of listens) {
    const counted = new Set(Array.isArray(imports[source]) && typeof imports[source][0] === 'string' ? imports[source] : []);
    for (const x of seen.values()) {
      if (own[source] && x.at >= own[source]) { already++; continue; }
      const key = listenKey(source, x);
      if (counted.has(key)) { already++; continue; }
      const p = where(x);
      if (p) { play(p, 1, x.at, true); counted.add(key); } else missing++;
    }
    imports[source] = [...counted];
  }
  // Apple Music's totals: what each song's count has grown by since it was last imported.
  const totals = new Map();
  for (const r of found.filter((x) => x.totals)) {
    sources.add(r.source);
    for (const x of r.totals) {
      const p = where(x);
      if (!p) { missing += x.count; continue; }
      const had = totals.get(p) || { count: 0, at: null };
      totals.set(p, { count: had.count + x.count, at: Math.max(had.at || 0, x.at || 0) || null });
    }
  }
  if (totals.size) {
    const counted = imports.apple || {};
    for (const [p, { count, at }] of totals) {
      const more = count - (counted[p] || 0);
      if (more > 0) { play(p, more, at, false); counted[p] = count; } else already += count;
    }
    imports.apple = counted;
  }
  return {
    plays: { counts: byLast(counts, last), last: byLast(last, last), first: byLast(first, last) },
    imports, songs: [...songs], added, already, missing, sources: [...sources].map((s) => SOURCE_NAMES[s]),
  };
}

module.exports = { read, apply, csvRows, plainTitle };
