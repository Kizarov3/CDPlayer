// Settings → AUTOMIX: as Apple Music's AutoMix — when the queue moves on to a song that isn't its album's next, that
// song's beginning plays over this one's end, where this one actually winds down (not where its file ends), so there's
// no silence between them. What's audible is found once per file from the song decoded at a low rate (edges); the mix
// is planned from both songs' edges (mixPlan). An album played in order stays gapless (continuesAlbum). No tempo or
// beat matching: the songs keep their own speed. Pure, for node --test.

const BLOCK = 0.05;       // the envelope's step, seconds
const SILENT_BELOW = 40;  // dB under the song's body: silence, room tone, a hiss tail
const ENDING_BELOW = 6;   // dB under the body, smoothed over a second: the song's ending (or quiet opening)
const SMOOTH = 1;         // seconds
export const MAX_OVERLAP = 10, MIN_ENDING = 2, DEAD_STOP_OVERLAP = 1, LOUD_FADE_IN = 3, QUIET_FADE_IN = 0.5;
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
 * fadeStart, introRise, body } in seconds (body in dBFS), or null for silence. start/end: the first and last audible
 * moment; fadeStart: where its ending begins (= end when it stops dead); introRise: how long after start it takes to
 * get loud (long for a song that fades in or opens quietly).
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
  const loud = body - ENDING_BELOW;
  let fade = last + 1;
  while (fade > first && smooth[fade - 1] < loud) fade--;
  let rise = first;
  while (rise <= last && smooth[rise] < loud) rise++;
  const start = Math.max(0, first * BLOCK - BLOCK), end = Math.min(duration, (last + 1) * BLOCK + BLOCK);
  return {
    duration, start, end, body,
    fadeStart: fade > last ? end : Math.max(start, fade * BLOCK),
    introRise: Math.max(0, Math.min(rise, last) * BLOCK - start),
  };
}

/**
 * The mix from `out` (the playing song's edges) into `inc` (the next one's, or null when not known) → { at, overlap,
 * startAt, fadeIn, fadeOut }: the next song starts at `startAt` (its own file time) when the playing one reaches `at`
 * (file time); they overlap for `overlap` s. fadeOut: the playing song fades (and loses its bass) over the overlap — an
 * ending; false: it plays its last second as it is — a song that stops dead keeps its final hit.
 */
export function mixPlan(out, inc) {
  const startAt = inc ? inc.start : 0;
  const tail = out.end - out.fadeStart, ending = tail >= MIN_ENDING;
  let overlap = ending ? Math.min(tail, MAX_OVERLAP) : DEAD_STOP_OVERLAP;
  overlap = Math.min(overlap, (out.end - out.start) / 3);
  if (inc) overlap = Math.min(overlap, (inc.end - inc.start) / 3);
  overlap = Math.max(0, overlap);
  const quietOpening = inc && inc.introRise >= MIN_ENDING;
  return { at: out.end - overlap, overlap, startAt, fadeIn: Math.min(overlap, quietOpening ? QUIET_FADE_IN : LOUD_FADE_IN), fadeOut: ending };
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
  const key = albumKey(da);
  if (key && key === albumKey(dbb)) {
    const ta = num(da.credits && da.credits.track), tb = num(dbb.credits && dbb.credits.track);
    const ka = num(da.credits && da.credits.disc) || 1, kb = num(dbb.credits && dbb.credits.disc) || 1;
    if (ta && tb && ((kb === ka && tb === ta + 1) || (kb === ka + 1 && tb === 1))) return true;
  }
  if (!inOrder) return false;
  // Tags that don't say (no track numbers; a compilation whose artist changes with each song): in order, the same album
  // name — or, with no album on either, the same folder.
  const name = (d) => (d && d.album ? String(d.album).toLowerCase() : null);
  if (name(da) || name(dbb)) return name(da) === name(dbb);
  return dirOf(a.path) === dirOf(b.path);
}
