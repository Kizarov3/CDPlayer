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
    if (!key) return new Response('{}', { status: 404 });
    const r = typeof routes[key] === 'function' ? routes[key](String(url), init) : routes[key];
    const status = r.status || 200;
    return new Response(r.body === undefined || status === 204 ? null : JSON.stringify(r.body), { status });
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
  // Always the account picker ("Not you?"), not a silent sign-in as whoever the browser is logged in as.
  assert.strictEqual(u.searchParams.get('show_dialog'), 'true');
});

test('user token: refreshed with the app credentials, cached, and a rotated refresh token is kept', async () => {
  write(['id', 'secret', 'refresh', ALL]);
  answer({ 'https://accounts.spotify.com/api/token': { body: { access_token: 'user-1', expires_in: 3600, refresh_token: 'refresh-2' } } });
  assert.deepStrictEqual(await spotify.accessToken(), { token: 'user-1' });
  assert.deepStrictEqual(await spotify.accessToken(), { token: 'user-1' });
  assert.strictEqual(requests.length, 1);
  assert.match(requests[0].init.headers.Authorization, /^Basic /);
  assert.match(String(requests[0].init.body), /grant_type=refresh_token&refresh_token=refresh/);
  assert.strictEqual(spotify.credentials().refreshToken, 'refresh-2');
  assert.deepStrictEqual(spotify.credentials().scopes, spotify.SCOPES); // rotating the token keeps the scopes line
});

test('no sign-in → no access token; a Java-era file still gives the app token for cover art', async () => {
  write(['id', 'secret']);
  assert.deepStrictEqual(await spotify.accessToken(), { error: 'SIGN_IN' });
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

test('search asks for at most 10 songs, albums and playlists (the development-mode limit): songs first', async () => {
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/search': { body: {
    tracks: { items: [{ id: 't1', uri: 'spotify:track:t1', name: 'Idioteque', artists: [{ name: 'Radiohead' }], duration_ms: 309000, album: { id: 'a1', name: 'Kid A' } }, null] },
    albums: { items: [{ id: 'a1', name: 'Kid A', artists: [{ name: 'Radiohead' }], total_tracks: 10 }] },
    playlists: { items: [null, { id: 'p1', name: 'Kid A deep cuts', owner: { display_name: 'x' }, items: { total: 4 } }] },
  } } });
  const r = await spotify.search('kid a');
  assert.deepStrictEqual(r.items.map((i) => `${i.kind}:${i.id}`), ['track:t1', 'album:a1', 'playlist:p1']);
  assert.deepStrictEqual(r.items[0], { kind: 'track', id: 't1', uri: 'spotify:track:t1', name: 'Idioteque', owner: 'Radiohead', durationMs: 309000, albumId: 'a1', albumName: 'Kid A' });
  const u = new URL(requests[1].url);
  assert.strictEqual(u.searchParams.get('q'), 'kid a');
  assert.strictEqual(u.searchParams.get('type'), 'track,album,playlist');
  assert.strictEqual(u.searchParams.get('limit'), '10');
});

test('a song picked from a search: its album goes on the tray, starting from that song', async () => {
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/albums/a1': { body: {
    name: 'Kid A', artists: [{ name: 'Radiohead' }], images: [img(640, 'L')],
    tracks: { items: [{ uri: 'spotify:track:t0', name: 'Everything', duration_ms: 1 }, { uri: 'spotify:track:t1', name: 'Idioteque', duration_ms: 2 }], next: null },
  } } });
  const r = await spotify.discTracks({ kind: 'track', id: 't1', uri: 'spotify:track:t1', albumId: 'a1' });
  assert.deepStrictEqual(r.tracks.map((t) => t.uri), ['spotify:track:t0', 'spotify:track:t1']);
  assert.strictEqual(r.start, 1);
  assert.strictEqual(r.name, 'Kid A');
});

