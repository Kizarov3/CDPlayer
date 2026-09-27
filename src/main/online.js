'use strict';
/**
 * Everything that talks to the network: cover-art lookup (iTunes → Deezer → Spotify → MusicBrainz), lyrics lookup
 * (Unison when word-timed → lrclib.net → Unison), and Spotify link/playlist resolution with the one-time browser sign-in. All optional — the player works offline.
 */
const http = require('http');
const crypto = require('crypto');
const { shell, nativeImage } = require('electron');
const store = require('./store');
const { searchVariants, nameVariants, bareTitle } = require('./track-names');
const { ttmlToLrc, ttmlDuration } = require('./ttml');

const USER_AGENT = 'CDPlayer/2.0 (open cover lookup)';
const TIMEOUT_MS = 8000;

async function fetchJson(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...(init.headers || {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; }
  return res.json();
}
async function fetchImageDataUrl(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return null;
  const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
  if (img.isEmpty()) return null;
  return `data:image/jpeg;base64,${img.toJPEG(90).toString('base64')}`;
}

function significantWords(text) {
  // Letters and digits of any script, so a Cyrillic or Japanese title is compared too rather than waved through.
  return new Set(String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3));
}
function wordOverlapRatio(query, result) {
  const q = significantWords(query);
  if (!q.size) return 1;
  const r = significantWords(result);
  let matched = 0;
  for (const w of q) if (r.has(w)) matched++;
  return matched / q.size;
}

// ---- Cover art ------------------------------------------------------------------------------------------------

