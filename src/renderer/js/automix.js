// Settings → AUTOMIX: as Apple Music's AutoMix — when the queue moves on to a song that isn't its album's next, that
// song's beginning plays over this one's end, where this one actually winds down (not where its file ends), so there's
// no silence between them. What's audible is found once per file from the song decoded at a low rate (edges); the mix
// is planned from both songs' edges (mixPlan). An album played in order stays gapless (continuesAlbum). No tempo or
// beat matching: the songs keep their own speed. Pure, for node --test.

const BLOCK = 0.05;       // the envelope's step, seconds
const SILENT_BELOW = 40;  // dB under the song's body: silence, room tone, a hiss tail
const ENDING_BELOW = 6;   // dB under the body, smoothed over a second: the song's ending (or quiet opening)
const SETTLED_BELOW = 24; // …and where it has died away for good: the next song comes in there, not over its last words
const SMOOTH = 1;         // seconds
const GAP = 1;            // seconds of silence inside the sound (before a coda) that a mix mustn't start in
export const MAX_OVERLAP = 10, MIN_OVERLAP = 1, MIN_ENDING = 2, DEAD_STOP_OVERLAP = 1, FULL_TILT_OVERLAP = 0.3, LOUD_FADE_IN = 3, QUIET_FADE_IN = 0.5;
// A song whose last second is this close to its body stops at full tilt: the next one is only laid under it for an
// instant (two loud things at once sound like a collision, not a mix). dB.
const FULL_TILT_ABOVE = -5;
// After an ending, a song whose first second is this far under its body opens quietly and needs no long fade-in. dB.
const QUIET_HEAD_BELOW = -15;
// …and the next one comes in already at this much of its level (-10 dB), not from silence: rising from nothing, an
// opening hit (Master Of Puppets') would be lost and leave a hole where the old song has already gone.
export const AFTER_ENDING_FROM = 0.316;
export const BASS_CUT_HZ = 250;

/** Decodes `url` at 8 kHz (as the waveform is) and finds its edges. */
export async function measureEdges(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const audio = await new OfflineAudioContext(1, 1, 8000).decodeAudioData(buf);
  return edges(Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i)), audio.sampleRate);
}

const db = (meanSquare) => (meanSquare > 0 ? 10 * Math.log10(meanSquare) : -Infinity);

/**
 * Where the music is in a decoded song (`channels`: Float32Arrays at `sampleRate`) → { duration, start, end,
 * fadeStart, settle, gapEnd, introRise, endLevel, headLevel, body } in seconds (body in dBFS), or null for silence.
 * gapEnd: where the last second-or-longer silence inside the sound ends (before a quiet coda), else start.
 * start/end: the first and last audible moment; fadeStart: where its ending begins (= end when it stops dead); settle:
 * where that ending has died away for good (still singing quietly is not died away); introRise: how long after start
 * it takes to get loud (long for a song that fades in or opens quietly); endLevel / headLevel: its last / first second
 * of sound, in dB against its body.
 */