test("a song whose album can't be read (or isn't on it): the song alone", async () => {
  connected();
  answer({ ...TOKEN,
    'https://api.spotify.com/v1/albums/a9': { status: 404, body: {} },
    'https://api.spotify.com/v1/tracks/t1': { body: { uri: 'spotify:track:t1', name: 'Single', duration_ms: 5, artists: [{ name: 'X' }], album: { name: 'S', artists: [{ name: 'X' }], images: [img(300, 'c')] } } },
  });
  const r = await spotify.discTracks({ kind: 'track', id: 't1', uri: 'spotify:track:t1', albumId: 'a9' });
  assert.deepStrictEqual(r.tracks.map((t) => [t.uri, t.title, t.artist, t.cover]), [['spotify:track:t1', 'Single', 'X', 'c']]);
  assert.strictEqual(r.start, 0);
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
    { uri: 'spotify:track:t1', title: 'One', artist: 'A', album: 'Alb', durationMs: 1000, cover: 'L', credits: { albumArtist: 'A' } },
    { uri: 'spotify:track:t2', title: 'Two', artist: 'A', album: 'Alb', durationMs: 2000, cover: 'L', credits: { albumArtist: 'A' } },
    { uri: 'spotify:track:t3', title: 'Three', artist: 'B', album: 'Alb', durationMs: 3000, cover: 'L', credits: { albumArtist: 'A' } },
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

test('what Spotify says of an album comes with its songs, for the booklet: date, label, small print, barcode, places', async () => {
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/albums/a1': { body: {
    name: 'Alb', artists: [{ name: 'A' }], images: [], release_date: '1998-08-18', label: 'Immortal', genres: [],
    copyrights: [{ text: '1998 Immortal', type: 'C' }, { text: '(P) 1998 Epic', type: 'P' }], external_ids: { upc: '074646900123' },
    tracks: { items: [{ uri: 'spotify:track:t1', name: 'One', duration_ms: 1, artists: [{ name: 'A' }], track_number: 1, disc_number: 1 },
      { uri: 'spotify:track:t2', name: 'Two', duration_ms: 1, artists: [{ name: 'A' }], track_number: 1, disc_number: 2 }], next: null },
  } } });
  const { tracks } = await spotify.discTracks({ kind: 'album', id: 'a1' });
  const album = { albumArtist: 'A', released: '1998-08-18', label: 'Immortal', copyright: '© 1998 Immortal · ℗ 1998 Epic', barcode: '074646900123' };
  assert.deepStrictEqual(tracks[0].credits, { ...album, track: { no: 1, of: null } });
  assert.deepStrictEqual(tracks[1].credits, { ...album, track: { no: 1, of: null }, disc: { no: 2, of: null } });
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

test('a 403 on the library is Spotify not letting this account into the app (User Management), said so', async () => {
  write(['id', 'secret']);
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/me/albums': () => ({ status: 403, body: { error: { status: 403, message: 'Forbidden' } } }) });
  assert.deepStrictEqual(await spotify.savedAlbums(0), { error: 'NOT_REGISTERED' });
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
  assert.deepStrictEqual(await spotify.startPlayback({ deviceId: 'd', uris: ['spotify:track:a'], positionMs: 0 }), { ok: false, status: 403, reason: 'PREMIUM_REQUIRED' });
  // A track Spotify won't play is a 403 too, with another reason.
  answer({ ...TOKEN, 'https://api.spotify.com/v1/me/player/play': { status: 403, body: { error: { message: 'Player command failed: Restriction violated', reason: 'UNKNOWN' } } } });
  assert.deepStrictEqual(await spotify.startPlayback({ deviceId: 'd', uris: ['spotify:track:a'], positionMs: 0 }), { ok: false, status: 403, reason: 'UNKNOWN' });
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

test('disconnecting forgets the sign-in and its tokens, but keeps the Client ID and Secret', async () => {
  connected();
  answer(TOKEN);
  assert.deepStrictEqual(await spotify.accessToken(), { token: 'user-1' });
  assert.deepStrictEqual(spotify.disconnect(), { configured: true, connected: false, reconnectNeeded: false });
  assert.deepStrictEqual(spotify.credentials(), { clientId: 'id', clientSecret: 'secret', refreshToken: '', scopes: [] });
  assert.deepStrictEqual(await spotify.accessToken(), { error: 'SIGN_IN' }); // the cached token is gone too
});

test('a sign-in Spotify stops honouring (revoked, expired) asks to reconnect; a dropped network is only offline', async () => {
  connected();
  answer({ 'https://accounts.spotify.com/api/token': { status: 400, body: { error: 'invalid_grant' } } });
  assert.deepStrictEqual(await spotify.accessToken(), { error: 'SIGN_IN' });
  assert.deepStrictEqual(spotify.status(), { configured: true, connected: true, reconnectNeeded: true });
  spotify.resetForTests();
  global.fetch = async () => { throw new TypeError('fetch failed'); };
  assert.deepStrictEqual(await spotify.accessToken(), { error: 'OFFLINE' });
  assert.deepStrictEqual(spotify.status(), { configured: true, connected: true, reconnectNeeded: false });
});

test('the library refusing a fresh token twice also asks to reconnect', async () => {
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/me/albums': { status: 401, body: {} } });
  assert.deepStrictEqual(await spotify.savedAlbums(0), { error: 'SIGN_IN' });
  assert.strictEqual(spotify.status().reconnectNeeded, true);
});

test('Spotify accepting a play with 202 and no body is a start, not "couldn\'t reach Spotify"', async () => {
  connected();
  // Real responses: a 202 (or 204, or 200) whose body is empty can't be read as JSON.
  global.fetch = async (url) => (String(url).startsWith('https://accounts.spotify.com')
    ? new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } })
    : new Response(null, { status: 202 }));
  assert.deepStrictEqual(await spotify.startPlayback({ deviceId: 'd', uris: ['spotify:track:a'], positionMs: 0 }), { ok: true, status: 204 });
  global.fetch = async (url) => (String(url).startsWith('https://accounts.spotify.com')
    ? new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
    : new Response('', { status: 200 }));
  assert.deepStrictEqual(await spotify.startPlayback({ deviceId: 'd', uris: ['spotify:track:a'], positionMs: 0 }), { ok: true, status: 204 });
});