// Each source's top hit: its cover address and what the hit is (title, artist), so it can be checked against the name.
async function itunesArt(query) {
  const json = await fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`);
  const hit = json.results && json.results[0];
  if (!hit || !hit.artworkUrl100) return null;
  return { url: hit.artworkUrl100.replace('100x100bb', '600x600bb'), title: hit.trackName || '', artist: hit.artistName || '' };
}
async function deezerArt(query) {
  const json = await fetchJson(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1`);
  const hit = json.data && json.data[0];
  const url = hit && ((hit.album && hit.album.cover_xl) || hit.cover_xl);
  if (!url) return null;
  return { url, title: hit.title || '', artist: hit.artist ? hit.artist.name : '' };
}
async function spotifyArt(query) {
  const token = await getSpotifyAppToken();
  if (!token) return null;
  const json = await fetchJson(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`, { headers: { Authorization: `Bearer ${token}` } });
  const item = json.tracks && json.tracks.items && json.tracks.items[0];
  const image = item && item.album && item.album.images && item.album.images[0];
  if (!image) return null;
  return { url: image.url, title: item.name || '', artist: (item.artists || []).map((a) => a.name).join(' ') };
}
const COVER_SOURCES = [['ITUNES', itunesArt], ['DEEZER', deezerArt], ['SPOTIFY', spotifyArt]];
const searchText = (v) => `${v.artist ? `${v.artist} ` : ''}${v.title}`;
const variantsOf = (name) => (typeof name === 'string' ? searchVariants(name).map((title) => ({ artist: null, title })) : nameVariants(name));

// A hit is this song when its title matches the title and its artist the artist (when there is one).
function sameSong(hit, artist, title) {
  return wordOverlapRatio(bareTitle(title), hit.title) >= 0.5 && (!artist || wordOverlapRatio(artist, hit.artist) >= 0.5);
}

// MusicBrainz + Cover Art Archive: the open, community-run catalogue, for the indie, local and older releases the
// stores don't carry. MusicBrainz asks for a User-Agent that says who is calling and at most one request a second.
const MB_USER_AGENT = 'CDPlayer/2 ( https://github.com/Kizarov3/CDPlayer )';
let mbNextSlot = 0;
async function mbFetch(pathAndQuery) {
  const wait = mbNextSlot - Date.now();
  mbNextSlot = Math.max(Date.now(), mbNextSlot) + 1100;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  return fetchJson(`https://musicbrainz.org/ws/2/${pathAndQuery}`, { headers: { 'User-Agent': MB_USER_AGENT } });
}
const musicBrainz = (entity, query) => mbFetch(`${entity}?query=${encodeURIComponent(query)}&fmt=json&limit=25`);
const musicBrainzGet = (what, inc) => mbFetch(`${what}?inc=${inc}&fmt=json`);
const phrase = (text) => `"${String(text).replace(/[\\"]/g, '\\$&')}"`;
const credited = (entry) => (entry['artist-credit'] || []).map((c) => c.name).join(' ');
const MB_TYPE_RANK = { Album: 0, EP: 1, Single: 2 };

// The album a song is on, as a MusicBrainz release group: the one named by the album tag when there is one, otherwise
// the earliest official studio release (albums before EPs before singles) with a recording of this song by this
// artist — so a song gets its album's cover, not a compilation's or a live bootleg's. → { id, title } or null.
async function musicBrainzAlbum({ artist, title, album }) {
  if (album) {
    const json = await musicBrainz('release-group', `releasegroup:${phrase(album)} AND artist:${phrase(artist)}`);
    const group = (json['release-groups'] || []).find((g) => g.score >= 90 && sameSong({ title: g.title, artist: credited(g) }, artist, album));
    if (group) return { id: group.id, title: group.title };
  }
  const json = await musicBrainz('recording', `recording:${phrase(bareTitle(title))} AND artist:${phrase(artist)}`);
  let best = null;
  for (const rec of json.recordings || []) {
    if (rec.score < 90 || !sameSong({ title: rec.title, artist: credited(rec) }, artist, title)) continue;
    for (const release of rec.releases || []) {
      const group = release['release-group'] || {};
      if (release.status !== 'Official' || (group['secondary-types'] || []).length || !(group['primary-type'] in MB_TYPE_RANK)) continue;
      const rank = [MB_TYPE_RANK[group['primary-type']], release.date || '9999'];
      if (!best || rank[0] < best.rank[0] || (rank[0] === best.rank[0] && rank[1] < best.rank[1])) best = { rank, id: group.id, title: group.title };
    }
  }
  return best;
}
// The album's front cover from the Cover Art Archive (a 404 when nobody has uploaded one). → data URL + address, or null.
async function musicBrainzArt(v) {
  const group = await musicBrainzAlbum(v);
  if (!group) return null;
  const url = `https://coverartarchive.org/release-group/${group.id}/front-500`;
  const cover = await fetchImageDataUrl(url);
  return cover ? { cover, url } : null;
}

// ---- Tags from MusicBrainz ------------------------------------------------------------------------------------------

const creditText = (credit) => (credit || []).map((c) => `${c.name}${c.joinphrase || ''}`).join('').trim();
// [a, b, …] sorts before [c, d, …]: compared item by item, the first difference decides.
function rankBefore(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}
const VERSION_WORDS = /\b(live|demo|remix|mix|instrumental|acoustic|karaoke|a cappella|acapella|edit|version|session|rehearsal)\b/i;

/**
 * The recording and release a file most likely is, from a MusicBrainz recording search: the same song by the same
 * artist, as long as the file (when its length is known), and not a live or demo take unless the title says it is.
 * Its release is the album the file's tag names, when one matches; otherwise the earliest official studio release,
 * albums before EPs before singles, not a box set. → { recording, release, medium, track } or null.
 */
function pickRecording(recordings, { artist, title, album, duration }) {
  let best = null;
  for (const rec of recordings || []) {
    if (rec.score < 85 || !sameSong({ title: rec.title, artist: creditText(rec['artist-credit']) }, artist, title)) continue;
    if (duration > 0 && rec.length && Math.abs(rec.length / 1000 - duration) > 5) continue;
    if (VERSION_WORDS.test(rec.disambiguation || '') && !VERSION_WORDS.test(title)) continue;
    for (const release of rec.releases || []) {
      const group = release['release-group'] || {};
      const albumMatch = !!album && wordOverlapRatio(bareTitle(album), release.title) >= 0.75 && wordOverlapRatio(release.title, album) >= 0.75;
      if (!albumMatch && (release.status !== 'Official' || (group['secondary-types'] || []).length || !(group['primary-type'] in MB_TYPE_RANK))) continue;
      const medium = (release.media || [])[0], track = medium && (medium.track || [])[0];
      // A release dated only by its year sorts after the dated ones of that year (it's usually an obscure pressing), and
      // a box set after an album on one or two discs.
      const date = /^\d{4}$/.test(release.date || '') ? `${release.date}-99` : release.date || '9999';
      const rank = [albumMatch ? 0 : 1, MB_TYPE_RANK[group['primary-type']] ?? 3, (release.count || 1) > 2 ? 1 : 0, date, -(rec.score || 0)];
      if (!best || rankBefore(rank, best.rank)) best = { rank, recording: rec, release, medium, track };
    }
  }
  return best;
}

/**
 * What MusicBrainz says a song's tags should be, for the Tags panel: { title, artist, album, albumArtist, year, track,
 * trackCount, disc, discCount, genre, label, musicBrainzTrackId, musicBrainzReleaseId, coverUrl } — or null when it
 * doesn't know the song. { networkError: true } when it couldn't be asked.
 */
async function lookupTags({ artist, title, album, duration, guessed }) {
  let networkError = false;
  for (const v of nameVariants({ artist, title, guessed }).filter((x) => x.artist)) {
    // A famous song has hundreds of recordings (mostly live), in no useful order: when the file's length is known, ask
    // only for official releases of a recording that long first — that's every candidate on one page.
    const base = `recording:${phrase(bareTitle(v.title))} AND artist:${phrase(v.artist)}`;
    const queries = duration > 0 ? [`${base} AND status:official AND dur:[${Math.round(duration - 5) * 1000} TO ${Math.round(duration + 5) * 1000}]`, base] : [base];
    let found = null;
    for (const query of queries) {
      try {
        const json = await mbFetch(`recording?query=${encodeURIComponent(query)}&fmt=json&limit=100`);
        found = pickRecording(json.recordings, { ...v, album: v.artist === artist ? album : null, duration });
      } catch { networkError = true; }
      if (found) break;
    }
    if (!found) continue;
    let release = found.release;
    try {
      release = await musicBrainzGet(`release/${found.release.id}`, 'artist-credits+labels+release-groups+genres');
    } catch { /* the search's own summary of the release will do */ }
    const genres = [...(release.genres || []), ...((release['release-group'] || {}).genres || [])].sort((a, b) => b.count - a.count);
    const label = (release['label-info'] || []).map((l) => l.label && l.label.name).find(Boolean);
    const year = /\d{4}/.exec(release.date || found.release.date || '');
    const genre = genres[0] ? genres[0].name.replace(/\b\w/g, (ch) => ch.toUpperCase()) : null;
    return {
      title: found.recording.title,
      artist: creditText(found.recording['artist-credit']),
      album: release.title,
      albumArtist: creditText(release['artist-credit'] || found.release['artist-credit']) || null,
      year: year ? parseInt(year[0], 10) : null,
      track: found.track ? parseInt(found.track.number, 10) || found.medium['track-offset'] + 1 : null,
      trackCount: found.medium ? found.medium['track-count'] : null,
      disc: found.medium ? found.medium.position : null,
      discCount: (release.media || []).length || found.release.count || null,
      genre, label: label || null,
      musicBrainzTrackId: found.recording.id, musicBrainzReleaseId: release.id,
      coverUrl: `https://coverartarchive.org/release/${release.id}/front-500`,
      name: v,
    };
  }
  return networkError ? { networkError: true } : null;
}
/** A cover for the Tags panel, by address (the Cover Art Archive's, from lookupTags). → data URL or null. */
async function coverFromUrl(url) {
  if (!/^https:\/\/coverartarchive\.org\//.test(url)) return null;
  return fetchImageDataUrl(url).catch(() => null);
}

/**
 * The cover for { artist, title, album, guessed } (or a plain name string). A song whose tags name its album gets
 * that album's cover first — searching for the song finds it on remix albums and best-ofs too, and those can come
 * first. Otherwise every guess from nameVariants() on iTunes, Deezer and Spotify, trusting a hit whose title and
 * artist match that guess — and reporting the guess (`name`), so a file named "Title - Artist" can be shown the right
 * way round. Then MusicBrainz, for every guess that has an artist. If nothing matches, the first iTunes/Deezer hit for
 * the name as given is used, as before (no `name` then).
 */
async function findCover(name) {
  let networkError = false, fallback = null;
  if (name && typeof name === 'object' && name.artist && name.album && !name.guessed) {
    const album = await findAlbumCoverUrl({ artist: name.artist, album: name.album }).catch(() => ({ networkError: true }));
    if (album && album.url) {
      const cover = await fetchImageDataUrl(album.url).catch(() => null);
      if (cover) return { cover, url: album.url, source: album.source, name: { artist: name.artist, title: name.title } };
    }
    if (album && album.networkError) networkError = true;
  }
  const variants = variantsOf(name);
  for (const v of variants) {
    for (const [label, art] of COVER_SOURCES) {
      let hit = null;
      try { hit = await art(searchText(v)); } catch { networkError = true; }
      if (!hit) continue;
      if (sameSong(hit, v.artist, v.title)) {
        const cover = await fetchImageDataUrl(hit.url).catch(() => null);
        if (cover) return { cover, url: hit.url, source: label, name: v };
      } else if (!fallback && label !== 'SPOTIFY') fallback = { hit, label };
    }
  }
  const album = typeof name === 'object' && name ? name.album : null;
  for (const v of variants.filter((x) => x.artist)) {
    try {
      const found = await musicBrainzArt({ ...v, album: v.artist === name.artist ? album : null });
      if (found) return { ...found, source: 'MUSICBRAINZ', name: v };
    } catch { networkError = true; }
  }
  if (fallback) {
    const cover = await fetchImageDataUrl(fallback.hit.url).catch(() => null);
    if (cover) return { cover, url: fallback.hit.url, source: fallback.label };
  }
  return { cover: null, source: null, networkError };
}

// ---- Album covers, for the shelf ------------------------------------------------------------------------------------

// A hit is this album when its title and this one share most of their words both ways (an edition in brackets
// aside), and it's by this artist — so a song's other album, or another band's album of the same name, never is.
function sameAlbum(hit, artist, album) {
  const a = bareTitle(album), b = bareTitle(hit.title);
  return wordOverlapRatio(a, b) >= 0.5 && wordOverlapRatio(b, a) >= 0.5 && wordOverlapRatio(artist, hit.artist) >= 0.5;
}
async function itunesAlbums(query) {
  const json = await fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=10`);
  return (json.results || []).filter((r) => r.artworkUrl100)
    .map((r) => ({ url: r.artworkUrl100.replace('100x100bb', '600x600bb'), title: r.collectionName || '', artist: r.artistName || '' }));
}
async function deezerAlbums(query) {
  const json = await fetchJson(`https://api.deezer.com/search/album?q=${encodeURIComponent(query)}&limit=10`);
  return (json.data || []).filter((r) => r.cover_xl).map((r) => ({ url: r.cover_xl, title: r.title || '', artist: r.artist ? r.artist.name : '' }));
}
async function musicBrainzAlbums({ artist, album }) {
  const json = await musicBrainz('release-group', `releasegroup:${phrase(album)} AND artist:${phrase(artist)}`);
  return (json['release-groups'] || []).filter((g) => g.score >= 90)
    .map((g) => ({ url: `https://coverartarchive.org/release-group/${g.id}/front-500`, title: g.title || '', artist: credited(g) }));
}
const ALBUM_SOURCES = [['ITUNES', (q) => itunesAlbums(`${q.artist} ${q.album}`)], ['DEEZER', (q) => deezerAlbums(`${q.artist} ${q.album}`)], ['MUSICBRAINZ', musicBrainzAlbums]];

/**
 * Where the cover of the album { artist, album } is: the first hit on iTunes, Deezer, then MusicBrainz that is this
 * album. → { url, source }, null when none of them has it, or { networkError: true } when one couldn't be asked.
 */
async function findAlbumCoverUrl({ artist, album }) {
  let networkError = false;
  for (const [source, search] of ALBUM_SOURCES) {
    let hits = [];
    try { hits = await search({ artist, album }); } catch { networkError = true; }
    const hit = hits.find((h) => sameAlbum(h, artist, album));
    if (hit) return { url: hit.url, source };
  }
  return networkError ? { networkError: true } : null;
}
/** The album's cover itself, for the shelf. → { cover (data URL) } / { cover: null, networkError? }. */
async function findAlbumCover(query) {
  const found = await findAlbumCoverUrl(query);
  if (!found || found.networkError) return { cover: null, networkError: !!(found && found.networkError) };
  try { return { cover: await fetchImageDataUrl(found.url), source: found.source }; } catch { return { cover: null, networkError: true }; }
}

// Just the web address of a song's cover, for Discord (which only shows pictures by address) when the cover is inside
// the file. Stricter than findCover: only a hit matching a guess that has an artist, never a fallback — iTunes happily
// answers "Nova Drift – Solar Flare" with another band's Solar Flare, and that must not show on someone's profile.
// Answers are remembered for the session, but not after a network error. → url or null.
const coverUrls = new Map();
async function findCoverUrl(name) {
  const key = `${name.artist || ''}\n${name.title || ''}\n${!!name.guessed}`;
  if (!name.title) return null;
  if (coverUrls.has(key)) return coverUrls.get(key);
  let url = null, networkError = false;
  search: for (const v of nameVariants(name).filter((x) => x.artist)) {
    for (const [, art] of COVER_SOURCES.slice(0, 2)) {
      try {
        const hit = await art(searchText(v));
        if (hit && sameSong(hit, v.artist, v.title)) { url = hit.url; break search; }
      } catch { networkError = true; }
    }
  }
  if (url || !networkError) {
    if (coverUrls.size >= 500) coverUrls.delete(coverUrls.keys().next().value);
    coverUrls.set(key, url);
  }
  return url;
}

// ---- Lyrics ---------------------------------------------------------------------------------------------------

// The entry with lyrics whose length is closest to the file's (a radio edit and an extended mix have different
// timings), among those that are this song. → { lyrics, entry } or null.
function pickLrclib(json, { artist, title, duration }) {
  const entries = (Array.isArray(json) ? json : [json]).filter((e) => e && (e.syncedLyrics || e.plainLyrics)
    && sameSong({ title: e.trackName || e.name || '', artist: e.artistName || '' }, artist, title));
  if (!entries.length) return null;
  if (duration > 0) entries.sort((x, y) => Math.abs((x.duration || 0) - duration) - Math.abs((y.duration || 0) - duration));
  return entries[0].syncedLyrics || entries[0].plainLyrics;
}

// Unison (the lyrics Better Lyrics users time by hand, as TTML): only when its song is this one and, when both lengths
// are known, its recording is within a few seconds of the file — so the lines land on the right beat. → LRC or null.
const UNREACHABLE = Symbol('unreachable'); // Unison didn't answer at all (offline, a timeout): don't ask it again
async function unisonLyrics({ artist, title, album, duration }) {
  if (!artist) return null;
  let url = `https://unison.boidu.dev/lyrics?song=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`;
  if (album) url += `&album=${encodeURIComponent(album)}`;
  if (duration > 0) url += `&duration=${Math.round(duration)}`;
  let json;
  try { json = await fetchJson(url); } catch (e) { return e && e.status ? null : UNREACHABLE; } // 404 = nobody has written them yet
  const data = json && json.data;
  if (!data || typeof data.lyrics !== 'string' || !sameSong({ title: data.song || '', artist: data.artist || '' }, artist, title)) return null;
  if (data.format === 'lrc') return data.lyrics.trim() || null;
  if (data.format !== 'ttml') return null;
  const length = ttmlDuration(data.lyrics) || data.duration;
  if (duration > 0 && length > 0 && Math.abs(length - duration) > 4) return null;
  return ttmlToLrc(data.lyrics) || null;
}

const wordTimed = (lrc) => /<\d{1,3}:\d{2}/.test(lrc);

/**
 * Lyrics for { title, artist, album, duration, guessed }: Unison's first when they time every word (only Unison
 * does — Karaoke fills them word by word). Otherwise lrclib.net's exact entry for the name as given (with album and
 * length), then a search for every guess from nameVariants(), then Unison's line-timed lyrics, then a free-text
 * lrclib search. Only entries that are this song count. → { lyrics, name, source } (name = the guess that found
 * them) or null.
 */
async function findLyrics({ title, artist, album, duration, guessed }) {
  const variants = nameVariants({ artist, title, guessed });
  if (!variants.length) return null;
  const first = variants[0];
  let unisonLines = null;
  for (const v of variants.filter((x) => x.artist)) {
    const lyrics = await unisonLyrics({ ...v, album: v.artist === artist ? album : null, duration });
    if (lyrics === UNREACHABLE) break;
    if (lyrics && wordTimed(lyrics)) return { lyrics, name: v, source: 'Unison' };
    if (lyrics && !unisonLines) unisonLines = { lyrics, name: v, source: 'Unison' };
  }
  if (first.artist) {
    let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(first.title)}&artist_name=${encodeURIComponent(first.artist)}`;
    if (album) url += `&album_name=${encodeURIComponent(album)}`;
    if (duration > 0) url += `&duration=${Math.round(duration)}`;
    try {
      const lyrics = pickLrclib(await fetchJson(url), { ...first, duration });
      if (lyrics) return { lyrics, name: first, source: 'lrclib.net' };
    } catch { /* 404 = no exact match; search below */ }
  }
  for (const v of variants) {
    try {
      let url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(v.title)}`;
      if (v.artist) url += `&artist_name=${encodeURIComponent(v.artist)}`;
      const lyrics = pickLrclib(await fetchJson(url), { ...v, duration });
      if (lyrics) return { lyrics, name: v, source: 'lrclib.net' };
    } catch { /* try the next guess */ }
  }
  if (unisonLines) return unisonLines;
  try {
    const lyrics = pickLrclib(await fetchJson(`https://lrclib.net/api/search?q=${encodeURIComponent(searchText(first))}`), { ...first, duration });
    if (lyrics) return { lyrics, name: first, source: 'lrclib.net' };
  } catch { /* nothing */ }
  return null;
}

