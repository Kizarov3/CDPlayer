'use strict';
/**
 * Everything that talks to the network: cover-art lookup (iTunes → Deezer → Spotify), lyrics lookup (lrclib.net),
 * and Spotify link/playlist resolution with the one-time browser sign-in. All optional — the player works offline.
 */
const http = require('http');
const crypto = require('crypto');
const { shell, nativeImage } = require('electron');
const store = require('./store');
const { searchVariants } = require('./track-names');

const USER_AGENT = 'CDPlayer/2.0 (open cover lookup)';
const TIMEOUT_MS = 8000;

async function fetchJson(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...(init.headers || {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; }
  return res.json();
}
// → { cover (data URL), url (where it came from — Discord shows covers by web address) }, or null.
async function fetchCover(url) {
  const cover = await fetchImageDataUrl(url);
  return cover ? { cover, url } : null;
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

// The top hit's cover address, plus what that hit is (song, artist, album) so a caller can check it's the right one.
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
async function searchItunesCover(query) { const art = await itunesArt(query); return art ? fetchCover(art.url) : null; }
async function searchDeezerCover(query) { const art = await deezerArt(query); return art ? fetchCover(art.url) : null; }
async function searchSpotifyCover(query) {
  const token = await getSpotifyAppToken();
  if (!token) return null;
  const json = await fetchJson(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`, { headers: { Authorization: `Bearer ${token}` } });
  const item = json.tracks && json.tracks.items && json.tracks.items[0];
  if (!item) return null;
  // Spotify's search is fuzzy enough to return an unrelated "closest" hit rather than nothing — only accept it when
  // enough of the query's words actually show up in the result.
  const described = `${item.name} ${(item.artists || []).map((a) => a.name).join(' ')} ${item.album ? item.album.name : ''}`;
  if (wordOverlapRatio(query, described) < 0.3) return null;
  const image = item.album && item.album.images && item.album.images[0];
  return image ? fetchCover(image.url) : null;
}

// Each source with the full cleaned name first; if none has it, all of them again with the plainer variant.
async function findCover(query) {
  let networkError = false;
  for (const q of searchVariants(query)) {
    for (const [label, search] of [['ITUNES', searchItunesCover], ['DEEZER', searchDeezerCover], ['SPOTIFY', searchSpotifyCover]]) {
      try {
        const found = await search(q);
        if (found) return { cover: found.cover, url: found.url, source: label };
      } catch { networkError = true; }
    }
  }
  return { cover: null, source: null, networkError };
}

// Just the web address of a song's cover, for Discord (which only shows pictures by address) when the cover is inside
// the file. Stricter than findCover: the hit's title must match the song's title and its artist the song's artist, so
// someone else's album never shows up on the user's profile (iTunes happily answers "Nova Drift – Solar Flare" with a
// different band's Solar Flare). Answers are remembered for the session, but not after a network error. → url or null.
const coverUrls = new Map();
const bareTitle = (t) => String(t).replace(/\s*[([][^)\]]*[)\]]/g, ' ').replace(/\s+(?:feat\.?|ft\.?|featuring)\s.*$/i, '');
function sameSong(hit, artist, title) {
  return wordOverlapRatio(bareTitle(title), hit.title) >= 0.5 && (!artist || wordOverlapRatio(artist, hit.artist) >= 0.5);
}
async function findCoverUrl({ artist, title }) {
  const key = `${artist || ''}\n${title || ''}`;
  if (!title) return null;
  if (coverUrls.has(key)) return coverUrls.get(key);
  let url = null, networkError = false;
  search: for (const q of searchVariants(`${artist ? `${artist} ` : ''}${title}`)) {
    for (const art of [itunesArt, deezerArt]) {
      try {
        const hit = await art(q);
        if (hit && sameSong(hit, artist, title)) { url = hit.url; break search; }
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

function pickLrclib(json) {
  const entry = Array.isArray(json) ? json.find((e) => e.syncedLyrics || e.plainLyrics) : json;
  if (!entry) return null;
  return entry.syncedLyrics || entry.plainLyrics || null;
}
async function findLyrics({ title, artist, album }) {
  if (!title) return null;
  // Exact match first (title + artist + album), then a broader title-only search.
  let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(title)}`;
  if (artist) url += `&artist_name=${encodeURIComponent(artist)}`;
  if (album) url += `&album_name=${encodeURIComponent(album)}`;
  try {
    const exact = pickLrclib(await fetchJson(url));
    if (exact) return exact;
  } catch { /* 404 = no exact match; fall through */ }
  try {
    let search = `https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}`;
    if (artist) search += `&artist_name=${encodeURIComponent(artist)}`;
    return pickLrclib(await fetchJson(search));
  } catch { return null; }
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

module.exports = { findCover, findCoverUrl, findLyrics, resolveSpotifyLink, spotifySignIn, classifySpotifyLink, wordOverlapRatio };