test('an answer that isn\'t a dropped connection says what it was, instead of passing for one', async () => {
  connected();
  global.fetch = async (url) => (String(url).startsWith('https://accounts.spotify.com')
    ? new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
    : new Response('<html>not json</html>', { status: 200 }));
  const r = await spotify.startPlayback({ deviceId: 'd', uris: ['spotify:track:a'], positionMs: 0 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.status, 0);
  assert.match(r.detail, /JSON|UNEXPECTED TOKEN/);
});

// ---- The setup wizard ----

test('a Client ID or Secret looks right: 32 hex characters, spaces round it ignored', () => {
  assert.strictEqual(spotify.keyLooksRight(' 0123456789abcdef0123456789ABCDEF '), true);
  assert.strictEqual(spotify.keyLooksRight('0123456789abcdef'), false);
  assert.strictEqual(spotify.keyLooksRight('0123456789abcdef0123456789abcdeg'), false);
  assert.strictEqual(spotify.keyLooksRight(''), false);
});

test('checking keys asks Spotify for an app token with them, before they are saved', async () => {
  answer({ 'https://accounts.spotify.com/api/token': { body: { access_token: 'app', expires_in: 3600 } } });
  assert.deepStrictEqual(await spotify.checkCredentials({ clientId: 'id', clientSecret: 'secret' }), { ok: true });
  assert.match(requests[0].init.headers.Authorization, new RegExp(Buffer.from('id:secret').toString('base64')));
  assert.strictEqual(fs.existsSync(file), false, 'nothing saved');
  answer({ 'https://accounts.spotify.com/api/token': { status: 400, body: { error: 'invalid_client' } } });
  assert.deepStrictEqual(await spotify.checkCredentials({ clientId: 'id', clientSecret: 'wrong' }), { error: 'BAD_KEYS' });
});

test('after signing in: the account is checked — added to the app, and Premium', async () => {
  write(['id', 'secret', 'refresh', ALL]);
  const token = { 'https://accounts.spotify.com/api/token': { body: { access_token: 'user', expires_in: 3600 } } };
  answer({ ...token, 'https://api.spotify.com/v1/me': { body: { product: 'premium' } } });
  assert.deepStrictEqual(await spotify.verifyAccount(), { ok: true });
  spotify.resetForTests();
  answer({ ...token, 'https://api.spotify.com/v1/me': { status: 403, body: { error: { status: 403, message: 'Check settings on developer.spotify.com/dashboard, the user may not be registered.' } } } });
  assert.deepStrictEqual(await spotify.verifyAccount(), { error: 'NOT_REGISTERED' });
  spotify.resetForTests();
  answer({ ...token, 'https://api.spotify.com/v1/me': { body: { product: 'free' } } });
  assert.deepStrictEqual(await spotify.verifyAccount(), { error: 'NO_PREMIUM' });
});

test('what went wrong, and which step of the setup fixes it', () => {
  assert.strictEqual(spotify.diagnose('BAD_KEYS').step, 2);
  assert.strictEqual(spotify.diagnose('NOT_REGISTERED').step, 3);
  assert.strictEqual(spotify.diagnose('NO_PREMIUM').step, 4);
  assert.strictEqual(spotify.diagnose('NO_ANSWER').step, 1); // the browser never came back: most often the Redirect URI
  for (const code of ['BAD_KEYS', 'NOT_REGISTERED', 'NO_PREMIUM', 'NO_ANSWER']) assert.ok(spotify.diagnose(code).text.length > 20);
});

test('new scopes (likes, recently played) are asked for at sign-in, but a sign-in without them still plays', () => {
  for (const s of ['user-library-modify', 'user-read-recently-played', 'user-read-playback-state']) assert.ok(spotify.SCOPES.includes(s), s);
  write(['id', 'secret', 'refresh', spotify.SCOPES.filter((s) => s !== 'user-library-modify' && s !== 'user-read-recently-played').join(' ')]);
  assert.deepStrictEqual(spotify.status(), { configured: true, connected: true, reconnectNeeded: false, missing: ['user-library-modify', 'user-read-recently-played'] });
});

test('the shelf: every saved album, its songs as tracks of an album, its cover and when it was saved', async () => {
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/me/albums': (url) => ({ body: url.includes('offset=0') ? {
    items: [{ added_at: '2026-11-01T10:00:00Z', album: { id: 'a1', name: 'OK Computer', artists: [{ name: 'Radiohead' }], release_date: '1997-05-21', images: [img(640, 'L')], total_tracks: 2,
      tracks: { items: [{ uri: 'spotify:track:t1', name: 'Airbag', duration_ms: 284000, track_number: 1, disc_number: 1, artists: [{ name: 'Radiohead' }] }, { uri: 'spotify:track:t2', name: 'Paranoid Android', duration_ms: 383000, track_number: 2, disc_number: 1, artists: [{ name: 'Radiohead' }] }], next: null } } }],
    next: 'https://api.spotify.com/v1/me/albums?offset=50&limit=50' } : { items: [{ added_at: '2026-10-01T10:00:00Z', album: { id: 'a2', name: 'Kid A', artists: [{ name: 'Radiohead' }], release_date: '2000', images: [], total_tracks: 10 } }], next: null } }) });
  const r = await spotify.libraryAlbums();
  assert.strictEqual(r.albums.length, 2);
  assert.deepStrictEqual(r.albums[0], {
    id: 'spotify:album:a1', spotify: { id: 'a1', cover: 'L', total: 2 }, title: 'OK Computer', artist: 'Radiohead', year: 1997, released: '1997-05-21',
    discs: 1, duration: 667, added: Date.parse('2026-11-01T10:00:00Z'), arrived: Date.parse('2026-11-01T10:00:00Z'),
    tracks: [{ path: 'spotify:track:t1', title: 'Airbag', artist: 'Radiohead', duration: 284, track: 1, disc: 1 }, { path: 'spotify:track:t2', title: 'Paranoid Android', artist: 'Radiohead', duration: 383, track: 2, disc: 1 }],
  });
  assert.deepStrictEqual(r.albums[1].tracks, [], 'an album whose songs Spotify left out: they come when it is played');
  assert.strictEqual(r.albums[1].year, 2000);
});

