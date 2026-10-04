// Sound Check's loudness: ITU-R BS.1770 integrated loudness (K-weighting, 400 ms blocks, the -70 LUFS and -10 LU
// gates) of a decoded song, and the gain that brings it to -18 LUFS — ReplayGain 2's reference, so a file's own
// ReplayGain tags and these measurements agree. Pure, for node --test.

export const TARGET_LUFS = -18;
export const MAX_MEASURE_SECONDS = 1200; // longer files (cue images, mixes) only by their tags: decoding them whole costs hundreds of MB
const PEAK_ROOM = 0.944; // -0.5 dB: the peak is measured on a resampled copy

/** BS.1770's two biquads — a high shelf (the head) and a high pass — worked out for any rate, as libebur128 does. */
export function kWeighting(sampleRate) {
  let f0 = 1681.974450955533, Q = 0.7071752369554196;
  const G = 3.999843853973347;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  f0 = 38.13547087602444; Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const hp = { b: [1, -2, 1], a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, hp];
}

/** Each 100 ms stretch's K-weighted energy (summed over channels), and the highest sample. */
function stepEnergies(channels, sampleRate) {
  const step = Math.round(sampleRate / 10), n = channels[0] ? channels[0].length : 0, steps = Math.floor(n / step);
  const energy = new Float64Array(steps);
  const [s, h] = kWeighting(sampleRate);
  let peak = 0;
  for (const x of channels) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;
    for (let i = 0; i < steps * step; i++) {
      const v = x[i];
      const a = Math.abs(v); if (a > peak) peak = a;
      const y = s.b[0] * v + s.b[1] * x1 + s.b[2] * x2 - s.a[1] * y1 - s.a[2] * y2;
      x2 = x1; x1 = v;
      const z = h.b[0] * y + h.b[1] * y1 + h.b[2] * y2 - h.a[1] * z1 - h.a[2] * z2;
      y2 = y1; y1 = y; z2 = z1; z1 = z;
      energy[Math.floor(i / step)] += z * z;
    }
  }
  return { energy, step, peak };
}

const lufs = (meanSquare) => -0.691 + 10 * Math.log10(meanSquare);

/** BS.1770 integrated loudness of `channels` (left, right…, weighted 1) → { loudness, peak }. */
export function integratedLoudness(channels, sampleRate) {
  const { energy, step, peak } = stepEnergies(channels, sampleRate);
  const blocks = [];
  for (let i = 0; i + 4 <= energy.length; i++) blocks.push((energy[i] + energy[i + 1] + energy[i + 2] + energy[i + 3]) / (4 * step));
  const loud = blocks.filter((z) => z > 0 && lufs(z) > -70);
  if (!loud.length) return { loudness: -Infinity, peak };
  const relative = lufs(loud.reduce((a, z) => a + z, 0) / loud.length) - 10;
  const gated = loud.filter((z) => lufs(z) > relative);
  return { loudness: lufs(gated.reduce((a, z) => a + z, 0) / gated.length), peak };
}

/** A measured song → its level: the gain (dB) to -18 LUFS and its peak. Silence → null. */
export function levelFromLoudness({ loudness, peak }) {
  return Number.isFinite(loudness) ? { gain: TARGET_LUFS - loudness, peak } : null;
}

/** An album's level from its songs' measurements: the power mean of their loudness, weighted by length; the highest peak. */
export function albumLevel(entries) {
  const ok = entries.filter((e) => Number.isFinite(e.loudness) && e.duration > 0);
  if (!ok.length) return null;
  const total = ok.reduce((a, e) => a + e.duration, 0);
  const power = ok.reduce((a, e) => a + e.duration * 10 ** (e.loudness / 10), 0) / total;
  return { gain: TARGET_LUFS - 10 * Math.log10(power), peak: Math.max(...ok.map((e) => e.peak || 0)) };
}

/** A level → the deck's gain: lowered as far as asked, raised only as far as the peak allows. */
export function trimFor({ gain, peak }) {
  const wanted = 10 ** (gain / 20), room = peak > 0 ? PEAK_ROOM / peak : Infinity;
  const linear = Math.min(wanted, room);
  return { linear, db: 20 * Math.log10(linear), limited: room < wanted };
}
