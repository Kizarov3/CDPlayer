import test from 'node:test';
import assert from 'node:assert';
import {
  edges, mixPlan, continuesAlbum, nextPlan, prepareWindow, skipSilence, softClipCurve,
  SOFT_FROM, MAX_OVERLAP, MIN_OVERLAP, MIN_ENDING, DEAD_STOP_OVERLAP, FULL_TILT_OVERLAP, LOUD_FADE_IN, QUIET_FADE_IN,
} from '../src/renderer/js/automix.js';

// Edge cases for automix.js beyond automix.test.mjs: synthetic signals for edges(), randomized invariants for mixPlan().

const RATE = 8000;
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} not within ${tol} of ${b}`);
// A deterministic PRNG (mulberry32), so a failure can be reproduced.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// A 440 Hz tone at amplitude 0.5 × shape(t), `seconds` long, one channel.
function tone(seconds, shape) {
  const x = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < x.length; i++) x[i] = shape(i / RATE) * 0.5 * Math.sin((2 * Math.PI * 440 * i) / RATE);
  return x;
}
const loud = (from, to) => (t) => (t >= from && t < to ? 1 : 0);
const dB = (d) => 10 ** (d / 20);

// ---- edges() ------------------------------------------------------------------------------------------------------

test('edges: stereo with one silent channel finds the same edges as the mono song, levels against its own body', () => {
  const mono = tone(30, loud(2, 24));
  const a = edges([mono], RATE), b = edges([mono, new Float32Array(mono.length)], RATE);
  for (const k of ['start', 'end', 'fadeStart', 'settle', 'introRise', 'duration']) near(b[k], a[k], 1e-9, k);
  near(b.body, a.body - 10 * Math.log10(2), 1e-6, 'the body is the two channels averaged: 3 dB down');
  near(b.endLevel, a.endLevel, 1e-6, 'endLevel is relative to the body');
  near(b.headLevel, a.headLevel, 1e-6, 'headLevel too');
  // the silent channel first makes no difference either
  const c = edges([new Float32Array(mono.length), mono], RATE);
  for (const k of ['start', 'end', 'fadeStart', 'settle']) near(c[k], a[k], 1e-9, `${k} (silent left)`);
});

test('edges: a song shorter than a second is found whole, its edges inside the file', () => {
  for (const seconds of [0.01, 0.2, 0.5, 0.95]) {
    const e = edges([tone(seconds, () => 1)], RATE);
    assert.ok(e, `${seconds} s: not silence`);
    near(e.duration, seconds, 1e-9, `${seconds} s duration`);
    assert.ok(e.start >= 0 && e.start <= e.fadeStart && e.fadeStart <= e.settle && e.settle <= e.end && e.end <= e.duration,
      `${seconds} s: ordered edges ${JSON.stringify(e)}`);
    near(e.start, 0, 1e-9, `${seconds} s start`); near(e.end, seconds, 1e-9, `${seconds} s end`);
    for (const k of ['endLevel', 'headLevel', 'introRise', 'body']) assert.ok(Number.isFinite(e[k]), `${seconds} s ${k}: ${e[k]}`);
    // and a mix out of / into it never takes more than a third of it
    const p = mixPlan(e, e);
    assert.ok(p.overlap <= seconds / 3 + 1e-9 && p.at >= e.start, `${seconds} s plan ${JSON.stringify(p)}`);
  }
  // a single sample of sound
  const one = new Float32Array(RATE); one[RATE / 2] = 0.5;
  const e = edges([one], RATE);
  assert.ok(e && e.start <= 0.5 && e.end >= 0.5 && e.end - e.start <= 0.2, JSON.stringify(e));
});

test('edges: a 2 s song stops dead at its end, and mixes in at most a third of it', () => {
  const e = edges([tone(2, () => 1)], RATE);
  near(e.start, 0, 1e-9, 'start'); near(e.end, 2, 1e-9, 'end');
  near(e.fadeStart, e.end, 1e-9, 'no ending'); near(e.settle, e.end, 1e-9, 'no dying away');
  const into = mixPlan(edges([tone(200, () => 1)], RATE), e), outOf = mixPlan(e, edges([tone(200, () => 1)], RATE));
  assert.ok(into.overlap <= 2 / 3 + 1e-9, `into: ${into.overlap}`); assert.ok(outOf.overlap <= 2 / 3 + 1e-9, `out of: ${outOf.overlap}`);
  assert.strictEqual(outOf.fadeOut, false);
});

test('edges: a quiet gap in the middle of a song is not its ending', () => {
  // full for 10 s, 2 s of silence, full again to 30 s
  const e = edges([tone(30, (t) => (t < 10 || t >= 12 ? 1 : 0))], RATE);
  near(e.start, 0, 0.1, 'start'); near(e.end, 30, 0.1, 'end');
  near(e.fadeStart, e.end, 0.01, 'the gap is not where it winds down'); near(e.settle, e.end, 0.01, 'nor where it dies away');
  // a quiet passage (-20 dB, 5 s) mid-song, too
  const q = edges([tone(40, (t) => (t >= 15 && t < 20 ? 0.1 : 1))], RATE);
  near(q.end, 40, 0.1, 'end'); near(q.fadeStart, q.end, 0.01, 'quiet passage: not the ending');
  // a quiet passage right after the opening doesn't make it a quiet opening
  const r = edges([tone(40, (t) => (t >= 3 && t < 8 ? 0.01 : 1))], RATE);
  near(r.introRise, 0, 0.6, 'loud from the start');
});

test('edges: a hidden track after a long silence is part of the song (its sound ends at the hidden track\'s end)', () => {
  // 20 s of song, 60 s of digital silence, a 10 s hidden track
  const e = edges([tone(90, (t) => (t < 20 || t >= 80 ? 1 : 0))], RATE);
  near(e.start, 0, 0.1, 'start'); near(e.end, 90, 0.1, 'end: the last audible moment is the hidden track\'s');
  near(e.fadeStart, e.end, 0.01, 'stops dead');
  // so the mix comes at the hidden track's end, not in the silence before it
  const p = mixPlan(e, edges([tone(100, () => 1)], RATE));
  assert.ok(p.at > 80, `at ${p.at}`);
  // and skipSilence waits for the hidden track to finish
  assert.strictEqual(skipSilence({ automix: true, out: e, fileTime: 50, timeLeft: 40, prepared: false, crossfading: false, repeat: 'OFF', hasNext: true, albumRunsOn: false }), false);
  // a hidden track much quieter than the song (-30 dB) still counts: it's above the 40 dB floor
  const quiet = edges([tone(90, (t) => (t < 20 ? 1 : t >= 80 ? dB(-30) : 0))], RATE);
  near(quiet.end, 90, 0.1, 'a quiet hidden track is still sound');
  assert.ok(quiet.fadeStart <= 20.5, `…but the song winds down where the loud part stops: ${quiet.fadeStart}`);
});

test('edges: a hiss tail 50 dB under the song, and a DC offset, are silence', () => {
  const r = rng(1);
  const body = tone(30, (t) => (t < 20 ? 1 : 0));
  // uniform noise of mean square 0.125 × 10^-5 (the tone's power, 50 dB down)
  const a = Math.sqrt(3 * 0.125 * 1e-5);
  const hiss = Float32Array.from(body, (v, i) => (i / RATE >= 20 ? (r() * 2 - 1) * a : v));
  const e = edges([hiss], RATE);
  near(e.end, 20, 0.1, 'the hiss is not sound'); near(e.fadeStart, e.end, 0.01, 'and not an ending');
  // a DC offset of 0.002 (-54 dBFS) under the whole file, silence included
  const dc = Float32Array.from(body, (v) => v + 0.002);
  const d = edges([dc], RATE);
  near(d.start, 0, 0.1, 'start'); near(d.end, 20, 0.1, 'end: the offset alone is silence');
  // a near-silent opening hiss before the music is not its start
  const lead = Float32Array.from(tone(30, (t) => (t >= 3 ? 1 : 0)), (v, i) => (i / RATE < 3 ? (r() * 2 - 1) * a : v));
  near(edges([lead], RATE).start, 3, 0.1, 'start past the hiss');
});

test('edges: a clipped full-scale square wave is loud end to end and stops dead, at full tilt', () => {
  const x = new Float32Array(25 * RATE);
  for (let i = 0; i < 20 * RATE; i++) x[i] = (Math.floor(i / 10) % 2 ? 1 : -1) * 1.2; // past full scale, as a decoder can give
  const e = edges([x], RATE);
  near(e.start, 0, 1e-9, 'start'); near(e.end, 20, 0.1, 'end');
  near(e.body, 20 * Math.log10(1.2), 1e-3, 'body (dBFS, above 0)');
  near(e.endLevel, 0, 0.01, 'endLevel'); near(e.headLevel, 0, 0.01, 'headLevel'); near(e.introRise, 0, 1e-9, 'introRise');
  near(e.fadeStart, e.end, 1e-9, 'stops dead');
  const p = mixPlan(e, e);
  near(p.overlap, FULL_TILT_OVERLAP, 1e-9, 'two loud things: an instant'); assert.strictEqual(p.fadeOut, false);
});

test('edges: a long reverb tail is an ending; the next song comes in once it has died away, under what\'s left of it', () => {
  // full for 20 s, then an exponential decay with RT60 = 6 s (10 dB a second) for 10 s
  const e = edges([tone(30, (t) => (t < 20 ? 1 : dB(-(t - 20) * 10)))], RATE);
  assert.ok(e.fadeStart > 20 && e.fadeStart < 21, `the ending begins as the tail does: ${e.fadeStart}`);
  assert.ok(e.settle > e.fadeStart && e.settle < 23, `24 dB down after about 2.4 s: ${e.settle}`);
  assert.ok(e.end > 23.5 && e.end < 24.5, `the tail is sound until 40 dB down, 4 s in: ${e.end}`);
  assert.ok(e.end - e.fadeStart >= MIN_ENDING, 'long enough to be an ending');
  assert.ok(e.endLevel < -20, `its last second is faint: ${e.endLevel}`);
  const p = mixPlan(e, edges([tone(200, () => 1)], RATE));
  assert.strictEqual(p.fadeOut, true);
  near(p.at, e.settle, 1e-9, 'at the moment it has died away');
  near(p.overlap, e.end - e.settle, 1e-9, 'overlapping the rest of the tail');
});

// ---- mixPlan() ----------------------------------------------------------------------------------------------------

// Edges as edges() makes them: start ≤ fadeStart ≤ settle ≤ end ≤ duration, levels in dB under the body.
function randomEdges(r) {
  const start = r() < 0.2 ? 0 : r() * 8;
  const pick = r();
  const audible = pick < 0.1 ? r() * 1 : pick < 0.2 ? 1 + r() * 5 : pick < 0.9 ? 30 + r() * 400 : 600 + r() * 3000;
  const end = start + audible;
  const tailKind = r();
  const fadeStart = tailKind < 0.4 ? end : tailKind < 0.6 ? end - r() * Math.min(audible, 2.5) : start + r() * audible;
  const settle = r() < 0.3 ? fadeStart : r() < 0.5 ? end : fadeStart + r() * (end - fadeStart);
  return {
    duration: end + r() * 30, start, end, fadeStart, settle, body: -10 - r() * 30,
    introRise: r() < 0.5 ? r() * 1 : r() * Math.min(audible, 20),
    endLevel: -r() * 60, headLevel: -r() * 60,
  };
}

test('mixPlan: invariants over 20 000 random pairs of edges', () => {
  const r = rng(20261017);
  for (let n = 0; n < 20000; n++) {
    const out = randomEdges(r), inc = r() < 0.15 ? null : randomEdges(r);
    const p = mixPlan(out, inc), why = () => `#${n} ${JSON.stringify({ out, inc, p })}`;
    for (const k of ['at', 'overlap', 'startAt', 'fadeIn']) assert.ok(Number.isFinite(p[k]), `${k} finite ${why()}`);
    assert.strictEqual(typeof p.fadeOut, 'boolean', why());
    assert.ok(p.overlap >= 0 && p.overlap <= MAX_OVERLAP, `0 ≤ overlap ≤ 10 ${why()}`);
    assert.strictEqual(p.at, out.end - p.overlap, `at = end − overlap ${why()}`);
    assert.ok(p.at >= out.start, `at ≥ start ${why()}`);
    // (after an ending the next one may go on rising once the old one is gone; within a dead stop's overlap it's up)
    if (p.overlap > 0 && !p.fadeOut) assert.ok(p.fadeIn <= p.overlap, `fadeIn ≤ overlap ${why()}`);
    assert.ok(p.fadeIn >= 0, `fadeIn ≥ 0 ${why()}`);
    assert.strictEqual(p.startAt, inc ? inc.start : 0, `startAt ${why()}`);
    assert.ok(p.overlap <= (out.end - out.start) / 3 + 1e-9, `≤ a third of the playing song ${why()}`);
    if (inc) assert.ok(p.overlap <= (inc.end - inc.start) / 3 + 1e-9, `≤ a third of the next ${why()}`);
    // an ending that dies away fades (and loses its bass); a dead stop, or an ending still sounding at its end, doesn't
    assert.strictEqual(p.fadeOut, out.end - out.fadeStart >= MIN_ENDING && out.end - out.settle >= 0.5, `fadeOut ${why()}`);
    const third = Math.min((out.end - out.start) / 3, inc ? (inc.end - inc.start) / 3 : Infinity);
    if (p.fadeOut) {
      // never over its last words: no earlier than where it settled, unless the minimum second says so
      assert.ok(p.overlap <= Math.max(MIN_OVERLAP, out.end - out.settle) + 1e-9, `not before it settles ${why()}`);
      assert.ok(p.overlap >= Math.min(MIN_OVERLAP, third) - 1e-9, `at least a second (or a third) ${why()}`);
    } else {
      const fullTilt = out.endLevel > -5;
      near(p.overlap, Math.max(0, Math.min(fullTilt ? FULL_TILT_OVERLAP : DEAD_STOP_OVERLAP, third)), 1e-9, `dead stop ${why()}`);
    }
    const fadeIn = p.overlap <= 0 ? 0 : p.fadeOut ? (inc && inc.headLevel < -15 ? QUIET_FADE_IN : LOUD_FADE_IN)
      : Math.min(p.overlap, inc && inc.introRise >= MIN_ENDING ? QUIET_FADE_IN : LOUD_FADE_IN);
    near(p.fadeIn, fadeIn, 1e-12, `fadeIn ${why()}`);
  }
});

