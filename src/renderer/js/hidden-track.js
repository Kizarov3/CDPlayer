// Hidden tracks: a song hidden at the end of a disc's last track, after minutes of silence (Nevermind's "Endless,
// Nameless", Dookie's "All by Myself"). Found in the power of the file the waveform already decodes, 100 ms at a
// time. Pure, for node --test.

export const BLOCK_SECONDS = 0.1;
const SMOOTH_SECONDS = 1;
const MIN_SONG = 30; // a gap starts at least this far in (silence before a song is a pregap, not this)
const MIN_GAP_DIGITAL = 10, MIN_GAP_HISS = 30, HISS_SPREAD = 6; // seconds, seconds, dB
const MIN_HIDDEN = 20; // seconds of sound after the gap — not a click or a few seconds of noise
const RISE = 15; // dB over the gap that counts as sound
const db = (p) => (p > 1e-12 ? 10 * Math.log10(p) : -120);
const at = (sorted, q) => sorted[Math.floor(sorted.length * q)];

/** Each 100 ms block's mean power over every channel (the waveform is drawn from one; a gap must be silent in all). */
export function powerEnvelope(channels, sampleRate) {
  const n = channels[0] ? channels[0].length : 0, step = Math.round(sampleRate * BLOCK_SECONDS), blocks = Math.ceil(n / step);
  const power = new Float64Array(blocks);
  for (const x of channels) for (let i = 0; i < n; i++) power[(i / step) | 0] += x[i] * x[i];
  for (let b = 0; b < blocks; b++) power[b] /= channels.length * Math.min(step, n - b * step);
  return power;
}

/**
 * The longest gap of silence (digital, or steady hiss) followed by at least 20 s of sound → where the song before it
 * ends and the hidden song starts, in seconds; or null. The threshold follows the file's own floor: −70 dBFS over
 * digital silence or dither, up to −48 over tape hiss.
 */
export function detectHidden(power) {
  const blocks = power.length, half = Math.round(SMOOTH_SECONDS / BLOCK_SECONDS / 2), level = new Float64Array(blocks);
  let sum = 0, lo = 0, hi = -1;
  for (let b = 0; b < blocks; b++) {
    while (hi < Math.min(blocks - 1, b + half)) sum += power[++hi];
    while (lo < b - half) sum -= power[lo++];
    level[b] = db(sum / (hi - lo + 1));
  }
  if (!blocks) return null;
  const floor = at(Float64Array.from(level).sort(), 0.05);
  const threshold = Math.min(-48, Math.max(-70, floor + 12));
  const seconds = (b) => Math.round(b * BLOCK_SECONDS * 10) / 10;
  let best = null;
  for (let b = 0; b < blocks;) {
    if (level[b] >= threshold) { b++; continue; }
    let e = b;
    while (e < blocks && level[e] < threshold) e++;
    const length = (e - b) * BLOCK_SECONDS, run = Float64Array.from(level.subarray(b, e)).sort();
    const median = at(run, 0.5), digital = median < -70;
    const gap = digital ? length >= MIN_GAP_DIGITAL : length >= MIN_GAP_HISS && at(run, 0.95) - at(run, 0.05) <= HISS_SPREAD;
    if (gap && b * BLOCK_SECONDS >= MIN_SONG && (!best || length > best.length)) {
      const loud = Math.max(median + RISE, -60);
      let audible = 0, first = -1, last = -1;
      for (let k = e; k < blocks; k++) if (level[k] > loud) { audible++; if (first < 0) first = k; last = k; }
      if (audible * BLOCK_SECONDS >= MIN_HIDDEN && (last - first + 1) * BLOCK_SECONDS >= MIN_HIDDEN) {
        // The smoothing starts the sound half a second early: the first raw block over the level is where it starts.
        let start = Math.max(b, first - half);
        while (start < blocks && db(power[start]) <= loud) start++;
        best = { length, songEnd: seconds(b), hiddenStart: seconds(start) };
      }
    }
    b = e;
  }
  return best && { songEnd: best.songEnd, hiddenStart: best.hiddenStart };
}
