'use strict';
// A line's known phones laid along the model's frames: the likeliest path through them in order, a gap allowed between any
// two, each given a frame at least. `song`: log-probabilities, `classes` per frame.
const { BLANK } = require('./phones');

/** Frames [from, to) of the song → [{ first, last }] (frames) per phone, or null if too few frames. */
function alignPhones(song, classes, from, to, ids) {
  const frames = to - from, n = ids.length, states = 2 * n + 1;
  if (!n || frames < n + 2) return null;
  const back = new Uint8Array(frames * states);
  let was = new Float64Array(states).fill(-Infinity), now = new Float64Array(states);
  was[0] = song[from * classes + BLANK];
  for (let t = 1; t < frames; t++) {
    const row = (from + t) * classes;
    now.fill(-Infinity);
    now[0] = was[0] + song[row + BLANK];
    for (let s = 1; s < states; s++) {
      if (s % 2) { // a phone: on from itself, the gap before it, or straight from the phone before
        const p = song[row + ids[(s - 1) >> 1]];
        let best = was[s], how = 0;
        if (was[s - 1] > best) { best = was[s - 1]; how = 1; }
        if (s >= 3 && was[s - 2] > best) { best = was[s - 2]; how = 2; }
        now[s] = best + p; back[t * states + s] = how;
      } else { // a gap: on from itself or the phone before
        const p = song[row + BLANK];
        let best = was[s], how = 0;
        if (was[s - 1] > best) { best = was[s - 1]; how = 1; }
        now[s] = best + p; back[t * states + s] = how;
      }
    }
    const swap = was; was = now; now = swap;
  }
  if (was[states - 1] === -Infinity) return null;
  const spans = Array.from({ length: n }, () => ({ first: -1, last: -1 }));
  let s = states - 1;
  for (let t = frames - 1; t >= 0; t--) {
    if (s % 2) { const span = spans[(s - 1) >> 1]; if (span.last < 0) span.last = from + t; span.first = from + t; }
    if (t) { const how = back[t * states + s]; s -= how; }
  }
  return spans.some((x) => x.first < 0) ? null : spans;
}
/**
 * The whole song's phones in one path, so that no line can run into another: `ids` in order, each allowed only in its
 * own frames `reach[k] = [from, to)`, as a line's time is only roughly right. → [{ first, last }] per phone, or null if
 * they can't all fit. (Backtracking keeps a byte per frame per phone in reach, not per phone in the song.)
 */
function alignSong(song, classes, frames, ids, reach) {
  const n = ids.length, states = 2 * n + 1;
  if (!n || frames < n + 2) return null;
  // Each frame's states in reach: from..to of the state numbers (a gap's reach joins the phones either side of it).
  const firstState = new Int32Array(frames), lastState = new Int32Array(frames).fill(-1);
  const stateFrom = (s) => (s % 2 ? reach[(s - 1) >> 1][0] : s === 0 ? 0 : reach[(s >> 1) - 1][0]);
  const stateTo = (s) => (s % 2 ? reach[(s - 1) >> 1][1] : s === states - 1 ? frames : reach[s >> 1][1]);
  let low = 0, high = -1;
  for (let t = 0; t < frames; t++) {
    while (high + 1 < states && stateFrom(high + 1) <= t) high++;
    while (low <= high && stateTo(low) <= t) low++;
    firstState[t] = low; lastState[t] = high;
  }
  const offset = new Int32Array(frames + 1);
  for (let t = 0; t < frames; t++) offset[t + 1] = offset[t] + Math.max(0, lastState[t] - firstState[t] + 1);
  const back = new Uint8Array(offset[frames]);
  let was = new Float64Array(states).fill(-Infinity), now = new Float64Array(states).fill(-Infinity);
  if (lastState[0] < 0 || firstState[0] !== 0) return null;
  was[0] = song[BLANK];
  for (let t = 1; t < frames; t++) {
    const row = t * classes, a = firstState[t], b = lastState[t];
    if (t >= 2) for (let s = firstState[t - 2]; s <= lastState[t - 2]; s++) now[s] = -Infinity; // (what this array held two frames ago)
    for (let s = a; s <= b; s++) {
      const gap = !(s % 2), p = song[row + (gap ? BLANK : ids[(s - 1) >> 1])];
      let best = was[s], how = 0;
      if (s >= 1 && was[s - 1] > best) { best = was[s - 1]; how = 1; }
      if (!gap && s >= 3 && was[s - 2] > best) { best = was[s - 2]; how = 2; }
      now[s] = best + p;
      back[offset[t] + s - a] = how;
    }
    const swap = was; was = now; now = swap;
  }
  if (lastState[frames - 1] !== states - 1 || was[states - 1] === -Infinity) return null;
  const spans = Array.from({ length: n }, () => ({ first: -1, last: -1 }));
  let s = states - 1;
  for (let t = frames - 1; t >= 0; t--) {
    if (s % 2) { const span = spans[(s - 1) >> 1]; if (span.last < 0) span.last = t; span.first = t; }
    if (t) s -= back[offset[t] + s - firstState[t]];
  }
  return spans.some((x) => x.first < 0) ? null : spans;
}
module.exports = { alignPhones, alignSong };