// ---- Spotify ----------------------------------------------------------------------------------------------------
// spotify.txt: line 1 Client ID, line 2 Client Secret (from a free app at developer.spotify.com/dashboard), line 3
// the user refresh token written after "Connect Spotify account". Same file the Java version used.

const SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:8080/callback';
const spotify = { appToken: null, appExpiry: 0, userToken: null, userExpiry: 0 };

function spotifyCredentials() {
  const l = (store.readText(store.FILES.spotify) || '').split(/\r?\n/).map((s) => s.trim());
  return { clientId: l[0] || '', clientSecret: l[1] || '', refreshToken: l[2] || '' };
}
function saveRefreshToken(token) {
  const c = spotifyCredentials();
  store.writeText(store.FILES.spotify, `${c.clientId}\n${c.clientSecret}\n${token}\n`);
}
async function postToken(body) {
  const { clientId, clientSecret } = spotifyCredentials();
  return fetchJson('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}
async function getSpotifyAppToken() {
  const { clientId, clientSecret } = spotifyCredentials();
  if (!clientId || !clientSecret) return null;
  if (spotify.appToken && Date.now() < spotify.appExpiry) return spotify.appToken;
  const json = await postToken('grant_type=client_credentials');
  if (!json.access_token) return null;
  spotify.appToken = json.access_token;
  spotify.appExpiry = Date.now() + Math.max(0, (json.expires_in || 3600) - 60) * 1000;
  return spotify.appToken;
}
async function getSpotifyUserToken() {
  if (spotify.userToken && Date.now() < spotify.userExpiry) return spotify.userToken;
  const { refreshToken } = spotifyCredentials();
  if (!refreshToken) return null;
  const json = await postToken(`grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`);
  if (!json.access_token) return null;
  spotify.userToken = json.access_token;
  spotify.userExpiry = Date.now() + Math.max(0, (json.expires_in || 3600) - 60) * 1000;
  if (json.refresh_token) saveRefreshToken(json.refresh_token); // Spotify sometimes rotates it
  return spotify.userToken;
}

const TRACK_URL = /open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/([a-zA-Z0-9]+)|spotify:track:([a-zA-Z0-9]+)/;
const PLAYLIST_URL = /open\.spotify\.com\/(?:intl-[a-z]+\/)?playlist\/([a-zA-Z0-9]+)|spotify:playlist:([a-zA-Z0-9]+)/;
function classifySpotifyLink(text) {
  let m = TRACK_URL.exec(text);
  if (m) return { kind: 'track', id: m[1] || m[2] };
  m = PLAYLIST_URL.exec(text);
  if (m) return { kind: 'playlist', id: m[1] || m[2] };
  return null;
}

/** Resolves a Spotify link to [{title, artist}] — or {needsSignIn: true} for a playlist without a user token. */
async function resolveSpotifyLink(text) {
  const link = classifySpotifyLink(text);
  if (!link) return { error: 'NOT A SPOTIFY LINK' };
  if (link.kind === 'track') {
    const token = await getSpotifyAppToken();
    if (!token) return { error: 'SPOTIFY APP CREDENTIALS NOT CONFIGURED' };
    const t = await fetchJson(`https://api.spotify.com/v1/tracks/${link.id}`, { headers: { Authorization: `Bearer ${token}` } });
    return { tracks: [{ title: t.name, artist: t.artists && t.artists[0] ? t.artists[0].name : '' }] };
  }
  let token = null;
  try { token = await getSpotifyUserToken(); } catch { token = null; }
  if (!token) return { needsSignIn: true };
  const tracks = [];
  let url = `https://api.spotify.com/v1/playlists/${link.id}/tracks?limit=50&fields=${encodeURIComponent('items(track(name,artists(name))),next')}`;
  for (let pages = 0; url && pages < 20; pages++) {
    const json = await fetchJson(url, { headers: { Authorization: `Bearer ${token}` } });
    for (const item of json.items || []) {
      if (item.track && item.track.name) tracks.push({ title: item.track.name, artist: item.track.artists && item.track.artists[0] ? item.track.artists[0].name : '' });
    }
    url = json.next;
  }
  return { tracks };
}

let signInInProgress = null;
/** Opens Spotify's login page in the browser and waits (up to 3 minutes) for the redirect back to 127.0.0.1:8080. */
function spotifySignIn() {
  if (signInInProgress) return signInInProgress;
  signInInProgress = (async () => {
    const { clientId } = spotifyCredentials();
    if (!clientId) return 'SPOTIFY APP CREDENTIALS NOT CONFIGURED';
    const state = crypto.randomBytes(8).toString('hex');
    const page = (h, p) => `<html><body style="font-family:sans-serif"><h2>${h}</h2><p>${p}</p></body></html>`;
    try {
      const code = await new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
          const u = new URL(req.url, SPOTIFY_REDIRECT_URI);
          if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
          const error = u.searchParams.get('error'), got = u.searchParams.get('code');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          if (error) { res.end(page('Spotify sign-in was cancelled', 'You can close this tab and try again in CDPlayer.')); finish(new Error(error)); }
          else if (got && u.searchParams.get('state') === state) { res.end(page('Connected to Spotify', 'You can close this tab and return to CDPlayer.')); finish(null, got); }
          else { res.end(page('Something went wrong', 'You can close this tab and try again in CDPlayer.')); finish(new Error('state mismatch')); }
        });
        const timer = setTimeout(() => finish(new Error('timed out waiting for sign-in')), 180000);
        function finish(err, value) { clearTimeout(timer); server.close(); err ? reject(err) : resolve(value); }
        server.on('error', (e) => finish(e));
        server.listen(8080, '127.0.0.1', () => {
          const auth = `https://accounts.spotify.com/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}`
            + `&scope=${encodeURIComponent('playlist-read-private playlist-read-collaborative')}`
            + `&redirect_uri=${encodeURIComponent(SPOTIFY_REDIRECT_URI)}&state=${state}`;
          shell.openExternal(auth);
        });
      });
      const json = await postToken(`grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(SPOTIFY_REDIRECT_URI)}`);
      if (!json.access_token || !json.refresh_token) throw new Error('unexpected response');
      spotify.userToken = json.access_token;
      spotify.userExpiry = Date.now() + Math.max(0, (json.expires_in || 3600) - 60) * 1000;
      saveRefreshToken(json.refresh_token);
      return 'SPOTIFY CONNECTED';
    } catch (e) {
      return `SPOTIFY SIGN-IN FAILED${e && e.message ? ` — ${e.message.toUpperCase()}` : ''}`;
    }
  })().finally(() => { signInInProgress = null; });
  return signInInProgress;
}

module.exports = { findCover, findCoverUrl, findAlbumCover, findAlbumCoverUrl, findLyrics, lookupTags, pickRecording, coverFromUrl, mbFetch, resolveSpotifyLink, spotifySignIn, classifySpotifyLink, wordOverlapRatio };
