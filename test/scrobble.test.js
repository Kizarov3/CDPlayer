'use strict';
// Scrobbling to ListenBrainz: ListenBrainz is stood in for (fetch), so nothing goes online.
const test = require('node:test');
const assert = require('node:assert');
const { createScrobbler } = require('../src/main/scrobble');

function setup({ down = false, status = 200 } = {}) {
  const files = {}, sent = [];
  const store = { readText: (n) => files[n] || null, writeText: (n, s) => { files[n] = s; } };
  const server = { down, status };
  const fetch = async (url, opts) => {
    if (server.down) throw new Error('offline');
    const body = opts.body ? JSON.parse(opts.body) : null;
    sent.push({ path: url.replace('https://api.listenbrainz.org/1', ''), auth: opts.headers.Authorization, body });
    if (url.endsWith('/validate-token')) {
      const valid = opts.headers.Authorization === 'Token good';
      return { ok: valid, status: valid ? 200 : 401, json: async () => (valid ? { valid: true, user_name: 'sam' } : { valid: false }) };
    }
    return { ok: server.status === 200, status: server.status, json: async () => ({}) };
  };
  return { files, sent, server, s: createScrobbler({ store, fetch, version: '2.20.0' }) };
}
const SONG = { artist: 'Radiohead', title: 'Airbag', album: 'OK Computer', duration: 284.5, at: 1700000000000 };

test('signed in with a token ListenBrainz knows; a wrong one, or none, is said so', async () => {
  const { s, files } = setup();
  assert.deepStrictEqual(await s.signIn(''), { error: 'EMPTY' });
  assert.deepStrictEqual(await s.signIn('bad'), { error: 'BAD_TOKEN' });
  assert.deepStrictEqual(await s.signIn(' good\n'), { ok: true, user: 'sam' });
  assert.deepStrictEqual(s.status().listenbrainz, { user: 'sam', dropped: false, waiting: 0 });
  assert.deepStrictEqual(JSON.parse(files['scrobble.json']), { listenbrainz: { token: 'good', user: 'sam' } });
});

test('a song heard goes as a listen, the one starting as playing now; nothing while signed out', async () => {
  const { s, sent } = setup();
  assert.strictEqual(await s.scrobble(SONG), false);
  assert.strictEqual(sent.length, 0);
  await s.signIn('good');
  assert.strictEqual(await s.nowPlaying(SONG), true);
  assert.strictEqual(await s.scrobble(SONG), true);
  const [now, listen] = sent.slice(-2);
  assert.strictEqual(now.body.listen_type, 'playing_now');
  assert.deepStrictEqual(listen, { path: '/submit-listens', auth: 'Token good', body: { listen_type: 'single', payload: [{ listened_at: 1700000000, track_metadata: {
    artist_name: 'Radiohead', track_name: 'Airbag', release_name: 'OK Computer',
    additional_info: { media_player: 'CDPlayer', submission_client: 'CDPlayer', submission_client_version: '2.20.0', duration_ms: 284500 } } }] } });
  assert.strictEqual(await s.scrobble({ artist: '', title: 'No one' }), false); // nameless songs aren't sent
});

test('offline, listens wait and go together with the next; a reset token stops them till signed in again', async () => {
  const { s, sent, server, files } = setup();
  await s.signIn('good');
  server.down = true;
  assert.strictEqual(await s.scrobble(SONG), false);
  assert.strictEqual(await s.scrobble({ ...SONG, title: 'Paranoid Android', at: 1700000300000 }), false);
  assert.strictEqual(JSON.parse(files['scrobble-queue.json']).listenbrainz.length, 2);
  server.down = false;
  assert.strictEqual(await s.scrobble({ ...SONG, title: 'Subterranean Homesick Alien', at: 1700000700000 }), true);
  const last = sent[sent.length - 1].body;
  assert.deepStrictEqual([last.listen_type, last.payload.map((p) => p.track_metadata.track_name)], ['import', ['Airbag', 'Paranoid Android', 'Subterranean Homesick Alien']]);
  assert.strictEqual(s.status().listenbrainz.waiting, 0);
  server.status = 401;
  assert.strictEqual(await s.scrobble(SONG), false);
  assert.deepStrictEqual(s.status().listenbrainz, { user: 'sam', dropped: true, waiting: 1 });
  server.status = 200;
  await s.signIn('good');
  assert.strictEqual(s.status().listenbrainz.waiting, 0); // sent once signed in again
  s.signOut('listenbrainz');
  assert.deepStrictEqual(s.status().listenbrainz, { user: null, dropped: false, waiting: 0 });
});

