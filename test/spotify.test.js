'use strict';
// Spotify: credentials, scopes, tokens and the Web API calls, against canned answers (no network).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const spotify = require('../src/main/spotify');
const realFetch = global.fetch;
test.after(() => { global.fetch = realFetch; fs.rmSync(home, { recursive: true, force: true }); });

const file = path.join(home, 'spotify.txt');
const write = (lines) => fs.writeFileSync(file, lines.join('\n') + '\n');
const ALL = spotify.SCOPES.join(' ');
// Answers keyed by URL prefix; records every request.
let requests = [];
function answer(routes) {
  requests = [];
  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const key = Object.keys(routes).find((k) => String(url).startsWith(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    const r = typeof routes[key] === 'function' ? routes[key](String(url), init) : routes[key];
    return { ok: (r.status || 200) < 400, status: r.status || 200, json: async () => r.body };
  };
}
test.beforeEach(() => { spotify.resetForTests(); try { fs.unlinkSync(file); } catch { /* none yet */ } });

test('status: nothing saved, credentials only, connected, and a Java-era token without the playback scopes', () => {
  assert.deepStrictEqual(spotify.status(), { configured: false, connected: false, reconnectNeeded: false });
  write(['id', 'secret']);
  assert.deepStrictEqual(spotify.status(), { configured: true, connected: false, reconnectNeeded: false });
  write(['id', 'secret', 'refresh', ALL]);
  assert.deepStrictEqual(spotify.status(), { configured: true, connected: true, reconnectNeeded: false });
  write(['id', 'secret', 'refresh']); // the Java version's file: a token for reading playlists only
  assert.deepStrictEqual(spotify.status(), { configured: true, connected: true, reconnectNeeded: true });
});

test('saving credentials keeps the sign-in for the same app, and drops it for another', () => {
  write(['id', 'secret', 'refresh', ALL]);
  spotify.saveCredentials({ clientId: ' id ', clientSecret: 'new-secret' });
  assert.deepStrictEqual(spotify.credentials(), { clientId: 'id', clientSecret: 'new-secret', refreshToken: 'refresh', scopes: spotify.SCOPES });
  const s = spotify.saveCredentials({ clientId: 'other', clientSecret: 'x' });
  assert.deepStrictEqual(s, { configured: true, connected: false, reconnectNeeded: false });
  assert.strictEqual(spotify.credentials().refreshToken, '');
});

test('the sign-in page asks for every scope playback needs, on the loopback redirect', () => {
  const u = new URL(spotify.authorizeUrl('abc', 'st8'));
  assert.strictEqual(u.origin + u.pathname, 'https://accounts.spotify.com/authorize');
  assert.strictEqual(u.searchParams.get('client_id'), 'abc');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:8080/callback');
  assert.strictEqual(u.searchParams.get('state'), 'st8');
  assert.deepStrictEqual(u.searchParams.get('scope').split(' ').sort(), [...spotify.SCOPES].sort());
  for (const s of ['streaming', 'user-read-email', 'user-read-private', 'user-library-read', 'user-modify-playback-state']) assert.ok(spotify.SCOPES.includes(s), s);
});

test('user token: refreshed with the app credentials, cached, and a rotated refresh token is kept', async () => {
  write(['id', 'secret', 'refresh', ALL]);
  answer({ 'https://accounts.spotify.com/api/token': { body: { access_token: 'user-1', expires_in: 3600, refresh_token: 'refresh-2' } } });
  assert.strictEqual(await spotify.accessToken(), 'user-1');
  assert.strictEqual(await spotify.accessToken(), 'user-1');
  assert.strictEqual(requests.length, 1);
  assert.match(requests[0].init.headers.Authorization, /^Basic /);
  assert.match(String(requests[0].init.body), /grant_type=refresh_token&refresh_token=refresh/);
  assert.strictEqual(spotify.credentials().refreshToken, 'refresh-2');
  assert.deepStrictEqual(spotify.credentials().scopes, spotify.SCOPES); // rotating the token keeps the scopes line
});

test('no sign-in → no access token; a Java-era file still gives the app token for cover art', async () => {
  write(['id', 'secret']);
  assert.strictEqual(await spotify.accessToken(), null);
  answer({ 'https://accounts.spotify.com/api/token': { body: { access_token: 'app-1', expires_in: 3600 } } });
  write(['id', 'secret', 'refresh']);
  assert.strictEqual(await spotify.getSpotifyAppToken(), 'app-1');
});

test('a track link still resolves with only the app token', async () => {
  write(['id', 'secret', 'refresh']);
  answer({
    'https://accounts.spotify.com/api/token': { body: { access_token: 'app-1', expires_in: 3600 } },
    'https://api.spotify.com/v1/tracks/abc': { body: { name: 'Airbag', artists: [{ name: 'Radiohead' }] } },
  });
  assert.deepStrictEqual(await spotify.resolveSpotifyLink('https://open.spotify.com/track/abc?si=x'), { tracks: [{ title: 'Airbag', artist: 'Radiohead' }] });
});