test('mixPlan: degenerate edges never give a negative or out-of-song overlap', () => {
  const z = { duration: 5, start: 2, end: 2, fadeStart: 2, settle: 2, introRise: 0, endLevel: 0, headLevel: 0 };
  const p = mixPlan(z, z);
  assert.deepStrictEqual([p.overlap, p.at, p.fadeIn], [0, 2, 0]);
  // the next song's edges back to front (a bad cache entry): no overlap, never negative
  const bad = { duration: 5, start: 4, end: 1, fadeStart: 1, settle: 1, introRise: 0, endLevel: -20, headLevel: -20 };
  const q = mixPlan({ duration: 200, start: 0, end: 200, fadeStart: 180, settle: 190, introRise: 0, endLevel: -40, headLevel: -20 }, bad);
  assert.strictEqual(q.overlap, 0); assert.strictEqual(q.at, 200); assert.strictEqual(q.fadeIn, 0);
  // exactly MIN_ENDING of tail is an ending; a hair less is a dead stop
  const tail = (t) => mixPlan({ duration: 200, start: 0, end: 200, fadeStart: 200 - t, settle: 199, introRise: 0, endLevel: -20, headLevel: -20 }, null).fadeOut;
  assert.strictEqual(tail(MIN_ENDING), true); assert.strictEqual(tail(MIN_ENDING - 1e-6), false);
});