export function edges(channels, sampleRate) {
  const n = channels[0] ? channels[0].length : 0, step = Math.max(1, Math.round(sampleRate * BLOCK)), blocks = Math.ceil(n / step);
  const duration = n / sampleRate;
  if (!blocks) return null;
  const power = new Float64Array(blocks);
  for (const x of channels) for (let i = 0; i < n; i++) power[Math.floor(i / step)] += x[i] * x[i];
  for (let b = 0; b < blocks; b++) power[b] /= channels.length * Math.min(step, n - b * step);
  const level = Array.from(power, db);
  const sorted = level.filter((v) => v > -90).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const body = sorted[Math.floor(sorted.length * 0.75)]; // the median of the loudest half
  const floor = Math.max(body - SILENT_BELOW, -60);
  let first = -1, last = -1;
  for (let b = 0; b < blocks; b++) if (level[b] > floor) { if (first < 0) first = b; last = b; }
  if (first < 0) return null;
  // Each block's level over the second around it.
  const half = Math.round(SMOOTH / BLOCK / 2), smooth = new Array(blocks);
  let sum = 0, lo = 0, hi = -1;
  for (let b = 0; b < blocks; b++) {
    while (hi < Math.min(blocks - 1, b + half)) sum += power[++hi];
    while (lo < b - half) sum -= power[lo++];
    smooth[b] = db(sum / (hi - lo + 1));
  }
  // The first block from which the smoothed level stays below `below` to the end of the sound.
  const from = (below) => { let b = last + 1; while (b > first && smooth[b - 1] < below) b--; return b; };
  const fade = from(body - ENDING_BELOW), settled = from(body - SETTLED_BELOW);
  let rise = first;
  while (rise <= last && smooth[rise] < body - ENDING_BELOW) rise++;
  let gapEnd = first, run = 0;
  for (let b = last; b > first; b--) {
    if (level[b] > floor) { run = 0; continue; }
    if (++run >= GAP / BLOCK) { gapEnd = b + run; break; }
  }
  while (gapEnd > first && gapEnd <= last && level[gapEnd] <= floor) gapEnd++;
  const second = Math.round(1 / BLOCK), mean = (a, b) => { let t = 0; for (let k = a; k <= b; k++) t += power[k]; return t / (b - a + 1); };
  const start = Math.max(0, first * BLOCK - BLOCK), end = Math.min(duration, (last + 1) * BLOCK + BLOCK);
  const at = (b) => (b > last ? end : Math.max(start, b * BLOCK));
  return {
    duration, start, end, body,
    fadeStart: at(fade), settle: at(settled), gapEnd: gapEnd > first ? gapEnd * BLOCK : start,
    introRise: Math.max(0, Math.min(rise, last) * BLOCK - start),
    endLevel: db(mean(Math.max(first, last - second + 1), last)) - body,
    headLevel: db(mean(first, Math.min(last, first + second - 1))) - body,
  };
}

/**
 * The mix from `out` (the playing song's edges) into `inc` (the next one's, or null when not known) → { at, overlap,
 * startAt, fadeIn, fadeOut }: the next song starts at `startAt` (its own file time) when the playing one reaches `at`
 * (file time); they overlap for `overlap` s, and it rises from `fadeFrom` (of its level) to all of it over `fadeIn` s.
 * An ending that dies away (fadeOut): the next song comes in where it has died away for good (settle) — never over its
 * last words, nor in a silence before a coda — at most MAX_OVERLAP and at least MIN_OVERLAP before its end; it plays
 * its own decay, then fades and loses its bass. The next one comes in at -10 dB and rises over 3 s, however short the
 * overlap, unless it opens quietly — a loud song after a quiet ending mustn't jump in, nor its opening hit be lost.
 * Anything else — a dead stop, or an ending still sounding at its end (a last chord ringing out) — keeps its end as it
 * is: a second's overlap with the next one rising under it within that second, or only an instant when it stops at
 * full tilt.
 */
export function mixPlan(out, inc) {
  const startAt = inc ? inc.start : 0;
  const diesAway = out.end - out.fadeStart >= MIN_ENDING && out.end - out.settle >= 0.5;
  let overlap = diesAway ? Math.max(MIN_OVERLAP, out.end - Math.max(out.settle, out.gapEnd || out.start, out.end - MAX_OVERLAP))
    : out.endLevel > FULL_TILT_ABOVE ? FULL_TILT_OVERLAP : DEAD_STOP_OVERLAP;
  overlap = Math.min(overlap, (out.end - out.start) / 3);
  if (inc) overlap = Math.min(overlap, (inc.end - inc.start) / 3);
  overlap = Math.max(0, overlap);
  const fadeIn = diesAway ? (inc && inc.headLevel < QUIET_HEAD_BELOW ? QUIET_FADE_IN : LOUD_FADE_IN)
    : Math.min(overlap, inc && inc.introRise >= MIN_ENDING ? QUIET_FADE_IN : LOUD_FADE_IN);
  return { at: out.end - overlap, overlap, startAt, fadeIn: overlap > 0 ? fadeIn : 0, fadeFrom: diesAway ? AFTER_ENDING_FROM : 0, fadeOut: diesAway };
}

