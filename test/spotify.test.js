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

const connected = () => write(['id', 'secret', 'refresh', ALL]);
const TOKEN = { 'https://accounts.spotify.com/api/token': { body: { access_token: 'user-1', expires_in: 3600 } } };
const img = (w, url) => ({ width: w, height: w, url });

test('saved albums page through 50 at a time as collection items', async () => {
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/me/albums': { body: {
    items: [{ album: { id: 'a1', name: 'OK Computer', artists: [{ name: 'Radiohead' }], total_tracks: 12 } }],
    next: 'https://api.spotify.com/v1/me/albums?offset=50&limit=50',
  } } });
  assert.deepStrictEqual(await spotify.savedAlbums(0), { items: [{ kind: 'album', id: 'a1', name: 'OK Computer', owner: 'Radiohead', total: 12 }], next: 50 });
  assert.match(requests[1].url, /\/me\/albums\?limit=50&offset=0/);
  assert.strictEqual(requests[1].init.headers.Authorization, 'Bearer user-1');
});

test('playlists: the old and the renamed track count both read', async () => {
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/me/playlists': { body: {
    items: [{ id: 'p1', name: 'Road', owner: { display_name: 'me' }, items: { total: 3 } }, { id: 'p2', name: 'Old', owner: { id: 'u2' }, tracks: { total: 5 } }],
    next: null,
  } } });
  assert.deepStrictEqual(await spotify.playlists(0), { items: [
    { kind: 'playlist', id: 'p1', name: 'Road', owner: 'me', total: 3 },
    { kind: 'playlist', id: 'p2', name: 'Old', owner: 'u2', total: 5 },
  ], next: null });
});

test('search asks for at most 10 albums and playlists (the development-mode limit)', async () => {
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/search': { body: {
    albums: { items: [{ id: 'a1', name: 'Kid A', artists: [{ name: 'Radiohead' }], total_tracks: 10 }] },
    playlists: { items: [null, { id: 'p1', name: 'Kid A deep cuts', owner: { display_name: 'x' }, items: { total: 4 } }] },
  } } });
  const r = await spotify.search('kid a');
  assert.deepStrictEqual(r.items.map((i) => `${i.kind}:${i.id}`), ['album:a1', 'playlist:p1']);
  const u = new URL(requests[1].url);
  assert.strictEqual(u.searchParams.get('q'), 'kid a');
  assert.strictEqual(u.searchParams.get('type'), 'album,playlist');
  assert.strictEqual(u.searchParams.get('limit'), '10');
});

test('an album becomes disc tracks, with its biggest cover, across pages of tracks', async () => {
  connected();
  answer({ ...TOKEN,
    'https://api.spotify.com/v1/albums/a1/tracks': { body: { items: [{ uri: 'spotify:track:t3', name: 'Three', duration_ms: 3000, artists: [{ name: 'B' }] }], next: null } },
    'https://api.spotify.com/v1/albums/a1': { body: {
      name: 'Alb', artists: [{ name: 'A' }], images: [img(64, 's'), img(640, 'L'), img(300, 'm')],
      tracks: { items: [{ uri: 'spotify:track:t1', name: 'One', duration_ms: 1000, artists: [{ name: 'A' }] }, { uri: 'spotify:track:t2', name: 'Two', duration_ms: 2000, artists: [] }],
        next: 'https://api.spotify.com/v1/albums/a1/tracks?offset=2&limit=50' },
    } },
  });
  const r = await spotify.discTracks({ kind: 'album', id: 'a1' });
  assert.deepStrictEqual(r.tracks, [
    { uri: 'spotify:track:t1', title: 'One', artist: 'A', album: 'Alb', durationMs: 1000, cover: 'L' },
    { uri: 'spotify:track:t2', title: 'Two', artist: 'A', album: 'Alb', durationMs: 2000, cover: 'L' },
    { uri: 'spotify:track:t3', title: 'Three', artist: 'B', album: 'Alb', durationMs: 3000, cover: 'L' },
  ]);
});

