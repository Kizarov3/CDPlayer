'use strict';
/**
 * Spotify: the user's own developer app (Client ID + Secret), the browser sign-in, tokens, and every Web API call —
 * for cover art and link import (online.js) and for playing Spotify discs (the SPOTIFY panel). Tokens stay here in
 * the main process; the page only ever gets a short-lived access token for the Web Playback SDK.
 *
 * spotify.txt: line 1 Client ID, line 2 Client Secret, line 3 the refresh token from "Connect Spotify", line 4 the
 * scopes it was granted. The Java version wrote the first three; a token without line 4 predates playback.
 */
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');
const store = require('./store');

const REDIRECT_URI = 'http://127.0.0.1:8080/callback';
const SCOPES = ['streaming', 'user-read-email', 'user-read-private', 'user-library-read', 'user-modify-playback-state',
  'user-read-playback-state', 'playlist-read-private', 'playlist-read-collaborative'];
const USER_AGENT = 'CDPlayer/2.0';
const TIMEOUT_MS = 8000;
const tokens = { app: null, appExpiry: 0, user: null, userExpiry: 0 };

async function fetchJson(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...(init.headers || {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; }
  return res.status === 204 ? null : res.json();
}

function credentials() {
  const l = (store.readText(store.FILES.spotify) || '').split(/\r?\n/).map((s) => s.trim());
  return { clientId: l[0] || '', clientSecret: l[1] || '', refreshToken: l[2] || '', scopes: (l[3] || '').split(/\s+/).filter(Boolean) };
}
function writeCredentials(c) {
  store.writeText(store.FILES.spotify, `${c.clientId}\n${c.clientSecret}\n${c.refreshToken}\n${c.scopes.join(' ')}\n`);
}
function status() {
  const c = credentials();
  const connected = !!c.refreshToken;
  return { configured: !!(c.clientId && c.clientSecret), connected, reconnectNeeded: connected && !SCOPES.every((s) => c.scopes.includes(s)) };
}
/** The Client ID and Secret from the SPOTIFY panel. A different app's sign-in isn't valid for this one: dropped. */
function saveCredentials({ clientId, clientSecret }) {
  const old = credentials(), id = String(clientId || '').trim(), secret = String(clientSecret || '').trim();
  const same = id === old.clientId;
  writeCredentials({ clientId: id, clientSecret: secret, refreshToken: same ? old.refreshToken : '', scopes: same ? old.scopes : [] });
  resetForTests();
  return status();
}
function resetForTests() { Object.assign(tokens, { app: null, appExpiry: 0, user: null, userExpiry: 0 }); }

async function postToken(body) {
  const { clientId, clientSecret } = credentials();
  return fetchJson('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}
const expiry = (json) => Date.now() + Math.max(0, (json.expires_in || 3600) - 60) * 1000;
async function getSpotifyAppToken() {
  const { clientId, clientSecret } = credentials();
  if (!clientId || !clientSecret) return null;
  if (tokens.app && Date.now() < tokens.appExpiry) return tokens.app;
  const json = await postToken('grant_type=client_credentials');
  if (!json || !json.access_token) return null;
  tokens.app = json.access_token; tokens.appExpiry = expiry(json);
  return tokens.app;
}
async function getSpotifyUserToken() {
  if (tokens.user && Date.now() < tokens.userExpiry) return tokens.user;
  const c = credentials();
  if (!c.refreshToken) return null;
  const json = await postToken(`grant_type=refresh_token&refresh_token=${encodeURIComponent(c.refreshToken)}`);
  if (!json || !json.access_token) return null;
  tokens.user = json.access_token; tokens.userExpiry = expiry(json);
  if (json.refresh_token) writeCredentials({ ...credentials(), refreshToken: json.refresh_token }); // Spotify sometimes rotates it
  return tokens.user;
}
/** For the Web Playback SDK's getOAuthToken: asked afresh each time, so a long session gets refreshed tokens. */
async function accessToken() {
  try { return await getSpotifyUserToken(); } catch { return null; }
}
function forgetUserToken() { tokens.user = null; tokens.userExpiry = 0; }

// ---- Links (SEARCH's paste-a-link import) -------------------------------------------------------------------------

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
  const r = await discTracks({ kind: 'playlist', id: link.id });
  if (r.error === 'SIGN_IN') return { needsSignIn: true };
  if (r.error === 'NOT_SHARED') return { tracks: [] };
  if (r.error) return { error: r.error };
  return { tracks: r.tracks.map((t) => ({ title: t.title, artist: (t.artist || '').split(', ')[0] })) };
}

let signInInProgress = null;
/** Opens Spotify's login page in the browser and waits (up to 3 minutes) for the redirect back to 127.0.0.1:8080. */
function spotifySignIn() {
  if (signInInProgress) return signInInProgress;
  signInInProgress = (async () => {
    const { clientId } = credentials();
    if (!clientId) return 'SPOTIFY APP CREDENTIALS NOT CONFIGURED';
    const state = crypto.randomBytes(8).toString('hex');
    const page = (h, p) => `<html><body style="font-family:sans-serif"><h2>${h}</h2><p>${p}</p></body></html>`;
    try {
      const code = await new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
          const u = new URL(req.url, REDIRECT_URI);
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
          const auth = authorizeUrl(clientId, state);
          shell.openExternal(auth);
        });
      });
      const json = await postToken(`grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`);
      if (!json.access_token || !json.refresh_token) throw new Error('unexpected response');
      tokens.user = json.access_token;
      tokens.userExpiry = Date.now() + Math.max(0, (json.expires_in || 3600) - 60) * 1000;
      const granted = String(json.scope || SCOPES.join(' ')).split(/\s+/).filter(Boolean);
      writeCredentials({ ...credentials(), refreshToken: json.refresh_token, scopes: granted });
      return 'SPOTIFY CONNECTED';
    } catch (e) {
      return `SPOTIFY SIGN-IN FAILED${e && e.message ? ` — ${e.message.toUpperCase()}` : ''}`;
    }
  })().finally(() => { signInInProgress = null; });
  return signInInProgress;
}

