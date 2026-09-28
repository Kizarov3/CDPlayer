import test from 'node:test';
import assert from 'node:assert';
import { SpotifySession, SpotifyTrackElement, spotifyUpcoming, isSpotifyUri } from '../src/renderer/js/spotify-deck.js';

const A = 'spotify:track:A', B = 'spotify:track:B', C = 'spotify:track:C';
class FakePlayer {
  constructor(opts) { this.opts = opts; this.handlers = {}; this.calls = []; FakePlayer.last = this; }
  addListener(ev, fn) { this.handlers[ev] = fn; }
  connect() { setTimeout(() => this.handlers.ready({ device_id: 'dev1' }), 0); return Promise.resolve(true); }
  pause() { this.calls.push(['pause']); return Promise.resolve(); }
  resume() { this.calls.push(['resume']); return Promise.resolve(); }
  seek(ms) { this.calls.push(['seek', ms]); return Promise.resolve(); }
  setVolume(v) { this.calls.push(['volume', v]); return Promise.resolve(); }
  emit(ev, arg) { this.handlers[ev](arg); }
}
const st = (uri, position, { paused = false, duration = 200000, linked = null } = {}) =>
  ({ paused, position, duration, track_window: { current_track: { uri, linked_from: { uri: linked } } } });
function setup({ responses = [] } = {}) {
  const clock = { t: 1000 };
  const plays = [];
  const tokens = ['tok-1', 'tok-2'];
  const session = new SpotifySession({
    loadPlayer: async () => FakePlayer,
    getToken: async () => tokens.shift(),
    startPlayback: async (req) => { plays.push(req); return responses.shift() || { ok: true, status: 204 }; },
    now: () => clock.t,
    wait: async () => {},
  });
  const events = [];
  session.on((e) => events.push(e));
  return { session, clock, plays, events, player: () => FakePlayer.last };
}
const ended = (el) => { const seen = []; el.addEventListener('ended', () => seen.push('ended')); return seen; };

test('Spotify URIs, and the order handed to Spotify: the rest of the disc unless shuffling or repeating one', () => {
  assert.ok(isSpotifyUri(A));
  assert.ok(!isSpotifyUri('/music/a.flac') && !isSpotifyUri('spotify:album:x') && !isSpotifyUri(undefined));
  const q = [A, B, C];
  assert.deepStrictEqual(spotifyUpcoming(q, 0, { shuffle: false, repeat: 'OFF' }), [B, C]);
  assert.deepStrictEqual(spotifyUpcoming(q, 2, { shuffle: false, repeat: 'ALL' }), []);
  assert.deepStrictEqual(spotifyUpcoming(q, 0, { shuffle: true, repeat: 'OFF' }), []);
  assert.deepStrictEqual(spotifyUpcoming(q, 0, { shuffle: false, repeat: 'ONE' }), []);
});

test('the element reports its length at once, and playing sends the track and what follows, from where it was set', async () => {
  const { session, plays } = setup();
  const el = new SpotifyTrackElement(session, A, 200000, () => [B, C]);
  await new Promise((resolve) => el.addEventListener('loadedmetadata', resolve));
  assert.strictEqual(el.duration, 200);
  assert.ok(el.paused);
  el.currentTime = 30;
  assert.strictEqual(plays.length, 0); // nothing reaches Spotify before PLAY
  await el.play();
  assert.deepStrictEqual(plays, [{ deviceId: 'dev1', uris: [A, B, C], positionMs: 30000 }]);
  assert.ok(!el.paused);
});

test('the SDK asks for a token every time, so a long session gets fresh ones', async () => {
  const { session, player } = setup();
  await session.connect();
  const got = [];
  player().opts.getOAuthToken((t) => got.push(t));
  player().opts.getOAuthToken((t) => got.push(t));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepStrictEqual(got, ['tok-1', 'tok-2']);
});

test('position runs on between Spotify’s reports, and stops when paused', async () => {
  const { session, clock, player } = setup();
  const el = new SpotifyTrackElement(session, A, 200000, () => []);
  await el.play();
  player().emit('player_state_changed', st(A, 10000));
  clock.t += 2500;
  assert.strictEqual(el.currentTime, 12.5);
  el.pause();
  clock.t += 5000;
  assert.strictEqual(el.currentTime, 12.5);
  assert.deepStrictEqual(player().calls.at(-1), ['pause']);
});

test('Spotify moving on to the next track ends this element, and the next one carries on without a new request', async () => {
  const { session, plays, player } = setup();
  const a = new SpotifyTrackElement(session, A, 200000, () => [B]);
  const seen = ended(a);
  await a.play();
  player().emit('player_state_changed', st(A, 0));
  player().emit('player_state_changed', st(B, 0));
  assert.deepStrictEqual(seen, ['ended']);
  a.pause(); a.load(); // what AudioEngine does to the finished deck: must not pause Spotify
  assert.ok(!player().calls.some((c) => c[0] === 'pause'));
  const b = new SpotifyTrackElement(session, B, 180000, () => []);
  await b.play();
  assert.strictEqual(plays.length, 1); // gapless: B was already playing
  assert.ok(!b.paused);
});

