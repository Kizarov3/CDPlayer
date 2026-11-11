// Lyrics found online are timed to someone's copy of the song, often not yours: a different master starts a little
// earlier or later, and some are simply a little off. This hears where the voice is in the file itself and says how far
// the whole song's lyrics sit from it — only when that's clear, since a wrong correction is worse than none.
import { lineWords, songPace } from './lyrics.js';

export const SYNC_RATE = 16000; // (a voice's band is well under half this)
const HOP = 320, SIZE = 1024, DT = HOP / SYNC_RATE; // (a frame each 20 ms)
const LOW = Math.round((250 * SIZE) / SYNC_RATE), HIGH = Math.round((3500 * SIZE) / SYNC_RATE);
const UPPER = Math.round((1000 * SIZE) / SYNC_RATE);
const REACH = Math.round(4 / DT); // how far either way it's looked for (frames)
const MIN_CLEAR = 0.6, AGREE_WITHIN = 0.25, MIN_MOVE = 0.1, MAX_MOVE = 2;

const hann = Float32Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SIZE));
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let l = 2; l <= n; l <<= 1) {
    const a = (-2 * Math.PI) / l, wr = Math.cos(a), wi = Math.sin(a), half = l >> 1;
    for (let i = 0; i < n; i += l) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const u = i + k, v = u + half, tr = re[v] * cr - im[v] * ci, ti = re[v] * ci + im[v] * cr;
        re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/**
 * The voice over time, from a song's channels at SYNC_RATE: what's in the middle of the stereo picture and not at its
 * sides (where a singer usually is, and guitars aren't), in the singing band, as a level per 20 ms frame. A frame's
 * two signals go through one transform as its real and imaginary parts. `rest()` is awaited now and then, for the
 * window to go on being drawn. → Float32Array.
 */
export async function voiceEnvelope(left, right, rest = async () => {}) {
  const frames = Math.max(0, Math.floor((left.length - SIZE) / HOP)), out = new Float32Array(frames);
  // (and how much more of its upper band is in the middle than at the sides: a voice lifts this, a band's guitars don't)
  out.centre = new Float32Array(frames);
  const re = new Float64Array(SIZE), im = new Float64Array(SIZE);
  for (let f = 0; f < frames; f++) {
    const at = f * HOP;
    // (scaled as 16-bit samples: the level's floor is a matter of how quiet counts as nothing)
    for (let i = 0; i < SIZE; i++) { const a = left[at + i] * 32768, b = right[at + i] * 32768; re[i] = (hann[i] * (a + b)) / 2; im[i] = (hann[i] * (a - b)) / 2; }
    fft(re, im);
    let mid = 0, side = 0, midUp = 0, sideUp = 0;
    for (let k = LOW; k <= HIGH; k++) {
      const a = re[k], b = im[k], c = re[SIZE - k], d = im[SIZE - k];
      const m = ((a + c) * (a + c) + (b - d) * (b - d)) / 4, sd = ((b + d) * (b + d) + (a - c) * (a - c)) / 4;
      mid += m; side += sd;
      if (k >= UPPER) { midUp += m; sideUp += sd; }
    }
    out[f] = Math.log10(1e3 + Math.max(0, mid - side));
    out.centre[f] = Math.log10((midUp + 1) / (sideUp + 1));
    if (f % 400 === 399) await rest();
  }
  return out;
}

const normalized = (a) => {
  let mean = 0;
  for (const v of a) mean += v;
  mean /= a.length || 1;
  let sum = 0;
  for (const v of a) sum += (v - mean) * (v - mean);
  const spread = Math.sqrt(sum / (a.length || 1)) || 1;
  return Float32Array.from(a, (v) => (v - mean) / spread);
};
// Whether words are being sung, per frame, as the lyrics have it; less its average, so a song sung throughout counts as much.
function sungFrames(lines, frames) {
  const mask = new Float32Array(frames), pace = songPace(lines);
  lines.forEach((line, i) => {
    if (!line.text) return;
    const end = i + 1 < lines.length ? lines[i + 1].time : line.time + 6;
    lineWords(line, end, pace).forEach((w, k, all) => {
      const stop = w.end !== undefined ? w.end : k + 1 < all.length ? all[k + 1].time : Math.min(end, w.time + 1.2);
      for (let f = Math.max(0, Math.round(w.time / DT)); f < Math.min(frames, Math.round(stop / DT)); f++) mask[f] = 1;
    });
  });
  let mean = 0;
  for (const v of mask) mean += v;
  mean /= frames || 1;
  return mask.map((v) => v - mean);
}
// The move that best lays those frames of the lyrics over the voice, and how much it stands out from the others.
function bestMove(voice, mask, from, to) {
  const scores = [];
  for (let lag = -REACH; lag <= REACH; lag++) {
    let sum = 0, n = 0;
    for (let f = from; f < to; f++) { const g = f + lag; if (g >= 0 && g < voice.length) { sum += voice[g] * mask[f]; n++; } }
    scores.push(n ? sum / n : -Infinity);
  }
  let at = 0;
  scores.forEach((v, i) => { if (v > scores[at]) at = i; });
  const sorted = [...scores].sort((a, b) => a - b), middle = sorted[sorted.length >> 1];
  const spread = sorted[Math.floor(sorted.length * 0.9)] - sorted[Math.floor(sorted.length * 0.1)] || 1e-6;
  return { move: (at - REACH) * DT, clear: (scores[at] - middle) / spread };
}

// (Moving a word that was right leaves the light behind the singing, which is worse than one left a little early: against
// separately aligned words, held from 1 s and breaks from 0.7 moved more words wrongly than rightly.)
const HELD_FROM = 1.5; // seconds: a word given this long may really be a held note
const LATE_BY = 1.5, ON_TIME = 0.15, ITS_OWN_END = 0.5; // how much later its end's looked for; nearer than this is on time; this near the next word's end is that word's
const A_BREATH = 2; // how far below the level around it a break has to be to end a held note: a voice really stopping
const AROUND = 25; // frames each side (half a second): the level a break is measured against
/** How far each frame's voice is under the level around it: a singer stopping to breathe is a deep, short drop. */
export function voiceBreaks(envelope) {
  const out = new Float32Array(envelope.length);
  for (let f = AROUND; f + AROUND < envelope.length; f++) {
    const near = Array.from(envelope.subarray(f - AROUND, f + AROUND + 1)).sort((a, b) => a - b);
    out[f] = Math.max(0, near[AROUND] - (envelope[f - 1] + envelope[f] + envelope[f + 1]) / 3);
  }
  return out;
}
// The deepest break between two times (seconds of the voice): { at, depth }.
function deepest(breaks, from, to) {
  let at = -1, depth = 0;
  for (let f = Math.max(0, Math.round(from / DT)), end = Math.min(breaks.length, Math.round(to / DT)); f < end; f++) if (breaks[f] > depth) { depth = breaks[f]; at = f; }
  return { at: at * DT, depth };
}
/**
 * Word timing often cuts a held note short — "Feed…" still being sung while the next words light up. Where a long word
 * has its deepest break clearly after the next word's stamp, the word is held up to that breath and the words stamped
 * before it are laid after it, keeping their shares of the time up to the next word that was right. `breaks`:
 * voiceBreaks'; `move`: lyricsMove's. → the lines with those words retimed, or null if none needed it. Only word-timed
 * lines; the words stay the same ones, in the same order.
 */
export function holdLongWords(breaks, lines, move = 0) {
  let changed = false;
  const out = lines.map((line, n) => {
    if (!line.words || line.words.length < 2) return line;
    const words = line.words.map((w) => ({ ...w }));
    const lineEnd = line.end !== undefined ? line.end : n + 1 < lines.length ? lines[n + 1].time : words[words.length - 1].time + 3;
    for (let i = 0; i + 1 < words.length; i++) {
      const word = words[i], next = words[i + 1];
      if (next.time - word.time < HELD_FROM || (word.end !== undefined && word.end < next.time - 0.05)) continue; // (a pause of its own after it)
      // (further into a long next word if its stamp runs on: "Jesus…" held through most of the time stamped for "Christ";
      // not to its very end, where a stop is only that word finishing)
      const nextStop = next.end !== undefined ? next.end : i + 2 < words.length ? words[i + 2].time : lineEnd;
      const after = deepest(breaks, next.time + ON_TIME + move, Math.min(Math.max(next.time + LATE_BY, nextStop - ITS_OWN_END), lineEnd) + move);
      const during = deepest(breaks, word.time + 0.4 + move, next.time + ON_TIME + move);
      if (after.depth < A_BREATH || during.depth >= after.depth) continue;
      let at = after.at - move, k = i + 1;
      while (k < words.length && words[k].time < at) k++;
      const until = k < words.length ? words[k].time : lineEnd, last = words[k - 1];
      at = Math.min(at, until - 0.1); // (a breath right before the next good word: what's between goes by quickly)
      const from = next.time, was = (last.end !== undefined ? last.end : until) - from, room = until - at;
      if (at <= from || was <= 0) continue;
      for (let m = i + 1; m < k; m++) {
        const w = words[m];
        w.time = at + ((w.time - from) / was) * room;
        if (w.end !== undefined) w.end = at + ((w.end - from) / was) * room;
      }
      word.end = at;
      changed = true;
      i = k - 1;
    }
    return { ...line, words };
  });
  return changed ? out : null;
}

const SETTLE = 12; // frames each side (about half a second in all) the centre's level is averaged over
const FALLEN = 0.25, FALLEN_FOR = 15, LONGER_BY = 0.3; // a voice has stopped when it's this far under the level it's been holding for this many frames; less longer than this isn't worth it
const A_LITTLE = 1, LONG_NOTE = 3, MUCH_TOO_LONG = 6; // seconds any last word may run on; stamped this long it's a held note already (going by its own level: its voice may sink a good way and go on); a short stamp held further than this is likelier a band
const SETTLED = 25, STAYS_DOWN = 40, FELL_BY = 0.25; // frames to go by what it's been holding, not the stamp's own level; frames after a stop it has to stay down for, on the whole, by this much
/**
 * A line's last word is often stamped shorter than it's sung ("rain…", stamped 0.4 s, sung for 4; "misery…" screamed on
 * after the light's gone out). It's held while the voice in the middle of the stereo picture stays at the level it's
 * been holding, if that voice is seen to stop before the next line (a band playing on looks the same, and never stops):
 * by a little for any word; further for one already held long, or when the level then falls and stays down, as it does
 * when a voice leaves a band (not a passing dip). Tried against separated voices: 16 of 44 such lines right, against 2
 * going by the stamp's own level and how high it stood in the song, with no more held on that weren't. `centre`: voiceEnvelope's; `pace`: songPace's, for
 * lines timed as a whole. → the lines with those words (and their lines) ended later, or null.
 */
export function holdLastWords(centre, lines, move = 0, pace = songPace(lines)) {
  if (!centre || !centre.length) return null;
  const level = (f) => { let sum = 0, n = 0; for (let g = Math.max(0, f - SETTLE); g <= Math.min(centre.length - 1, f + SETTLE); g++) { sum += centre[g]; n++; } return n ? sum / n : -Infinity; };
  let changed = false;
  const out = lines.map((line, n) => {
    if (!line.text) return line;
    const nextTime = n + 1 < lines.length ? lines[n + 1].time : line.time + 30;
    const words = (line.words && line.words.length ? line.words : lineWords(line, nextTime, pace)).map((w) => ({ ...w })), last = words[words.length - 1];
    const stop = last.end !== undefined ? last.end : Math.min(nextTime, last.time + 1.2);
    const from = Math.round((last.time + move) / DT), to = Math.round((stop + move) / DT);
    if (to <= from || nextTime - stop < LONGER_BY) return line;
    const heard = [];
    for (let f = from; f < to && f < centre.length; f++) heard.push(level(f));
    if (!heard.length) return line;
    heard.sort((a, b) => a - b);
    const own = heard[heard.length >> 1];
    // On past the stamp until it falls and stays fallen. Not seen to fall before the next line: left as it is.
    const limit = Math.min(centre.length - SETTLE, Math.round((nextTime - 0.1 + move) / DT));
    const stampedLong = last.end !== undefined && last.end - last.time >= LONG_NOTE;
    let endF = -1, under = 0, sum = 0, count = 0;
    for (let f = to; f < limit; f++) {
      const v = level(f), holding = count >= SETTLED && !stampedLong ? sum / count : own;
      if (v < holding - FALLEN) { if (++under >= FALLEN_FOR) { endF = f - under + 1; break; } } else { under = 0; sum += v; count++; }
    }
    if (endF < 0) return line;
    const until = endF * DT - move, more = until - stop;
    if (more < LONGER_BY) return line;
    if (more > A_LITTLE && !stampedLong) {
      if (more > MUCH_TOO_LONG) return line;
      const after = [];
      for (let f = endF; f < Math.min(limit, endF + STAYS_DOWN); f++) after.push(level(f));
      after.sort((a, b) => a - b);
      if (!count || sum / count - after[after.length >> 1] < FELL_BY) return line;
    }
    last.end = until;
    changed = true;
    return { ...line, words, end: until };
  });
  return changed ? out : null;
}

/**
 * What's asked of the word timing (main's word-fit): `lines`' sung ones, with their words, at their own times. (Not moved
 * first by lyricsMove: its small errors cost more here, against real word stamps, than the lines' own times do.)
 */
export function wordFitRequest(lines) {
  const out = [];
  lines.forEach((line, n) => {
    if (!line.text) return;
    const next = n + 1 < lines.length ? lines[n + 1].time : line.time + 12;
    out.push({ time: line.time, next, words: lineWords({ time: line.time, text: line.text }, next).map((w) => w.text.trim()) });
  });
  return out;
}
// Where each of a line's words starts in its own timing, the words split at spaces as the voice model gets them (a
// word may be in several timed pieces, as "gun" "s," or "tongue" "-" "tied").
function ownStarts(line) {
  const starts = [];
  let fresh = true;
  for (const part of line.words || []) {
    if (!part.text.trim()) { fresh = true; continue; }
    if (fresh) starts.push(part.time);
    fresh = /\s$/.test(part.text);
  }
  return starts;
}
/**
 * Hand-timed words (their lines' own `words`) checked against what came back for wordFitRequest's: how far the voice in
 * this file is from them over the whole song — the median of each word's difference, when most words agree on it (a
 * version of the song that starts a little sooner or later than the one they were timed to). → seconds (voice − words),
 * or 0: they're right already, or the voice doesn't agree with itself enough to move them by.
 */
export function handTimedShift(lines, words) {
  const diffs = [];
  lines.filter((l) => l.text).forEach((line, i) => {
    const got = words[i];
    if (!got || !line.words || !line.words.length) return;
    const starts = ownStarts(line);
    if (starts.length !== got.length) return;
    got.forEach((w, k) => { if (w && w.end > w.time) diffs.push(w.time - starts[k]); });
  });
  if (diffs.length < 20) return 0;
  diffs.sort((a, b) => a - b);
  const median = diffs[Math.floor(diffs.length / 2)];
  const agree = diffs.filter((d) => Math.abs(d - median) <= 0.3).length / diffs.length;
  return agree >= 0.6 && Math.abs(median) >= 0.1 ? Math.round(median * 1000) / 1000 : 0;
}

/**
 * `lines` with what came back for wordFitRequest's: each line timed by the voice takes its words' times (and starts
 * with its first word, not before the line before it); one that didn't get them keeps its own, moved by `move`, as all
 * these are in the file's time. → the lines (none then needs a whole-song move).
 */
export function linesFittedToWords(lines, words, move = 0) {
  let k = 0, last = -Infinity;
  const ownShift = wordsShift(lines, words, move);
  return lines.map((line, n) => {
    const fitted = line.text ? words[k++] : null;
    let out;
    if (fitted) {
      const next = n + 1 < lines.length ? lines[n + 1].time : line.time + 12;
      const parts = lineWords({ time: line.time, text: line.text }, next);
      const timed = keepOwnWhereUnheard(line, fitted, ownShift);
      out = { ...line, time: Math.max(timed[0].time, last), end: timed[timed.length - 1].end, words: parts.map((w, i) => ({ text: w.text, time: timed[i].time, end: timed[i].end, ...(timed[i].beats && timed[i].beats.length ? { beats: timed[i].beats } : {}) })) };
    } else {
      const shift = (w) => ({ ...w, time: w.time + move, ...(w.end !== undefined ? { end: w.end + move } : {}) });
      out = { ...line, time: Math.max(line.time + move, last), ...(line.end !== undefined ? { end: line.end + move } : {}), ...(line.words ? { words: line.words.map(shift) } : {}), ...(line.bg ? { bg: line.bg.map(shift) } : {}) };
    }
    last = out.time;
    return out;
  });
}

// How far the voice model's words are from the lyrics' own word times over the song, the median (the whole-song move,
// worked out from the voice's level alone, can be a few tenths off it); `move` when there are too few to tell.
function wordsShift(lines, words, move) {
  const diffs = [];
  lines.filter((l) => l.text).forEach((line, i) => {
    const got = words[i], starts = ownStarts(line);
    if (got && starts.length === got.length) got.forEach((w, k) => { if (w) diffs.push(w.time - starts[k]); });
  });
  if (diffs.length < 20) return move;
  diffs.sort((a, b) => a - b);
  return diffs[diffs.length >> 1];
}
// A word the voice model barely hears where it put it (`heard`, its sounds' likelihood there) and that far from the
// lyrics' own time for it was put where nothing could be heard to go by — a held note sung through effects, say
// (Myxomatosis's "tongue-tied", 1.1 s early): it keeps its own time, moved as the song's words are, its end at the next word's
// own start (or the line's end). Only for word-timed lyrics, and only where that leaves the words in their order.
const UNHEARD = 0.08, FAR_FROM_OWN = 0.8; // (likelihood; seconds)
function keepOwnWhereUnheard(line, fitted, shift) {
  const starts = ownStarts(line);
  if (starts.length !== fitted.length) return fitted;
  const lineEnd = line.end !== undefined ? line.end : (line.words[line.words.length - 1].end ?? line.words[line.words.length - 1].time);
  const out = fitted.slice();
  for (let i = 0; i < out.length; i++) {
    const f = out[i], own = starts[i] + shift;
    if (!(f.heard < UNHEARD) || Math.abs(f.time - own) <= FAR_FROM_OWN) continue;
    if ((i > 0 && out[i - 1].time > own) || (i + 1 < out.length && out[i + 1].time < own)) continue;
    const end = Math.max(own + 0.1, (i + 1 < starts.length ? starts[i + 1] : lineEnd) + shift);
    out[i] = { ...f, time: own, end, beats: (f.beats || []).filter((b) => b > own && b < end) };
  }
  return out;
}

/**
 * How far to move `lines` (parseLrc's) to lay them over `envelope` (voiceEnvelope's), + later: seconds, or 0 when it
 * isn't sure — the voice has to stand out clearly at one place, and at least two of the song's three thirds have to
 * say the same on their own (a song whose parts disagree isn't simply moved) — or it would hardly matter, or be so
 * far it's likelier wrong than a different master.
 */
export function lyricsMove(envelope, lines) {
  const sung = lines.filter((l) => l.text);
  if (sung.length < 6 || !envelope.length) return 0;
  const voice = normalized(envelope), mask = sungFrames(lines, envelope.length);
  const first = Math.round(sung[0].time / DT), last = Math.min(envelope.length, Math.round((lines[lines.length - 1].time + 4) / DT));
  if (last - first < REACH) return 0;
  const whole = bestMove(voice, mask, first, last), third = (last - first) / 3;
  if (whole.clear < MIN_CLEAR || Math.abs(whole.move) < MIN_MOVE || Math.abs(whole.move) > MAX_MOVE) return 0;
  let agree = 0;
  for (let k = 0; k < 3; k++) if (Math.abs(bestMove(voice, mask, Math.round(first + k * third), Math.round(first + (k + 1) * third)).move - whole.move) < AGREE_WITHIN) agree++;
  return agree >= 2 ? whole.move : 0;
}