// ---- The user's library (the SPOTIFY panel) ----------------------------------------------------------------------

const API = 'https://api.spotify.com/v1';
class SpotifyError extends Error { constructor(code) { super(code); this.code = code; } }
/** A Web API call as the signed-in user: refreshed once on a 401, then 'SIGN_IN'; no network → 'OFFLINE'. */
async function userApi(pathAndQuery, init = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let token;
    try { token = await getSpotifyUserToken(); } catch (e) { throw new SpotifyError(e.status ? 'SIGN_IN' : 'OFFLINE'); }
    if (!token) throw new SpotifyError('SIGN_IN');
    try {
      return await fetchJson(pathAndQuery.startsWith('http') ? pathAndQuery : `${API}${pathAndQuery}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
    } catch (e) {
      if (e.status === 401 && attempt === 0) { forgetUserToken(); continue; }
      if (e.status === 401) throw new SpotifyError('SIGN_IN');
      if (!e.status) throw new SpotifyError('OFFLINE');
      throw e;
    }
  }
  throw new SpotifyError('SIGN_IN');
}
const asError = (e) => ({ error: e.code || (e.status ? `HTTP ${e.status}` : 'OFFLINE') });
const nextOffset = (json) => { if (!json.next) return null; const n = Number(new URL(json.next).searchParams.get('offset')); return Number.isFinite(n) ? n : null; };
const artistNames = (a) => (a || []).map((x) => x.name).filter(Boolean).join(', ');
const biggest = (images) => { const list = (images || []).filter((i) => i && i.url); list.sort((a, b) => (b.width || 0) - (a.width || 0)); return list.length ? list[0].url : null; };
const albumItem = (a) => ({ kind: 'album', id: a.id, name: a.name, owner: artistNames(a.artists), total: a.total_tracks || 0 });
const playlistItem = (p) => ({ kind: 'playlist', id: p.id, name: p.name, owner: (p.owner && (p.owner.display_name || p.owner.id)) || '', total: ((p.items || p.tracks) || {}).total || 0 });

async function savedAlbums(offset = 0) {
  try {
    const json = await userApi(`/me/albums?limit=50&offset=${offset}`);
    return { items: (json.items || []).filter((i) => i && i.album).map((i) => albumItem(i.album)), next: nextOffset(json) };
  } catch (e) { return asError(e); }
}
async function playlists(offset = 0) {
  try {
    const json = await userApi(`/me/playlists?limit=50&offset=${offset}`);
    return { items: (json.items || []).filter(Boolean).map(playlistItem), next: nextOffset(json) };
  } catch (e) { return asError(e); }
}
async function search(query) {
  try {
    const json = await userApi(`/search?q=${encodeURIComponent(query)}&type=album,playlist&limit=10`);
    return { items: [...((json.albums || {}).items || []).filter(Boolean).map(albumItem), ...((json.playlists || {}).items || []).filter(Boolean).map(playlistItem)] };
  } catch (e) { return asError(e); }
}

const discTrack = (t, album) => ({
  uri: t.uri, title: t.name, artist: artistNames(t.artists) || album.artist, album: album.name,
  durationMs: t.duration_ms || 0, cover: album.cover,
});
async function albumTracks(id) {
  const a = await userApi(`/albums/${encodeURIComponent(id)}`);
  const album = { name: a.name, artist: artistNames(a.artists), cover: biggest(a.images) };
  const tracks = ((a.tracks || {}).items || []).map((t) => discTrack(t, album));
  let url = (a.tracks || {}).next;
  for (let pages = 0; url && pages < 20; pages++) {
    const page = await userApi(url);
    tracks.push(...(page.items || []).map((t) => discTrack(t, album)));
    url = page.next;
  }
  return tracks;
}
async function playlistTracks(id) {
  // February 2026: /items with each song under `item`; apps from before keep /tracks with `track`.
  let url = `/playlists/${encodeURIComponent(id)}/items?limit=50`;
  try { await userApi(url.replace('limit=50', 'limit=1')); } catch (e) { if (e.status === 404) url = `/playlists/${encodeURIComponent(id)}/tracks?limit=50`; else throw e; }
  const tracks = [];
  for (let pages = 0; url && pages < 40; pages++) {
    const page = await userApi(url);
    for (const entry of page.items || []) {
      const t = entry && (entry.item || entry.track);
      if (!t || entry.is_local || t.is_local || (t.type && t.type !== 'track') || !/^spotify:track:/.test(t.uri || '')) continue;
      const album = { name: (t.album || {}).name || '', artist: '', cover: biggest((t.album || {}).images) };
      tracks.push(discTrack(t, album));
    }
    url = page.next;
  }
  return tracks;
}
/** An album's or playlist's songs, as a disc. A playlist the user only follows comes back empty: 'NOT_SHARED'. */
async function discTracks({ kind, id }) {
  try {
    const tracks = kind === 'album' ? await albumTracks(id) : await playlistTracks(id);
    if (!tracks.length) return { error: kind === 'playlist' ? 'NOT_SHARED' : 'EMPTY' };
    return { tracks };
  } catch (e) {
    if (kind === 'playlist' && (e.status === 403 || e.status === 404)) return { error: 'NOT_SHARED' };
    return asError(e);
  }
}

/** Plays `uris` in order on the SDK's device from `positionMs` into the first. Spotify answers 403 without Premium. */
async function startPlayback({ deviceId, uris, positionMs }) {
  try {
    await userApi(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uris, position_ms: Math.max(0, Math.round(positionMs || 0)) }),
    });
    return { ok: true, status: 204 };
  } catch (e) {
    return { ok: false, status: e.status || (e.code === 'SIGN_IN' ? 401 : 0) };
  }
}

/** A cover from Spotify's image host as a data URL (the page reads its pixels for the AUTO theme). */
async function coverDataUrl(url) {
  if (!/^https:\/\/i\.scdn\.co\/image\//.test(String(url))) return null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || 'image/jpeg';
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  } catch { return null; }
}

function authorizeUrl(clientId, state) {
  return `https://accounts.spotify.com/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}`
    + `&scope=${encodeURIComponent(SCOPES.join(' '))}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}`;
}

module.exports = {
  SCOPES, REDIRECT_URI, credentials, status, saveCredentials, authorizeUrl, resetForTests,
  getSpotifyAppToken, getSpotifyUserToken, accessToken, forgetUserToken, fetchJson,
  classifySpotifyLink, resolveSpotifyLink, spotifySignIn,
  savedAlbums, playlists, search, discTracks, startPlayback, coverDataUrl,
};