// ---- continuesAlbum() ---------------------------------------------------------------------------------------------

const song = (album, track, disc, { artist = 'A', albumArtist = null, path = `/m/${album}/${track}.flac` } = {}) => ({
  path, details: { album, artist, credits: { albumArtist, track: track === undefined ? undefined : { no: track }, disc: disc === undefined ? undefined : { no: disc } } },
});

test('continuesAlbum: track and disc numbers given as strings', () => {
  assert.strictEqual(continuesAlbum(song('X', '3', '1'), song('X', '4', '1'), { inOrder: false }), true);
  assert.strictEqual(continuesAlbum(song('X', '12', '1'), song('X', '1', '2'), { inOrder: false }), true);
  assert.strictEqual(continuesAlbum(song('X', '03'), song('X', '04'), { inOrder: false }), true, 'zero-padded');
  assert.strictEqual(continuesAlbum(song('X', '3', '1'), song('X', '4', '2'), { inOrder: false }), false, 'next disc, not its first track');
  assert.strictEqual(continuesAlbum(song('X', '3', '2'), song('X', '4', '1'), { inOrder: false }), false, 'previous disc');
  // a missing disc number is disc 1, whichever side it's missing on
  assert.strictEqual(continuesAlbum(song('X', 3), song('X', 4, '1'), { inOrder: false }), true);
  assert.strictEqual(continuesAlbum(song('X', 9), song('X', 1, 2), { inOrder: false }), true);
  // unreadable numbers don't count
  assert.strictEqual(continuesAlbum(song('X', 'three'), song('X', 'four'), { inOrder: false }), false);
});

