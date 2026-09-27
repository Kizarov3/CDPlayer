'use strict';
// The FLAC encoder (for ripping) and the decoder that checks what it writes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { encodeFlac } = require('../src/main/encoders/flac');
const { decodeFlac } = require('../src/main/encoders/flac-decode');

// Interleaved stereo from a per-sample function (i → [left, right]).
function stereo(n, fn) {
  const pcm = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) { const [l, r] = fn(i); pcm[i * 2] = l; pcm[i * 2 + 1] = r; }
  return pcm;
}
function roundTrip(pcm, label) {
  const flac = encodeFlac(pcm);
  assert.strictEqual(flac.toString('ascii', 0, 4), 'fLaC', label);
  const out = decodeFlac(flac);
  assert.strictEqual(out.channels, 2); assert.strictEqual(out.bps, 16); assert.strictEqual(out.sampleRate, 44100);
  assert.strictEqual(out.totalSamples, pcm.length / 2, label);
  assert.strictEqual(out.samples.length, pcm.length, label);
  for (let i = 0; i < pcm.length; i++) if (out.samples[i] !== pcm[i]) assert.fail(`${label}: sample ${i} is ${out.samples[i]}, not ${pcm[i]}`);
  return flac;
}
let seed = 12345;
const noise = () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 16) - 32768; };

test('bit-exact round trips: silence, square, sweep, noise, left = right, extremes', () => {
  const silence = roundTrip(stereo(44100, () => [0, 0]), 'silence');
  assert.ok(silence.length < 2000, `silence is tiny (${silence.length} bytes)`);
  roundTrip(stereo(20000, (i) => ((i >> 6) & 1 ? [32767, -32768] : [-32768, 32767])), 'full-scale square');
  roundTrip(stereo(50000, (i) => { const v = Math.round(20000 * Math.sin((i * i) / 2e6)); return [v, Math.round(v * 0.7)]; }), 'sine sweep');
  roundTrip(stereo(30000, () => [noise(), noise()]), 'white noise');
  const same = roundTrip(stereo(30000, (i) => { const v = Math.round(12000 * Math.sin(i / 20)); return [v, v]; }), 'left = right');
  roundTrip(stereo(10000, () => [32767, -32768]), 'extreme stereo (a 17-bit side channel)');
  assert.ok(same.length < 30000 * 4 / 4, 'left = right compresses well (mid/side)');
});

test('odd lengths: not a multiple of 4096, shorter than the predictor, a single sample', () => {
  roundTrip(stereo(4096 * 3 + 123, (i) => [Math.round(8000 * Math.sin(i / 7)), Math.round(8000 * Math.cos(i / 9))]), 'last frame 123 samples');
  roundTrip(stereo(7, (i) => [i * 1000, -i * 1000]), '7 samples');
  roundTrip(stereo(1, () => [5, -5]), 'one sample');
});

test('a real recording: 16-bit fixture, and it compresses', () => {
  const wav = fs.readFileSync(path.join(__dirname, 'fixtures', 'ref16.wav'));
  let p = 12, fmt = null, data = null;
  while (p + 8 <= wav.length) { const id = wav.toString('ascii', p, p + 4), size = wav.readUInt32LE(p + 4); if (id === 'fmt ') fmt = p + 8; if (id === 'data') data = [p + 8, size]; p += 8 + size + (size & 1); }
  const channels = wav.readUInt16LE(fmt + 2), n = data[1] / 2 / channels;
  const pcm = stereo(n, (i) => { const l = wav.readInt16LE(data[0] + i * 2 * channels); return [l, channels === 2 ? wav.readInt16LE(data[0] + i * 4 + 2) : l]; });
  const flac = roundTrip(pcm, 'ref16.wav');
  assert.ok(flac.length < pcm.length * 2 * 0.9, `smaller than the raw audio (${flac.length} vs ${pcm.length * 2})`);
});

test('the decoder reads libFLAC\'s own output, MD5 and all (so it can be trusted to check ours)', () => {
  const out = decodeFlac(fs.readFileSync(path.join(__dirname, 'fixtures', 'smoke.flac')));
  assert.ok(out.totalSamples > 0);
});

test('a damaged file is caught', () => {
  const flac = encodeFlac(stereo(9000, (i) => [Math.round(9000 * Math.sin(i / 11)), 0]));
  const bad = Buffer.from(flac); bad[bad.length - 100] ^= 0x10;
  assert.throws(() => decodeFlac(bad), /CRC|MD5|sync|bad/i);
});

test('music-metadata reads our STREAMINFO', async () => {
  const { parseBuffer } = await import('music-metadata');
  const meta = await parseBuffer(encodeFlac(stereo(44100 * 2, (i) => [i % 200, -(i % 300)])), 'audio/flac');
  assert.strictEqual(meta.format.container, 'FLAC');
  assert.strictEqual(meta.format.numberOfChannels, 2);
  assert.strictEqual(meta.format.bitsPerSample, 16);
  assert.strictEqual(Math.round(meta.format.duration), 2);
});