test('Liked Songs as a disc, and what was played lately as albums to put in again', async () => {
  connected();
  answer({ ...TOKEN,
    'https://api.spotify.com/v1/me/tracks': { body: { items: [{ track: { uri: 'spotify:track:t9', name: 'Song', duration_ms: 1000, artists: [{ name: 'X' }], album: { name: 'Al', images: [img(300, 'c')] } } }, { track: null }], next: null } },
    'https://api.spotify.com/v1/me/player/recently-played': { body: { items: [
      { track: { album: { id: 'a1', name: 'OK Computer', artists: [{ name: 'Radiohead' }], total_tracks: 12 } } },
      { track: { album: { id: 'a1', name: 'OK Computer', artists: [{ name: 'Radiohead' }], total_tracks: 12 } } },
      { track: { album: { id: 'a2', name: 'Kid A', artists: [{ name: 'Radiohead' }], total_tracks: 10 } } }] } },
  });
  const liked = await spotify.discTracks({ kind: 'liked' });
  assert.deepStrictEqual(liked.tracks.map((x) => [x.uri, x.album, x.cover]), [['spotify:track:t9', 'Al', 'c']]);
  assert.deepStrictEqual((await spotify.recentAlbums()).items.map((i) => i.id), ['a1', 'a2']);
});