test('continuesAlbum: track number 0 or missing is no number — then only order and the album name decide', () => {
  for (const [a, b] of [[0, 1], [undefined, 1], [3, undefined], [0, 0], [null, null]]) {
    assert.strictEqual(continuesAlbum(song('X', a), song('X', b), { inOrder: false }), false, `${a}→${b} shuffled`);
    assert.strictEqual(continuesAlbum(song('X', a), song('X', b), { inOrder: true }), true, `${a}→${b} in order`);
    assert.strictEqual(continuesAlbum(song('X', a), song('Y', b), { inOrder: true }), false, `${a}→${b} another album`);
  }
  // disc 0 is disc 1
  assert.strictEqual(continuesAlbum(song('X', 3, 0), song('X', 4, 1), { inOrder: false }), true);
  // negative track numbers are no numbers
  assert.strictEqual(continuesAlbum(song('X', -1), song('X', 0), { inOrder: false }), false);
});

test('continuesAlbum: album and artist names are compared regardless of case', () => {
  assert.strictEqual(continuesAlbum(song('Abbey Road', 3, 1, { artist: 'The Beatles' }), song('ABBEY ROAD', 4, 1, { artist: 'the beatles' }), { inOrder: false }), true);
  assert.strictEqual(continuesAlbum(song('Mix', null), song('MIX', null), { inOrder: true }), true);
  // the album artist decides over the track artist
  assert.strictEqual(continuesAlbum(song('Hits', 3, 1, { artist: 'A', albumArtist: 'Various' }), song('hits', 4, 1, { artist: 'B', albumArtist: 'VARIOUS' }), { inOrder: false }), true);
  // the same album name by different album artists, shuffled: another album
  assert.strictEqual(continuesAlbum(song('Greatest Hits', 3, 1, { albumArtist: 'Queen' }), song('Greatest Hits', 4, 1, { albumArtist: 'ABBA' }), { inOrder: false }), false);
});

