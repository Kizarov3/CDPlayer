import test from 'node:test';
import assert from 'node:assert';
import { edges, mixPlan, continuesAlbum, nextPlan, prepareWindow, skipSilence, softClipCurve, SOFT_FROM, MAX_OVERLAP } from '../src/renderer/js/automix.js';

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
  near(e.fadeStart, e.end, 0.01, 'a dead stop has no ending'); near(e.settle, e.end, 0.01, 'nor dies away');
  near(e.introRise, 0, 0.6, 'loud from its first moment');
  near(e.endLevel, 0, 0.5, 'its last second at full'); near(e.headLevel, 0, 0.5, 'its first too');
  near(e.duration, 30, 0.001, 'duration');
});

test('a fade-out is the ending, and it has died away where it stays 18 dB down', () => {
  // full for 20 s, then a 6 s fade (linear in dB from 0 to -60 dB)
  const e = edges(song(26, (t) => (t < 20 ? 1 : 10 ** (-(t - 20) * 10 / 20))), RATE);
  near(e.fadeStart, 20.6, 0.8, 'fade start'); // -6 dB on the smoothed level, about 0.6 s into the fade
  near(e.settle, 21.8, 0.8, 'settled'); // -18 dB, about 1.8 s in
  assert.ok(e.end > 24 && e.end <= 26, `end ${e.end}`);
  assert.ok(e.endLevel < -30, `its last second is faint: ${e.endLevel}`);
});

test('an ending that is still singing quietly has not died away', () => {
  // full for 20 s, then -10 dB (a quiet last verse) for 8 s, then stops
  const e = edges(song(28, (t) => (t < 20 ? 1 : 10 ** (-10 / 20))), RATE);
  near(e.fadeStart, 20, 0.6, 'the ending begins');
  near(e.settle, e.end, 0.01, 'but never dies away before it stops');
});

test('a quiet opening rises late', () => {
  const e = edges(song(30, (t) => (t < 5 ? 0.1 : 1)), RATE); // -20 dB for 5 s, then full
  near(e.start, 0, 0.1, 'start'); // -20 dB is audible
  near(e.introRise, 5, 0.6, 'rise');
  near(e.headLevel, -20, 1, 'its first second');
});

test('silence has no edges', () => {
  assert.strictEqual(edges([new Float32Array(RATE * 3)], RATE), null);
  assert.strictEqual(edges([new Float32Array(0)], RATE), null);
});

// Edges for mixPlan: by default quiet at both ends (no clash), loud from the start.
const e = (start, end, { fadeStart = end, settle = fadeStart, gapEnd = start, introRise = 0, endLevel = -20, headLevel = -20 } = {}) =>
  ({ start, end, fadeStart, settle, gapEnd, introRise, endLevel, headLevel, duration: end + 3 });

test('an ending: the next song comes in where this one has died away, not over its last words', () => {
  // the ending starts at 186 (6 dB down), but it's still singing until 197
  const p = mixPlan(e(0, 200, { fadeStart: 186, settle: 197 }), e(1.5, 180, { headLevel: -5 }));
  near(p.overlap, 3, 1e-9, 'overlap'); near(p.at, 197, 1e-9, 'at');
  assert.strictEqual(p.startAt, 1.5); assert.strictEqual(p.fadeOut, true);
  assert.strictEqual(p.fadeIn, 3); // opens loud: brought up over 3 s…
  near(p.fadeFrom, 0.316, 1e-9, '…from -10 dB, so an opening hit is still heard');
});

test('an ending overlaps at most 10 s and at least 1 s', () => {
  assert.strictEqual(mixPlan(e(0, 200, { fadeStart: 160, settle: 170 }), e(0, 180)).overlap, MAX_OVERLAP);
  // died away only in its very last moment: still at least a second
  const late = mixPlan(e(0, 200, { fadeStart: 190, settle: 199.4 }), e(0, 180));
  assert.deepStrictEqual([late.overlap, late.at, late.fadeOut], [1, 199, true]);
});