/**
 * How the queue's next song follows, gapless.js having found it can follow at all → { mix, startAt }: mixed in
 * (mixPlan), or (mix null) a gapless seam at the end — from startAt, past its leading silence when that's known.
 * Plain gapless, from 0, with AUTOMIX off, for a cue track, or when the album runs on.
 */
export function nextPlan({ automix, albumRunsOn, segment, out, inc }) {
  if (!automix || segment || albumRunsOn) return { mix: null, startAt: 0 };
  return { mix: out ? mixPlan(out, inc || null) : null, startAt: inc ? inc.start : 0 };
}

/** How long before its end the playing song's next one has to be ready: the earliest a mix can start, plus `lead`. */
export function prepareWindow({ out, duration, lead }) {
  return lead + (out ? Math.max(0, duration - out.end + MAX_OVERLAP) : 0);
}

/**
 * A mix that can't overlap (nothing was prepared — the next song needs the output at another rate) still loses the
 * silence: true once the playing song has passed the end of its sound (`fileTime`) with more than a moment of its file
 * left, so the next one should load now. Not while something is prepared or fading, nor under REPEAT ONE.
 */
export function skipSilence({ automix, out, fileTime, timeLeft, prepared, crossfading, repeat, hasNext, albumRunsOn }) {
  if (!automix || !out || prepared || crossfading || repeat === 'TRACK' || !hasNext || albumRunsOn) return false;
  return fileTime >= out.end && timeLeft >= 0.3;
}

/**
 * The guard against two songs adding up past full scale while they overlap: a WaveShaper curve over [-2, 2] (the
 * shaper's input is the signal halved, its output doubled again) — the signal as it is up to ±SOFT_FROM, then bent
 * smoothly towards ±1, which it never passes. Only while songs overlap; otherwise the shaper has no curve at all.
 */
export const SOFT_FROM = 0.9;
export function softClipCurve(n = 4097) {
  const c = new Float32Array(n), room = 1 - SOFT_FROM;
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2, a = Math.abs(x);
    const y = a <= SOFT_FROM ? a : SOFT_FROM + room * Math.tanh((a - SOFT_FROM) / room);
    c[i] = (Math.sign(x) * y) / 2;
  }
  return c;
}

const albumKey = (d) => (d && d.album ? `${(d.credits && d.credits.albumArtist) || d.artist || ''}\n${d.album}`.toLowerCase() : null);
const num = (x) => (x && Number.isFinite(Number(x.no)) && Number(x.no) > 0 ? Number(x.no) : null);
const dirOf = (p) => String(p || '').replace(/[\\/][^\\/]*$/, '');

/**
 * Whether `next` carries on `current`'s album — so it should follow gaplessly, never mixed. a / b: { path, details };
 * inOrder: the next song is the following queue entry with shuffle off.
 */
export function continuesAlbum(a, b, { inOrder }) {
  const da = a.details, dbb = b.details;
  const key = albumKey(da), sameKey = !!key && key === albumKey(dbb);
  // Tags that don't say whose album it is (a compilation whose artist changes with each song): played in order, the same
  // album name — or, with no album on either, the same folder.
  const name = (d) => (d && d.album ? String(d.album).toLowerCase() : null);
  const sameName = name(da) || name(dbb) ? name(da) === name(dbb) : dirOf(a.path) === dirOf(b.path);
  if (!sameKey && !(inOrder && sameName)) return false;
  // Track numbers, when both have them, say whether it's the album's next; without them, being next in the queue does.
  const ta = num(da.credits && da.credits.track), tb = num(dbb.credits && dbb.credits.track);
  if (ta && tb) {
    const ka = num(da.credits && da.credits.disc) || 1, kb = num(dbb.credits && dbb.credits.disc) || 1;
    return (kb === ka && tb === ta + 1) || (kb === ka + 1 && tb === 1);
  }
  return inOrder && sameName;
}