test('continuesAlbum: the same-folder rule understands Windows paths', () => {
  const bare = (path) => ({ path, details: { album: null, credits: {} } });
  const yes = (a, b) => assert.strictEqual(continuesAlbum(bare(a), bare(b), { inOrder: true }), true, `${a} / ${b}`);
  const no = (a, b) => assert.strictEqual(continuesAlbum(bare(a), bare(b), { inOrder: true }), false, `${a} / ${b}`);
  yes('C:\\Music\\Album\\01.flac', 'C:\\Music\\Album\\02.flac');
  no('C:\\Music\\Album\\01.flac', 'C:\\Music\\Other\\02.flac');
  no('C:\\Music\\Album\\01.flac', 'C:\\Music\\Album\\CD2\\01.flac');
  yes('C:\\Music\\Album/01.flac', 'C:\\Music\\Album\\02.flac'); // mixed separators
  yes('\\\\nas\\share\\Album\\01.flac', '\\\\nas\\share\\Album\\02.flac'); // UNC
  no('\\\\nas\\share\\A\\01.flac', '\\\\nas\\share\\B\\01.flac');
  // a folder named like a file doesn't confuse it
  yes('/m/Live.at.Wembley/01.flac', '/m/Live.at.Wembley/02.flac');
  // shuffled, the folder alone never says so
  assert.strictEqual(continuesAlbum(bare('C:\\M\\A\\1.flac'), bare('C:\\M\\A\\2.flac'), { inOrder: false }), false);
});