test('a dead stop barely overlaps and keeps its last hit; into a loud opening, only for an instant', () => {
  const dead = mixPlan(e(0, 200, { endLevel: -8 }), e(0, 180, { headLevel: -8 }));
  assert.deepStrictEqual([dead.overlap, dead.at, dead.fadeOut, dead.fadeIn, dead.fadeFrom], [1, 199, false, 1, 0]);
  // at full tilt to its end, into a song that opens with a hit: two loud things at once
  const clash = mixPlan(e(0, 200, { endLevel: -1.6 }), e(0, 180, { headLevel: -7.9 }));
  near(clash.overlap, 0.3, 1e-9, 'an instant'); near(clash.at, 199.7, 1e-9, 'at');
  assert.strictEqual(clash.fadeOut, false);
  // at full tilt to its end: an instant, whatever comes next
  near(mixPlan(e(0, 200, { endLevel: 0 }), null).overlap, 0.3, 1e-9, 'unknown next');
});

test('an ending still sounding at its end (a last chord ringing out) keeps it: no fade, no bass cut', () => {
  const ring = mixPlan(e(0, 200, { fadeStart: 191, settle: 200, endLevel: -11 }), e(0, 180));
  assert.deepStrictEqual([ring.overlap, ring.at, ring.fadeOut], [1, 199, false]);
});

test('a loud song after an ending rises over 3 s even when the overlap is shorter; a quiet one over 0.5 s', () => {
  const loud = mixPlan(e(0, 200, { fadeStart: 194, settle: 198.7 }), e(0, 180, { headLevel: -4 }));
  near(loud.overlap, 1.3, 1e-9, 'overlap'); assert.strictEqual(loud.fadeIn, 3);
  assert.strictEqual(mixPlan(e(0, 200, { fadeStart: 194, settle: 198.7 }), e(0, 180, { headLevel: -20 })).fadeIn, 0.5);
});

test('a silence before a quiet coda: the mix starts after it, not in it', () => {
  // died away at 183, then silent until 194, then a coda to 200
  const p = mixPlan(e(0, 200, { fadeStart: 180, settle: 183, gapEnd: 194 }), e(0, 180));
  near(p.at, 194, 1e-9, 'at'); near(p.overlap, 6, 1e-9, 'overlap');
});

test('edges: where a silence inside the sound ends', () => {
  // full for 20 s, silent 20–24 s, a coda at -30 dB from 24 to 28 s
  const g = edges(song(30, (t) => (t < 20 ? 1 : t < 24 ? 0 : t < 28 ? 10 ** (-30 / 20) : 0)), RATE);
  near(g.gapEnd, 24, 0.1, 'gapEnd'); near(g.end, 28, 0.1, 'end');
  near(edges(song(30, (t) => (t < 25 ? 1 : 0)), RATE).gapEnd, 0, 1e-9, 'no silence inside: its start');
});

test('short songs stay whole: the overlap is at most a third of either', () => {
  assert.strictEqual(mixPlan(e(0, 200, { fadeStart: 180, settle: 190 }), e(0, 12)).overlap, 4);
  assert.strictEqual(mixPlan(e(0, 9, { fadeStart: 3, settle: 3 }), e(0, 180)).overlap, 3);
});

