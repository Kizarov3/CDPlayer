import test from 'node:test';
import assert from 'node:assert';
import { kWeighting, integratedLoudness, levelFromLoudness, albumLevel, trimFor, TARGET_LUFS } from '../src/renderer/js/loudness.js';

const sine = (hz, db, rate, seconds) => {
  const a = 10 ** (db / 20), n = Math.round(rate * seconds), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = a * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
};
const mix = (rate, seconds) => { // band-limited below 8 kHz, so 16 kHz and 48 kHz see the same signal
  const n = Math.round(rate * seconds), out = new Float32Array(n);
  for (const [hz, a] of [[60, 0.2], [220, 0.2], [1000, 0.15], [3000, 0.1], [6000, 0.05]]) for (let i = 0; i < n; i++) out[i] += a * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
};
const close = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test('K-weighting at 48 kHz matches BS.1770 table 1 and 2', () => {
  const [shelf, hp] = kWeighting(48000);
  [1.53512485958697, -2.69169618940638, 1.19839281085285].forEach((v, i) => close(shelf.b[i], v, 1e-6));
  [1, -1.69065929318241, 0.73248077421585].forEach((v, i) => close(shelf.a[i], v, 1e-6));
  [1, -2, 1].forEach((v, i) => close(hp.b[i], v, 1e-6));
  [1, -1.99004745483398, 0.99007225036621].forEach((v, i) => close(hp.a[i], v, 1e-6));
});

test('a 1 kHz sine at 0 dBFS in one channel is -3.01 LUFS', () => {
  const r = integratedLoudness([sine(1000, 0, 48000, 5), new Float32Array(48000 * 5)], 48000);
  close(r.loudness, -3.01, 0.1);
  close(r.peak, 1, 1e-3);
});

test('a 1 kHz sine at -20 dBFS in both channels is -20 LUFS', () => {
  const s = sine(1000, -20, 48000, 5);
  close(integratedLoudness([s, s], 48000).loudness, -20, 0.1);
});

test('measured at 16 kHz, the same music is within 0.5 LU of 48 kHz', () => {
  const hi = integratedLoudness([mix(48000, 10), mix(48000, 10)], 48000).loudness;
  const lo = integratedLoudness([mix(16000, 10), mix(16000, 10)], 16000).loudness;
  close(lo, hi, 0.5);
});

test('gating ignores silence around the music', () => {
  const s = sine(1000, -20, 48000, 30), quiet = new Float32Array(48000 * 20); // long enough that the blocks half over the edges (which BS.1770 rightly counts) hardly matter
  const padded = new Float32Array(s.length + quiet.length * 2); padded.set(s, quiet.length);
  close(integratedLoudness([padded, padded], 48000).loudness, -20, 0.2);
});

test('silence gives no gain', () => {
  const z = new Float32Array(48000);
  const r = integratedLoudness([z, z], 48000);
  assert.strictEqual(r.loudness, -Infinity);
  assert.strictEqual(levelFromLoudness(r), null);
});

test('a level is the distance to -18 LUFS', () => {
  assert.deepStrictEqual(levelFromLoudness({ loudness: -10, peak: 1 }), { gain: -8, peak: 1 });
  assert.strictEqual(TARGET_LUFS, -18);
});

test('a boost stops at the peak, with half a dB to spare', () => {
  const t = trimFor({ gain: 6, peak: 0.9 });
  close(t.linear, 0.944 / 0.9, 1e-9);
  assert.strictEqual(t.limited, true);
  const cut = trimFor({ gain: -6, peak: 1 });
  close(cut.linear, 10 ** (-6 / 20), 1e-9);
  assert.strictEqual(cut.limited, false);
  close(cut.db, -6, 1e-9);
});

test('an album is the power mean of its songs, weighted by length, at its highest peak', () => {
  const a = albumLevel([{ loudness: -10, peak: 0.5, duration: 100 }, { loudness: -20, peak: 0.9, duration: 100 }]);
  close(a.gain, -18 - 10 * Math.log10((10 ** -1 + 10 ** -2) / 2), 1e-9);
  assert.strictEqual(a.peak, 0.9);
  assert.strictEqual(albumLevel([]), null);
  assert.strictEqual(albumLevel([{ loudness: -Infinity, peak: 0, duration: 10 }]), null);
});