// The in-order fallback is meant for "tags that don't say" (automix.js: no track numbers, a compilation whose artist
// changes). Here the tags do say — the same album, tracks 3 and then 7 — yet in order it's still called the album
// running on, so a playlist that jumps within one album is played gapless instead of mixed.
test('continuesAlbum: in order, the same album but not its next track (tags say so) is not the album running on', () => {
  assert.strictEqual(continuesAlbum(song('X', 3), song('X', 7), { inOrder: true }), false, '3 → 7');
  assert.strictEqual(continuesAlbum(song('X', 4), song('X', 3), { inOrder: true }), false, '4 → 3');
});

// ---- nextPlan(), prepareWindow(), skipSilence() -------------------------------------------------------------------

test('nextPlan: whenever it mixes, the plan starts the next song where nextPlan says; never mixes without the playing song\'s edges', () => {
  const r = rng(7);
  for (let n = 0; n < 2000; n++) {
    const out = r() < 0.2 ? (r() < 0.5 ? null : undefined) : randomEdges(r);
    const inc = r() < 0.2 ? (r() < 0.5 ? null : undefined) : randomEdges(r);
    const args = { automix: r() < 0.8, albumRunsOn: r() < 0.2, segment: r() < 0.1 ? { start: 0, end: null } : null, out, inc };
    const frozen = JSON.stringify(args);
    const { mix, startAt } = nextPlan(args);
    assert.strictEqual(JSON.stringify(args), frozen, 'inputs untouched');
    if (!args.automix || args.segment || args.albumRunsOn) { assert.deepStrictEqual({ mix, startAt }, { mix: null, startAt: 0 }); continue; }
    assert.strictEqual(startAt, inc ? inc.start : 0);
    if (!out) assert.strictEqual(mix, null);
    else { assert.ok(mix); assert.strictEqual(mix.startAt, startAt, 'the standby is placed where the mix expects it'); }
  }
  // a cue track even with an end of null (to the end of the file) is never mixed
  assert.strictEqual(nextPlan({ automix: true, albumRunsOn: false, segment: { start: 0, end: null }, out: randomEdges(rng(1)), inc: null }).mix, null);
});

test('prepareWindow: never under the lead, and always early enough for the earliest mix', () => {
  const r = rng(3);
  for (let n = 0; n < 2000; n++) {
    const out = randomEdges(r), lead = r() * 20, duration = out.end + r() * 60;
    const w = prepareWindow({ out, duration, lead });
    assert.ok(w >= lead, 'at least the lead');
    const earliest = mixPlan(out, null).at;
    assert.ok(duration - w <= earliest - lead + 1e-9, `ready ${lead} s before the mix: window ${w}, mix at ${earliest}, duration ${duration}`);
  }
  // edges claiming sound past the file's end (or the length not known yet, 0): just the lead
  assert.strictEqual(prepareWindow({ out: { end: 300 }, duration: 200, lead: 10 }), 10);
  assert.strictEqual(prepareWindow({ out: { end: 30 }, duration: 0, lead: 10 }), 10);
  assert.strictEqual(prepareWindow({ out: undefined, duration: 200, lead: 4 }), 4);
});

