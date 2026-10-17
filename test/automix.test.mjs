import test from 'node:test';
import assert from 'node:assert';
import { edges, mixPlan, continuesAlbum, MAX_OVERLAP } from '../src/renderer/js/automix.js';

const RATE = 8000;
// A 440 Hz tone, its amplitude given second by second by `shape(t)`, `seconds` long.
function song(seconds, shape) {
  const x = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < x.length; i++) x[i] = shape(i / RATE) * 0.5 * Math.sin((2 * Math.PI * 440 * i) / RATE);
  return [x];
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} not within ${tol} of ${b}`);

test('silence around a song is found to within 0.1 s', () => {
  const e = edges(song(30, (t) => (t >= 2 && t < 24 ? 1 : 0)), RATE);
  near(e.start, 2, 0.1, 'start'); near(e.end, 24, 0.1, 'end');
  near(e.fadeStart, e.end, 0.01, 'a dead stop has no ending');
  near(e.introRise, 0, 0.6, 'loud from its first moment');
  near(e.duration, 30, 0.001, 'duration');
});

test('a fade-out is the ending', () => {
  // full for 20 s, then a 6 s fade (linear in dB from 0 to -60 dB)
  const e = edges(song(26, (t) => (t < 20 ? 1 : 10 ** (-(t - 20) * 10 / 20))), RATE);
  near(e.fadeStart, 20.6, 0.8, 'fade start'); // -6 dB on the smoothed level, about 0.6 s into the fade
  assert.ok(e.end > 24 && e.end <= 26, `end ${e.end}`);
});

test('a quiet opening rises late', () => {
  const e = edges(song(30, (t) => (t < 5 ? 0.1 : 1)), RATE); // -20 dB for 5 s, then full
  near(e.start, 0, 0.1, 'start'); // -20 dB is audible
  near(e.introRise, 5, 0.6, 'rise');
});

test('silence has no edges', () => {
  assert.strictEqual(edges([new Float32Array(RATE * 3)], RATE), null);
  assert.strictEqual(edges([new Float32Array(0)], RATE), null);
});

const e = (start, end, fadeStart = end, introRise = 0) => ({ start, end, fadeStart, introRise, duration: end + 3 });

test('an ending: the next song comes in as it winds down', () => {
  const p = mixPlan(e(0, 200, 194), e(1.5, 180));
  near(p.overlap, 6, 1e-9, 'overlap'); near(p.at, 194, 1e-9, 'at');
  assert.strictEqual(p.startAt, 1.5); assert.strictEqual(p.fadeOut, true);
  assert.strictEqual(p.fadeIn, 3); // opens loud: brought up over 3 s
});

test('a long ending is capped, a dead stop barely overlaps and keeps its last hit', () => {
  assert.strictEqual(mixPlan(e(0, 200, 170), e(0, 180)).overlap, MAX_OVERLAP);
  const dead = mixPlan(e(0, 200), e(0, 180));
  assert.deepStrictEqual([dead.overlap, dead.at, dead.fadeOut, dead.fadeIn], [1, 199, false, 1]);
});

test('short songs stay whole: the overlap is at most a third of either', () => {
  assert.strictEqual(mixPlan(e(0, 200, 190), e(0, 12)).overlap, 4);
  assert.strictEqual(mixPlan(e(0, 9, 3), e(0, 180)).overlap, 3);
});

test('a song that opens quietly gets a short fade-in; an unknown one starts at 0', () => {
  assert.strictEqual(mixPlan(e(0, 200, 192), e(0, 180, 180, 6)).fadeIn, 0.5);
  const p = mixPlan(e(0, 200, 192), null);
  assert.strictEqual(p.startAt, 0); assert.strictEqual(p.overlap, 8);
});

const t = (album, track, { disc = null, albumArtist = null, artist = 'A', path = `/m/${album}/${track}.flac` } = {}) => ({
  path, details: { album, artist, credits: { albumArtist, track: track ? { no: track } : undefined, disc: disc ? { no: disc } : undefined } },
});

test('the album carries on: the next track or the next disc, shuffled or not', () => {
  assert.strictEqual(continuesAlbum(t('X', 3), t('X', 4), { inOrder: false }), true);
  assert.strictEqual(continuesAlbum(t('X', 12, { disc: 1 }), t('X', 1, { disc: 2 }), { inOrder: false }), true);
  assert.strictEqual(continuesAlbum(t('X', 3), t('X', 5), { inOrder: false }), false);
  assert.strictEqual(continuesAlbum(t('X', 3), t('Y', 4), { inOrder: true }), false);
  assert.strictEqual(continuesAlbum(t('X', 4), t('X', 3), { inOrder: false }), false);
});

test('incomplete tags: in order, the same album name or the same folder', () => {
  // a compilation: the artist changes, no album artist
  assert.strictEqual(continuesAlbum(t('Mix', 3, { artist: 'A' }), t('Mix', 4, { artist: 'B' }), { inOrder: true }), true);
  assert.strictEqual(continuesAlbum(t('Mix', null), t('Mix', null), { inOrder: true }), true);
  assert.strictEqual(continuesAlbum(t('Mix', null), t('Mix', null), { inOrder: false }), false);
  const bare = (path) => ({ path, details: { album: null, credits: {} } });
  assert.strictEqual(continuesAlbum(bare('/m/a/1.mp3'), bare('/m/a/2.mp3'), { inOrder: true }), true);
  assert.strictEqual(continuesAlbum(bare('/m/a/1.mp3'), bare('/m/b/2.mp3'), { inOrder: true }), false);
  assert.strictEqual(continuesAlbum(bare('/m/a/1.mp3'), t('X', 1), { inOrder: true }), false);
});