test('a playlist becomes disc tracks from /items, skipping episodes, local files and gaps', async () => {
  connected();
  const track = (id, name) => ({ type: 'track', uri: `spotify:track:${id}`, name, duration_ms: 1, artists: [{ name: 'Ar' }], album: { name: 'Al', images: [img(640, `c-${id}`)] } });
  answer({ ...TOKEN, 'https://api.spotify.com/v1/playlists/p1/items': { body: { items: [
    { item: track('t1', 'One') }, { item: null }, { item: { type: 'episode', uri: 'spotify:episode:e' } },
    { is_local: true, item: { type: 'track', uri: 'spotify:local:x', name: 'Local' } }, { track: track('t2', 'Two') },
  ], next: null } } });
  const r = await spotify.discTracks({ kind: 'playlist', id: 'p1' });
  assert.deepStrictEqual(r.tracks.map((t) => [t.uri, t.title, t.cover]), [['spotify:track:t1', 'One', 'c-t1'], ['spotify:track:t2', 'Two', 'c-t2']]);
});

test('a grandfathered app: /items is missing, so /tracks is read instead', async () => {
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/playlists/p1/tracks': { body: { items: [{ track: { type: 'track', uri: 'spotify:track:t1', name: 'One', duration_ms: 1, artists: [], album: { name: 'Al', images: [] } } }], next: null } } });
  assert.deepStrictEqual((await spotify.discTracks({ kind: 'playlist', id: 'p1' })).tracks.map((t) => t.uri), ['spotify:track:t1']);
});

test("a followed playlist: Spotify withholds its songs, and that's said rather than an empty disc", async () => {
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/playlists/p1/items': { body: { items: [], next: null } } });
  assert.deepStrictEqual(await spotify.discTracks({ kind: 'playlist', id: 'p1' }), { error: 'NOT_SHARED' });
  answer({ ...TOKEN, 'https://api.spotify.com/v1/playlists/p1/items': { status: 403, body: {} } });
  assert.deepStrictEqual(await spotify.discTracks({ kind: 'playlist', id: 'p1' }), { error: 'NOT_SHARED' });
});

test('not signed in, a refused token, and no network each come back as an error code', async () => {
  write(['id', 'secret']);
  assert.deepStrictEqual(await spotify.savedAlbums(0), { error: 'SIGN_IN' });
  connected();
  let calls = 0;
  answer({ ...TOKEN, 'https://api.spotify.com/v1/me/albums': () => { calls++; return { status: 401, body: {} }; } });
  assert.deepStrictEqual(await spotify.savedAlbums(0), { error: 'SIGN_IN' });
  assert.strictEqual(calls, 2); // refreshed once and tried again
  global.fetch = async () => { throw new TypeError('fetch failed'); };
  spotify.resetForTests();
  assert.deepStrictEqual(await spotify.savedAlbums(0), { error: 'OFFLINE' });
});

test('starting playback: the whole list to the SDK device, at the position', async () => {
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/me/player/play': { status: 204 } });
  assert.deepStrictEqual(await spotify.startPlayback({ deviceId: 'dev 1', uris: ['spotify:track:a', 'spotify:track:b'], positionMs: 1234 }), { ok: true, status: 204 });
  const req = requests[1];
  assert.strictEqual(req.url, 'https://api.spotify.com/v1/me/player/play?device_id=dev%201');
  assert.strictEqual(req.init.method, 'PUT');
  assert.deepStrictEqual(JSON.parse(req.init.body), { uris: ['spotify:track:a', 'spotify:track:b'], position_ms: 1234 });
  answer({ ...TOKEN, 'https://api.spotify.com/v1/me/player/play': { status: 403, body: { error: { reason: 'PREMIUM_REQUIRED' } } } });
  assert.deepStrictEqual(await spotify.startPlayback({ deviceId: 'd', uris: ['spotify:track:a'], positionMs: 0 }), { ok: false, status: 403 });
});

test('covers are only fetched from Spotify’s image host', async () => {
  let fetched = false;
  global.fetch = async () => { fetched = true; return { ok: false }; };
  assert.strictEqual(await spotify.coverDataUrl('https://evil.example/x.jpg'), null);
  assert.strictEqual(fetched, false);
});

test('SEARCH’s playlist-link import reads the same /items contents', async () => {
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/playlists/p1/items': { body: { items: [{ item: { type: 'track', uri: 'spotify:track:t1', name: 'One', duration_ms: 1, artists: [{ name: 'Ar' }], album: { name: 'Al', images: [] } } }], next: null } } });
  assert.deepStrictEqual(await spotify.resolveSpotifyLink('https://open.spotify.com/playlist/p1'), { tracks: [{ title: 'One', artist: 'Ar' }] });
});
