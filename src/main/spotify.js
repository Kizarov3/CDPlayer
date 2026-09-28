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

function authorizeUrl(clientId, state) {
  return `https://accounts.spotify.com/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}`
    + `&scope=${encodeURIComponent(SCOPES.join(' '))}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}`;
}

module.exports = {
  SCOPES, REDIRECT_URI, credentials, status, saveCredentials, authorizeUrl, resetForTests,
  getSpotifyAppToken, getSpotifyUserToken, accessToken, forgetUserToken, fetchJson,
  classifySpotifyLink, resolveSpotifyLink, spotifySignIn,
};