test('the last track of what was sent: paused back at 0 after reaching its end is the end', async () => {
  const { session, clock, player } = setup();
  const a = new SpotifyTrackElement(session, A, 200000, () => []);
  const seen = ended(a);
  await a.play();
  player().emit('player_state_changed', st(A, 0));
  clock.t += 199500;
  player().emit('player_state_changed', st(A, 0, { paused: true }));
  assert.deepStrictEqual(seen, ['ended']);
  assert.ok(a.paused);
});

test('repeat one: after the end, playing the track again asks Spotify afresh from the start', async () => {
  const { session, clock, plays, player } = setup();
  const a = new SpotifyTrackElement(session, A, 200000, () => []);
  await a.play();
  player().emit('player_state_changed', st(A, 0));
  clock.t += 199500;
  player().emit('player_state_changed', st(A, 0, { paused: true }));
  a.currentTime = 0; // what trackFinished does for repeat one: seek(0), then play()
  await a.play();
  assert.deepStrictEqual(plays[1], { deviceId: 'dev1', uris: [A], positionMs: 0 });
});

test('a track that ends without Spotify saying so is ended by the tick', async () => {
  const { session, clock, player } = setup();
  const a = new SpotifyTrackElement(session, A, 200000, () => []);
  const seen = ended(a);
  await a.play();
  player().emit('player_state_changed', st(A, 0));
  clock.t += 200000;
  session.tick();
  assert.deepStrictEqual(seen, []);
  clock.t += 2000;
  session.tick();
  assert.deepStrictEqual(seen, ['ended']);
});

test('a relinked track (Spotify plays another URI for it) counts as the one asked for', async () => {
  const { session, player } = setup();
  const a = new SpotifyTrackElement(session, A, 200000, () => [B]);
  const seen = ended(a);
  await a.play();
  player().emit('player_state_changed', st('spotify:track:A-market', 0));
  player().emit('player_state_changed', st('spotify:track:A-market', 5000));
  assert.deepStrictEqual(seen, []);
  assert.ok(!a.paused);
  player().emit('player_state_changed', st('spotify:track:B-market', 0)); // the next one relinked too
  assert.deepStrictEqual(seen, ['ended']);
  assert.strictEqual(session.currentUri, B);
});

test("the old track's last report, arriving after a new request, isn't taken for the new one", async () => {
  const { session, player } = setup();
  const a = new SpotifyTrackElement(session, A, 200000, () => []);
  await a.play();
  player().emit('player_state_changed', st(A, 100000));
  a.load();
  const c = new SpotifyTrackElement(session, C, 200000, () => []);
  await c.play();
  player().emit('player_state_changed', st(A, 100500, { paused: true }));
  assert.strictEqual(session.currentUri, C);
  player().emit('player_state_changed', st(C, 0));
  assert.ok(!c.paused);
});

test('turning shuffle on mid-song re-sends just the song, at where it is; the same order sends nothing', async () => {
  const { session, clock, plays, player } = setup();
  const a = new SpotifyTrackElement(session, A, 200000, () => [B, C]);
  await a.play();
  player().emit('player_state_changed', st(A, 40000));
  session.resync([B, C]);
  assert.strictEqual(plays.length, 1);
  clock.t += 1000;
  session.resync([]);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepStrictEqual(plays[1], { deviceId: 'dev1', uris: [A], positionMs: 41000 });
});

test('a change while paused waits for PLAY', async () => {
  const { session, plays, player } = setup();
  const a = new SpotifyTrackElement(session, A, 200000, () => [B, C]);
  await a.play();
  player().emit('player_state_changed', st(A, 40000));
  a.pause();
  session.resync([C]);
  assert.strictEqual(plays.length, 1);
  await a.play();
  assert.deepStrictEqual(plays[1], { deviceId: 'dev1', uris: [A, C], positionMs: 40000 });
});

test('another device taking over: paused where it was, and PLAY brings it back there', async () => {
  const { session, clock, plays, events, player } = setup();
  const a = new SpotifyTrackElement(session, A, 200000, () => []);
  await a.play();
  player().emit('player_state_changed', st(A, 60000));
  clock.t += 1000;
  player().emit('player_state_changed', null);
  assert.deepStrictEqual(events.at(-1), { type: 'lost', uri: A });
  assert.ok(a.paused);
  assert.strictEqual(a.currentTime, 61);
  await a.play();
  assert.deepStrictEqual(plays[1], { deviceId: 'dev1', uris: [A], positionMs: 61000 });
});