// Last.fm, stood in for: auth.getToken, auth.getSession (allowed after `allowAfter` asks), track.* — each call's signature checked.
function lastfm({ allowAfter = 1 } = {}) {
  const crypto = require('crypto');
  const files = {}, calls = [];
  const store = { readText: (n) => files[n] || null, writeText: (n, s) => { files[n] = s; } };
  const server = { allowAfter, asked: 0, error: null, down: false };
  const fetch = async (url, opts) => {
    if (server.down) throw new Error('offline');
    const p = Object.fromEntries(new URLSearchParams(opts.body));
    const { api_sig: sig, format, ...rest } = p;
    const want = crypto.createHash('md5').update(Object.keys(rest).sort().map((k) => k + rest[k]).join('') + 'd4a3eb9772cf886a5f0294a4c0ba86a0').digest('hex');
    calls.push(p);
    const answer = (body) => ({ status: 200, ok: true, json: async () => body });
    if (sig !== want || format !== 'json' || p.api_key !== '28a46ad4e3daba21fda9817c8ca1f3e6') return answer({ error: 13 });
    if (p.method === 'auth.getToken') return answer({ token: 'T1' });
    if (p.method === 'auth.getSession') return answer(++server.asked > server.allowAfter ? { session: { name: 'sam', key: 'SK' } } : { error: 14 });
    if (server.error) return answer({ error: server.error });
    return answer(p.method === 'track.scrobble' ? { scrobbles: { '@attr': { accepted: 1 } } } : { nowplaying: {} });
  };
  return { files, calls, server, s: createScrobbler({ store, fetch, version: '2.20.0', wait: async () => {} }) };
}

test('Last.fm: CDPlayer allowed in the browser, asked till it is; each call signed', async () => {
  const { s, calls } = lastfm({ allowAfter: 2 });
  const opened = [];
  assert.deepStrictEqual(await s.connectLastfm((url) => opened.push(url)), { ok: true, user: 'sam' });
  assert.deepStrictEqual(opened, ['https://www.last.fm/api/auth/?api_key=28a46ad4e3daba21fda9817c8ca1f3e6&token=T1']);
  assert.deepStrictEqual(calls.map((c) => c.method), ['auth.getToken', 'auth.getSession', 'auth.getSession', 'auth.getSession']);
  assert.deepStrictEqual(s.status().lastfm, { user: 'sam', dropped: false, waiting: 0 });
  const never = lastfm({ allowAfter: 1e9 });
  assert.deepStrictEqual(await never.s.connectLastfm(() => {}, { tries: 3 }), { error: 'NOT_ALLOWED' });
});

test('Last.fm: playing now and the song heard, with its album, length and when it began', async () => {
  const { s, calls } = lastfm();
  await s.connectLastfm(() => {});
  assert.strictEqual(await s.nowPlaying(SONG), true);
  assert.strictEqual(await s.scrobble(SONG), true);
  const [now, heard] = calls.slice(-2);
  assert.deepStrictEqual([now.method, now.sk, now.artist, now.track, now.album, now.duration], ['track.updateNowPlaying', 'SK', 'Radiohead', 'Airbag', 'OK Computer', '285']);
  assert.deepStrictEqual([heard.method, heard['artist[0]'], heard['track[0]'], heard['timestamp[0]']], ['track.scrobble', 'Radiohead', 'Airbag', '1700000000']);
});

test('Last.fm: offline or busy, listens wait and go 50 at a time; a session revoked asks to connect again', async () => {
  const { s, calls, server } = lastfm();
  await s.connectLastfm(() => {});
  server.down = true;
  for (let i = 0; i < 60; i++) await s.scrobble({ ...SONG, at: SONG.at + i * 300000 });
  server.down = false; server.error = 16;
  assert.strictEqual(await s.flush('lastfm'), false);
  assert.strictEqual(s.status().lastfm.waiting, 60);
  server.error = null;
  assert.strictEqual(await s.flush(), true);
  assert.deepStrictEqual(calls.filter((c) => c.method === 'track.scrobble' && !server.down).slice(-2).map((c) => Object.keys(c).filter((k) => k.startsWith('track[')).length), [50, 10]);
  server.error = 9;
  assert.strictEqual(await s.scrobble(SONG), false);
  assert.deepStrictEqual(s.status().lastfm, { user: 'sam', dropped: true, waiting: 1 });
  s.signOut('lastfm');
  assert.deepStrictEqual(s.status().lastfm, { user: null, dropped: false, waiting: 0 });
});