test('skipSilence: at its boundaries', () => {
  const base = { automix: true, out: { start: 0, end: 194 }, fileTime: 194, timeLeft: 0.3, prepared: false, crossfading: false, repeat: 'OFF', hasNext: true, albumRunsOn: false };
  assert.strictEqual(skipSilence(base), true, 'exactly at the end of its sound, exactly 0.3 s left');
  assert.strictEqual(skipSilence({ ...base, repeat: 'ALL' }), true, 'REPEAT ALL still skips');
  assert.strictEqual(skipSilence({ ...base, timeLeft: 0.2999 }), false, 'just under a moment left: let it end');
  assert.strictEqual(skipSilence({ ...base, fileTime: 193.999 }), false);
  assert.strictEqual(skipSilence({ ...base, out: undefined }), false, 'edges not known yet');
  assert.strictEqual(skipSilence({ ...base, timeLeft: Infinity }), true, 'length unknown');
});

// ---- softClipCurve() ----------------------------------------------------------------------------------------------

test('softClipCurve: odd n has an exact zero in the middle; even n is antisymmetric with none', () => {
  for (const n of [3, 5, 4097]) {
    const c = softClipCurve(n);
    assert.strictEqual(c.length, n);
    assert.strictEqual(c[(n - 1) / 2], 0, `n=${n}: silence stays silence`);
  }
  for (const n of [2, 4, 4096]) {
    const c = softClipCurve(n);
    assert.strictEqual(c.length, n);
    for (let i = 0; i < n; i++) assert.strictEqual(c[i], -c[n - 1 - i], `n=${n} i=${i}: symmetric`);
  }
  for (const n of [2, 3, 4, 5, 64, 4096, 4097]) {
    const c = softClipCurve(n);
    for (let i = 0; i < n; i++) {
      assert.ok(Number.isFinite(c[i]) && Math.abs(c[i]) <= 0.5, `n=${n} i=${i}: ${c[i]} (output doubled: within full scale)`);
      if (i) assert.ok(c[i] >= c[i - 1], `n=${n}: monotonic`);
    }
  }
});

test('softClipCurve: n = 2 maps the ends of [-2, 2] to just inside full scale', () => {
  const c = softClipCurve(2);
  assert.ok(c[0] < 0 && c[1] > 0);
  assert.ok(c[1] * 2 > SOFT_FROM && c[1] * 2 <= 1, `${c[1] * 2}`);
  assert.strictEqual(c[0], -c[1]);
});

test('softClipCurve: the default curve is the identity (halved) everywhere up to ±0.9 and smooth where it bends', () => {
  const n = 4097, c = softClipCurve();
  assert.strictEqual(c.length, n);
  const xOf = (i) => ((i / (n - 1)) * 2 - 1) * 2;
  let lastLinear = -1;
  for (let i = 0; i < n; i++) {
    const x = xOf(i);
    if (Math.abs(x) <= SOFT_FROM) { near(c[i], x / 2, 1e-7, `x=${x}`); if (x > 0) lastLinear = i; }
  }
  // the slope just above 0.9 matches the slope just below it (tanh′(0) = 1): no kink to hear
  const below = (c[lastLinear] - c[lastLinear - 1]) / (xOf(lastLinear) - xOf(lastLinear - 1));
  const above = (c[lastLinear + 2] - c[lastLinear + 1]) / (xOf(lastLinear + 2) - xOf(lastLinear + 1));
  near(above, below, 0.02, 'slope at the knee');
  // 2× full scale comes out within a hair of full scale
  near(c[n - 1] * 2, 1, 1e-6, 'top'); near(c[0] * 2, -1, 1e-6, 'bottom');
});