test('a song that opens quietly gets a short fade-in; an unknown one starts at 0', () => {
  assert.strictEqual(mixPlan(e(0, 200, { fadeStart: 190, settle: 192 }), e(0, 180, { introRise: 6 })).fadeIn, 0.5);
  const p = mixPlan(e(0, 200, { fadeStart: 190, settle: 192 }), null);
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

test('nextPlan: mixed only under AUTOMIX, between files, when the album doesn\'t run on', () => {
  const out = e(0, 200, { fadeStart: 190, settle: 194 }), inc = e(1.5, 180);
  const on = { automix: true, albumRunsOn: false, segment: null, out, inc };
  assert.deepStrictEqual(nextPlan(on), { mix: mixPlan(out, inc), startAt: 1.5 });
  for (const change of [{ automix: false }, { segment: { start: 0, end: 60 } }]) {
    assert.deepStrictEqual(nextPlan({ ...on, ...change }), { mix: null, startAt: 0 }, JSON.stringify(change));
  }
  // this song's edges not known (yet): a gapless seam at its end, but still past the next one's leading silence
  assert.deepStrictEqual(nextPlan({ ...on, out: undefined }), { mix: null, startAt: 1.5 });
  // the next one's not known: mixed, from its start
  assert.strictEqual(nextPlan({ ...on, inc: null }).startAt, 0);
  assert.ok(nextPlan({ ...on, inc: null }).mix);
});

test('nextPlan: an album played in order isn\'t mixed — only the silence between its songs is cut', () => {
  // The Bends: 3.3 s of silence after its sound, 0.05 s before High and Dry's.
  const out = e(1.15, 242.9), inc = e(0.05, 254.2);
  out.duration = 246.2;
  const album = { automix: true, albumRunsOn: true, segment: null, out, inc };
  assert.deepStrictEqual(nextPlan(album), { mix: { at: 242.9, overlap: 0, startAt: 0.05, fadeIn: 0, fadeFrom: 0, fadeOut: false }, startAt: 0.05 });
  // Songs that run into each other (a moment of silence at most) go on as they are, gapless.
  const flowing = { ...album, out: { ...out, end: 246, duration: 246.2 }, inc: e(0.1, 254.2) };
  assert.deepStrictEqual(nextPlan(flowing), { mix: null, startAt: 0 });
  // The silence mostly at the next one's start: both ends cut all the same.
  assert.deepStrictEqual(nextPlan({ ...flowing, inc: e(1.2, 254.2) }), { mix: { at: 246, overlap: 0, startAt: 1.2, fadeIn: 0, fadeFrom: 0, fadeOut: false }, startAt: 1.2 });
  // Edges not known: as before.
  assert.deepStrictEqual(nextPlan({ ...album, out: undefined, inc: undefined }), { mix: null, startAt: 0 });
});

test('prepareWindow: the usual lead, or early enough for the earliest mix', () => {
  assert.strictEqual(prepareWindow({ out: null, duration: 200, lead: 10 }), 10);
  // sound ends 6 s before the file does; a mix may start 10 s before that
  assert.strictEqual(prepareWindow({ out: e(0, 194), duration: 200, lead: 10 }), 26);
});

test('skipSilence: past the end of its sound, with nothing prepared, the next song comes now', () => {
  const base = { automix: true, out: e(0, 194), fileTime: 195, timeLeft: 5, prepared: false, crossfading: false, repeat: 'OFF', hasNext: true, albumRunsOn: false };
  assert.strictEqual(skipSilence(base), true);
  for (const change of [{ automix: false }, { out: null }, { fileTime: 193.9 }, { timeLeft: 0.2 }, { prepared: true }, { crossfading: true }, { repeat: 'TRACK' }, { hasNext: false }, { albumRunsOn: true }]) {
    assert.strictEqual(skipSilence({ ...base, ...change }), false, JSON.stringify(change));
  }
});

test('the clipping guard: the sound as it is below 0.9, bent smoothly towards full scale above, never past it', () => {
  const c = softClipCurve(4097);
  // as a WaveShaper reads it: input halved onto [-1, 1], linear between points, output doubled
  const at = (x) => { const i = ((x / 2 + 1) / 2) * (c.length - 1); const k = Math.floor(i), f = i - k; return (k + 1 < c.length ? c[k] * (1 - f) + c[k + 1] * f : c[k]) * 2; };
  for (const x of [0, 0.25, -0.5, 0.75, -0.89]) assert.ok(Math.abs(at(x) - x) < 1e-6, `${x} → ${at(x)}`);
  for (const x of [0.95, 1, 1.3, 2]) { assert.ok(at(x) <= 1 && at(x) > SOFT_FROM, `${x} → ${at(x)}`); assert.ok(Math.abs(at(-x) + at(x)) < 1e-6, 'symmetric'); }
  for (let i = 1; i < c.length; i++) assert.ok(c[i] >= c[i - 1], 'never folds back');
});