test('errors: no Premium, a licence never granted, a signed-out token, and one bad track', async () => {
  let s = setup();
  await s.session.connect();
  s.player().emit('account_error', { message: 'x' });
  assert.deepStrictEqual(s.events.at(-1), { type: 'error', reason: 'premium' });

  s = setup();
  const a = new SpotifyTrackElement(s.session, A, 200000, () => [B]);
  await a.play();
  s.player().emit('playback_error', { message: 'x' });
  assert.deepStrictEqual(s.events.at(-1), { type: 'error', reason: 'playback' });
  s.player().emit('playback_error', { message: 'x' });
  assert.deepStrictEqual(s.events.at(-1), { type: 'error', reason: 'unsupported' }); // twice and never a second played
  s.player().emit('playback_error', { message: 'x' });
  assert.strictEqual(s.events.filter((e) => e.reason === 'unsupported').length, 1);

  s = setup();
  const b = new SpotifyTrackElement(s.session, A, 200000, () => []);
  await b.play();
  s.player().emit('player_state_changed', st(A, 5000));
  s.player().emit('playback_error', { message: 'x' });
  s.player().emit('playback_error', { message: 'x' });
  assert.ok(!s.events.some((e) => e.reason === 'unsupported')); // it has played: just bad tracks

  s = setup({ responses: [{ ok: false, status: 401 }] });
  const c = new SpotifyTrackElement(s.session, A, 200000, () => []);
  await assert.rejects(c.play());
  assert.deepStrictEqual(s.events.at(-1), { type: 'error', reason: 'auth' });

  s = setup({ responses: [{ ok: false, status: 403, reason: 'PREMIUM_REQUIRED' }] });
  await assert.rejects(new SpotifyTrackElement(s.session, A, 200000, () => []).play());
  assert.deepStrictEqual(s.events.at(-1), { type: 'error', reason: 'premium' });
});

test("Spotify's other 403, 'Restriction violated' (a track it won't play), is a bad track, not a missing Premium", async () => {
  const s = setup({ responses: [{ ok: false, status: 403, reason: 'UNKNOWN' }] });
  await assert.rejects(new SpotifyTrackElement(s.session, A, 200000, () => []).play());
  assert.deepStrictEqual(s.events.at(-1), { type: 'error', reason: 'playback' });
});

test("the device not registered yet (404) is asked once more", async () => {
  const { session, plays } = setup({ responses: [{ ok: false, status: 404 }, { ok: true, status: 204 }] });
  await new SpotifyTrackElement(session, A, 200000, () => []).play();
  assert.strictEqual(plays.length, 2);
});

test('no player script (offline) is an error, and connecting can be tried again', async () => {
  let fail = true;
  const session = new SpotifySession({ loadPlayer: async () => { if (fail) throw new Error('sdk'); return FakePlayer; }, getToken: async () => 't', startPlayback: async () => ({ ok: true }) });
  const events = [];
  session.on((e) => events.push(e));
  assert.deepStrictEqual(await session.connect(), { ok: false, reason: 'offline' });
  assert.deepStrictEqual(events.at(-1), { type: 'error', reason: 'offline' });
  fail = false;
  assert.deepStrictEqual(await session.connect(), { ok: true });
});

test('volume reaches the player, before and after it exists', async () => {
  const { session, player } = setup();
  session.setVolume(0.3);
  await session.connect();
  assert.strictEqual(player().opts.volume, 0.3);
  session.setVolume(0.8);
  assert.deepStrictEqual(player().calls.at(-1), ['volume', 0.8]);
});

test("a refused play leaves nothing loaded: Spotify's empty report after it isn't another device taking over", async () => {
  const { session, events, player } = setup({ responses: [{ ok: false, status: 403, reason: 'UNKNOWN' }] });
  const a = new SpotifyTrackElement(session, A, 200000, () => []);
  await assert.rejects(a.play());
  player().emit('player_state_changed', null);
  assert.deepStrictEqual(events.map((e) => e.type), ['error']);
  assert.strictEqual(session.currentUri, null);
  assert.ok(a.paused);
});

test('disconnecting stops Spotify and closes the player; connecting again reuses that same player (a second one never registers)', async () => {
  let made = 0;
  class CountingPlayer extends FakePlayer {
    constructor(opts) { super(opts); made++; this.connects = 0; this.disconnects = 0; }
    connect() { this.connects++; return super.connect(); }
    disconnect() { this.disconnects++; }
  }
  const plays = [];
  const session = new SpotifySession({ loadPlayer: async () => CountingPlayer, getToken: async () => 't', startPlayback: async (r) => { plays.push(r); return { ok: true, status: 204 }; }, wait: async () => {} });
  const events = [];
  session.on((e) => events.push(e));
  const a = new SpotifyTrackElement(session, A, 200000, () => []);
  await a.play();
  FakePlayer.last.emit('player_state_changed', st(A, 5000));
  session.disconnect();
  assert.ok(a.paused);
  assert.strictEqual(FakePlayer.last.disconnects, 1);
  FakePlayer.last.emit('player_state_changed', null);
  assert.ok(!events.some((e) => e.type === 'lost')); // we closed it: not another device
  const b = new SpotifyTrackElement(session, B, 200000, () => []);
  await b.play();
  assert.strictEqual(made, 1);
  assert.strictEqual(FakePlayer.last.connects, 2);
  assert.deepStrictEqual(plays.at(-1), { deviceId: 'dev1', uris: [B], positionMs: 0 });
});
