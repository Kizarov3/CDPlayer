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
  assert.deepStrictEqual(s.status(), { user: 'sam', dropped: false, waiting: 0 });
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
  assert.strictEqual(JSON.parse(files['scrobble-queue.json']).length, 2);
  server.down = false;
  assert.strictEqual(await s.scrobble({ ...SONG, title: 'Subterranean Homesick Alien', at: 1700000700000 }), true);
  const last = sent[sent.length - 1].body;
  assert.deepStrictEqual([last.listen_type, last.payload.map((p) => p.track_metadata.track_name)], ['import', ['Airbag', 'Paranoid Android', 'Subterranean Homesick Alien']]);
  assert.strictEqual(s.status().waiting, 0);
  server.status = 401;
  assert.strictEqual(await s.scrobble(SONG), false);
  assert.deepStrictEqual(s.status(), { user: 'sam', dropped: true, waiting: 1 });
  server.status = 200;
  await s.signIn('good');
  assert.strictEqual(s.status().waiting, 0); // sent once signed in again
  s.signOut();
  assert.deepStrictEqual(s.status(), { user: null, dropped: false, waiting: 0 });
});