test('likes: which are saved, asked 40 at a time; saving and taking out by their spotify: links', async () => {
  connected();
  answer({ ...TOKEN,
    'https://api.spotify.com/v1/me/library/contains': (url) => ({ body: new URL(url).searchParams.get('uris').split(',').map((u, i) => i % 2 === 0) }),
    'https://api.spotify.com/v1/me/library': { status: 200 },
  });
  const uris = Array.from({ length: 45 }, (_, i) => `spotify:track:t${i}`);
  const saved = await spotify.savedIn(uris);
  assert.strictEqual(saved.saved.length, 45);
  assert.deepStrictEqual(saved.saved.slice(38, 42), [true, false, true, false]);
  assert.strictEqual(requests.filter((r) => r.url.includes('/contains')).length, 2);
  assert.deepStrictEqual(await spotify.setSaved(['spotify:album:a1'], true), { ok: true });
  const put = requests.at(-1);
  assert.strictEqual(put.init.method, 'PUT');
  assert.match(put.url, /\/me\/library\?uris=spotify%3Aalbum%3Aa1$/);
  await spotify.setSaved(['spotify:track:t1'], false);
  assert.strictEqual(requests.at(-1).init.method, 'DELETE');
});

test('a sign-in from before likes could be saved: said so, not as a sign-out', async () => {
  connected();
  answer({ ...TOKEN, 'https://api.spotify.com/v1/me/library': { status: 403, body: { error: { status: 403, message: 'Insufficient client scope' } } } });
  assert.deepStrictEqual(await spotify.setSaved(['spotify:track:t1'], true), { error: 'SCOPE' });
});

test('the phone: what plays where, the devices, moving the music to one, and its buttons', async () => {
  connected();
  answer({ ...TOKEN,
    'https://api.spotify.com/v1/me/player/devices': { body: { devices: [{ id: 'd1', name: 'iPhone', type: 'Smartphone', is_active: true, volume_percent: 50 }, { id: null, name: 'Restricted' }] } },
    'https://api.spotify.com/v1/me/player/next': { status: 204 },
    'https://api.spotify.com/v1/me/player/seek': { status: 204 },
    'https://api.spotify.com/v1/me/player?': { status: 204 },
    'https://api.spotify.com/v1/me/player': (url, init) => (init.method === 'PUT' ? { status: 204 } : { body: { is_playing: true, progress_ms: 61000, device: { id: 'd1', name: 'iPhone', type: 'Smartphone', volume_percent: 50 },
      item: { uri: 'spotify:track:t1', name: 'Airbag', duration_ms: 284000, artists: [{ name: 'Radiohead' }], album: { name: 'OK Computer', images: [img(640, 'L')] } } } }),
  });
  assert.deepStrictEqual(await spotify.playerState(), { playing: true, positionMs: 61000, device: { id: 'd1', name: 'iPhone', type: 'Smartphone', volume: 50 },
    track: { uri: 'spotify:track:t1', title: 'Airbag', artist: 'Radiohead', album: 'OK Computer', durationMs: 284000, cover: 'L' } });
  assert.deepStrictEqual(await spotify.devices(), { devices: [{ id: 'd1', name: 'iPhone', type: 'Smartphone', active: true, volume: 50 }] });
  assert.deepStrictEqual(await spotify.transfer({ deviceId: 'd1', play: true }), { ok: true });
  assert.deepStrictEqual(JSON.parse(requests.at(-1).init.body), { device_ids: ['d1'], play: true });
  assert.deepStrictEqual(await spotify.remote({ command: 'next' }), { ok: true });
  assert.strictEqual(requests.at(-1).init.method, 'POST');
  await spotify.remote({ command: 'seek', ms: 1234.4 });
  assert.match(requests.at(-1).url, /seek\?position_ms=1234$/);
  answer({ ...TOKEN, 'https://api.spotify.com/v1/me/player': { status: 204 } });
  assert.strictEqual(await spotify.playerState(), null, 'nothing playing anywhere');
});

test("songs known only by their links: what each is, asked one by one, those Spotify doesn't have left out", async () => {
  connected();
  answer({ ...TOKEN,
    'https://api.spotify.com/v1/tracks/t1': { body: { uri: 'spotify:track:t1', name: 'Cold Open', duration_ms: 133000, artists: [{ name: '照井順政' }], track_number: 1, album: { name: 'JJK OST', images: [img(640, 'L')] } } },
    'https://api.spotify.com/v1/tracks/t2': { status: 404, body: {} },
  });
  const r = await spotify.tracksInfo(['spotify:track:t1', 'spotify:track:t2']);
  assert.deepStrictEqual(r.tracks.map((x) => [x.uri, x.title, x.artist, x.album, x.durationMs, x.cover]), [['spotify:track:t1', 'Cold Open', '照井順政', 'JJK OST', 133000, 'L']]);
});
