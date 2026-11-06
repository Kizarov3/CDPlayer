'use strict';
// The sums around the voice and aligning models: their spectrograms, a voice put back together, a change of sample rate.
// To the same conventions as the models were made with (torch's periodic Hann window, frames centred on reflected ends).

function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let l = 2; l <= n; l <<= 1) {
    const a = ((inverse ? 2 : -2) * Math.PI) / l, wr = Math.cos(a), wi = Math.sin(a), half = l >> 1;
    for (let i = 0; i < n; i += l) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const u = i + k, v = u + half, tr = re[v] * cr - im[v] * ci, ti = re[v] * ci + im[v] * cr;
        re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
const hann = (n) => Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
// The sample at `i` of a signal mirrored at its ends.
function reflected(x, i) {
  const last = x.length - 1;
  if (last <= 0) return last === 0 ? x[0] : 0;
  let k = Math.abs(i) % (2 * last);
  if (k > last) k = 2 * last - k;
  return x[k];
}

/**
 * What's left of a stereo song after `mask(frames)` has masked it, as mono: its spectrogram taken SPLIT frames at a time
 * (the first BINS bins of a SIZE-point transform), handed over as [left, right] magnitudes frame by frame, and given
 * back as a [left, right] mask of the same shape. Bins above BINS are dropped. `mask` may be async.
 */
async function maskedMono(left, right, { size, hop, bins, split }, mask) {
  const window = hann(size), length = left.length, frames = 1 + Math.floor(length / hop);
  const out = new Float32Array(length + size), norm = new Float32Array(length + size);
  const re = new Float64Array(size), im = new Float64Array(size), ore = new Float64Array(size), oim = new Float64Array(size);
  for (let from = 0; from < frames; from += split) {
    const count = Math.min(split, frames - from);
    const lr = new Float32Array(count * bins), li = new Float32Array(count * bins), rr = new Float32Array(count * bins), ri = new Float32Array(count * bins);
    const mags = [new Float32Array(split * bins), new Float32Array(split * bins)];
    for (let t = 0; t < count; t++) {
      const start = (from + t) * hop - (size >> 1);
      for (let i = 0; i < size; i++) { const at = start + i; re[i] = window[i] * (at >= 0 && at < length ? left[at] : reflected(left, at)); im[i] = window[i] * (at >= 0 && at < length ? right[at] : reflected(right, at)); }
      fft(re, im);
      for (let k = 0; k < bins; k++) {
        const c = re[(size - k) % size], d = im[(size - k) % size], o = t * bins + k;
        lr[o] = (re[k] + c) / 2; li[o] = (im[k] - d) / 2; rr[o] = (im[k] + d) / 2; ri[o] = (c - re[k]) / 2;
        mags[0][o] = Math.hypot(lr[o], li[o]); mags[1][o] = Math.hypot(rr[o], ri[o]);
      }
    }
    const [ml, mr] = await mask(mags);
    for (let t = 0; t < count; t++) {
      ore.fill(0); oim.fill(0);
      for (let k = 0; k < bins; k++) {
        const o = t * bins + k, a = (lr[o] * ml[o] + rr[o] * mr[o]) / 2, b = (li[o] * ml[o] + ri[o] * mr[o]) / 2;
        ore[k] = a; oim[k] = b;
        if (k) { ore[size - k] = a; oim[size - k] = -b; }
      }
      fft(ore, oim, true);
      const start = (from + t) * hop;
      for (let i = 0; i < size; i++) { const at = start + i; if (at < out.length) { out[at] += ore[i] * window[i]; norm[at] += window[i] * window[i]; } }
    }
  }
  const mono = new Float32Array(length), half = size >> 1;
  for (let i = 0; i < length; i++) { const w = norm[i + half]; mono[i] = w > 1e-8 ? out[i + half] / w : 0; }
  return mono;
}

/** A signal at another sample rate, through a windowed sinc (6 zero crossings, rolled off at 0.99 of the lower rate's limit). */
function resample(x, from, to) {
  if (from === to) return Float32Array.from(x);
  const gcd = (a, b) => (b ? gcd(b, a % b) : a), g = gcd(from, to), up = to / g, down = from / g;
  const cutoff = 0.99 * Math.min(1, to / from), reach = Math.ceil(6 / cutoff), span = 6 / cutoff;
  const table = [];
  for (let p = 0; p < up; p++) {
    const frac = (p * down) / up - Math.floor((p * down) / up), taps = new Float64Array(2 * reach + 1);
    for (let j = -reach; j <= reach; j++) {
      const d = j - frac;
      if (Math.abs(d) > span) continue;
      const w = Math.cos((Math.PI * d) / (2 * span)), s = d === 0 ? 1 : Math.sin(Math.PI * cutoff * d) / (Math.PI * cutoff * d);
      taps[j + reach] = cutoff * s * w * w;
    }
    table.push(taps);
  }
  const n = Math.floor((x.length * up) / down), out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const pos = k * down, centre = Math.floor(pos / up), taps = table[k % up];
    let sum = 0;
    for (let j = -reach; j <= reach; j++) { const at = centre + j; if (at >= 0 && at < x.length) sum += x[at] * taps[j + reach]; }
    out[k] = sum;
  }
  return out;
}

const hzToMel = (f) => 2595 * Math.log10(1 + f / 700), melToHz = (m) => 700 * (10 ** (m / 2595) - 1);
function melFilters(mels, size, rate) {
  const bins = (size >> 1) + 1, top = hzToMel(rate / 2);
  const points = Array.from({ length: mels + 2 }, (_, i) => melToHz((i * top) / (mels + 1)));
  return Array.from({ length: mels }, (_, m) => {
    const weights = new Float64Array(bins), a = points[m], b = points[m + 1], c = points[m + 2];
    for (let k = 0; k < bins; k++) { const f = (k * rate) / size; weights[k] = Math.max(0, Math.min((f - a) / (b - a), (c - f) / (c - b))); }
    return weights;
  });
}
let melBank = null;
/** The mel power spectrogram the aligning model takes (128 bands, 512-point, hop 256, 22 050 Hz): { data[band * T + t], T }. */
function melSpectrogram(x, mels = 128, size = 512, hop = 256, rate = 22050) {
  if (!melBank) melBank = melFilters(mels, size, rate);
  const T = 1 + Math.floor(x.length / hop), data = new Float32Array(mels * T), window = hann(size);
  const re = new Float64Array(size), im = new Float64Array(size), power = new Float64Array((size >> 1) + 1);
  for (let t = 0; t < T; t++) {
    const start = t * hop - (size >> 1);
    for (let i = 0; i < size; i++) { const at = start + i; re[i] = window[i] * (at >= 0 && at < x.length ? x[at] : reflected(x, at)); im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < power.length; k++) power[k] = re[k] * re[k] + im[k] * im[k];
    for (let m = 0; m < mels; m++) { const w = melBank[m]; let sum = 0; for (let k = 0; k < power.length; k++) if (w[k]) sum += w[k] * power[k]; data[m * T + t] = sum; }
  }
  return { data, T };
}
module.exports = { fft, hann, maskedMono, resample, melSpectrogram };
