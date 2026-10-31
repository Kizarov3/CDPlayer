'use strict';
/**
 * Any lossless file CDPlayer can read, as the 16-bit stereo 44.1 kHz audio the MP3 encoder takes (TAKE ALONG's MP3
 * 320): FLAC through the ripper's own decoder, WAV as it is, AIFF, AU and Apple Lossless through the playback
 * fallbacks (decoders/). A CD-quality file goes through untouched, sample for sample; anything else — 24-bit, 48 or
 * 96 kHz, mono, float — is brought to it: more than two channels down to the first two, the rate changed with a
 * windowed sinc (no aliasing, no dulled top end), and the depth cut to 16 bits with a little TPDF dither, as a
 * mastering engineer would.
 */
const path = require('path');
const { decodeFlac } = require('./flac-decode');
const { decodeToWav, fallbackKind } = require('../decoders');

const RATE = 44100;

/** What kind of lossless file a path is (by its name, and for .m4a its codec), or null: one this can't decode. */
function losslessKind(filePath, head) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (ext === 'flac') return 'flac';
  if (ext === 'wav' || ext === 'wave') return 'wav';
  return fallbackKind(filePath, head);
}

// ---- Reading -------------------------------------------------------------------------------------------------

/** A WAV file → { rate, channels: [Float32Array…] } (-1…1), or { rate, pcm16 } when it's CD audio already. */
function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let fmt = null, data = null;
  for (let p = 12; p + 8 <= buf.length;) {
    const id = buf.toString('ascii', p, p + 4), size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { tag: buf.readUInt16LE(p + 8), channels: buf.readUInt16LE(p + 10), rate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22), sub: size >= 40 ? buf.readUInt16LE(p + 32) : null };
    if (id === 'data') { data = buf.subarray(p + 8, Math.min(buf.length, p + 8 + size)); break; }
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('no audio in the WAV');
  const tag = fmt.tag === 0xfffe ? fmt.sub : fmt.tag, float = tag === 3, bytes = fmt.bits / 8, n = fmt.channels;
  if (!(tag === 1 || float) || ![8, 16, 24, 32].includes(fmt.bits) || (float && fmt.bits !== 32) || !n) throw new Error('a WAV of a kind that can\'t be converted');
  const frames = Math.floor(data.length / (bytes * n));
  if (!float && fmt.bits === 16 && n === 2 && fmt.rate === RATE) {
    return { rate: RATE, pcm16: new Int16Array(new Uint8Array(data.subarray(0, frames * 4)).buffer) };
  }
  const channels = Array.from({ length: n }, () => new Float32Array(frames));
  for (let f = 0, o = 0; f < frames; f++) {
    for (let c = 0; c < n; c++, o += bytes) {
      channels[c][f] = float ? data.readFloatLE(o)
        : fmt.bits === 8 ? (data[o] - 128) / 128
        : fmt.bits === 16 ? data.readInt16LE(o) / 32768
        : fmt.bits === 24 ? data.readIntLE(o, 3) / 8388608
        : data.readInt32LE(o) / 2147483648;
    }
  }
  return { rate: fmt.rate, channels, bits: float ? 32 : fmt.bits };
}

/** A FLAC file → as readWav. */
function readFlac(buf) {
  const { samples, sampleRate, channels: n, bps } = decodeFlac(buf);
  const frames = samples.length / n;
  if (bps === 16 && n === 2 && sampleRate === RATE) return { rate: RATE, pcm16: Int16Array.from(samples) };
  const scale = 2 ** (bps - 1), channels = Array.from({ length: n }, () => new Float32Array(frames));
  for (let f = 0; f < frames; f++) for (let c = 0; c < n; c++) channels[c][f] = samples[f * n + c] / scale;
  return { rate: sampleRate, channels, bits: bps };
}

/** A lossless file's bytes (`kind` from losslessKind) → as readWav. */
function readAudio(kind, buf) {
  if (kind === 'flac') return readFlac(buf);
  if (kind === 'wav') return readWav(buf);
  return readWav(decodeToWav(kind, buf));
}

// ---- Bringing it to CD audio ---------------------------------------------------------------------------------

const TAPS = 32, PHASES = 512;
const kernels = new Map();
// The filter for one rate change: PHASES rows (the fraction of a sample the output falls at) of `width` taps — a sinc
// cut off just under the lower of the two Nyquists, in a Blackman window, each row summing to 1.
function kernel(from, to) {
  const key = `${from}>${to}`;
  if (kernels.has(key)) return kernels.get(key);
  const cutoff = Math.min(1, to / from) * 0.97, half = Math.ceil(TAPS / cutoff), width = half * 2;
  const table = new Float32Array((PHASES + 1) * width);
  for (let ph = 0; ph <= PHASES; ph++) {
    const frac = ph / PHASES;
    let sum = 0;
    for (let k = 0; k < width; k++) {
      const x = k - half + 1 - frac, u = x / half; // u: −1…1 across the window
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * cutoff * x) / (Math.PI * cutoff * x);
      const w = Math.abs(u) >= 1 ? 0 : 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u);
      table[ph * width + k] = sinc * w;
      sum += sinc * w;
    }
    for (let k = 0; k < width; k++) table[ph * width + k] /= sum;
  }
  const k = { table, width, half };
  kernels.set(key, k);
  return k;
}

/** One channel from `from` Hz to `to` Hz. */
function resample(x, from, to) {
  if (from === to) return x;
  const { table, width, half } = kernel(from, to), step = from / to, n = Math.floor((x.length * to) / from), out = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    const t = j * step, i0 = Math.floor(t), row = Math.round((t - i0) * PHASES) * width, start = i0 - half + 1;
    let s = 0;
    if (start >= 0 && start + width <= x.length) {
      for (let k = 0; k < width; k++) s += x[start + k] * table[row + k];
    } else {
      for (let k = 0; k < width; k++) { const i = start + k; if (i >= 0 && i < x.length) s += x[i] * table[row + k]; }
    }
    out[j] = s;
  }
  return out;
}

/**
 * Decoded audio (readAudio's) → interleaved 16-bit stereo at 44.1 kHz. `from`/`to`: seconds, to take only part of it
 * (a cue sheet's track out of an album-length file; `to` null: to the end). `random` is for the tests.
 */
function toCdAudio(audio, { from = 0, to = null, random = Math.random } = {}) {
  const cut = (frames) => [Math.min(frames, Math.round(from * audio.rate)), to == null ? frames : Math.min(frames, Math.round(to * audio.rate))];
  if (audio.pcm16) {
    const [a, b] = cut(audio.pcm16.length / 2);
    return audio.pcm16.slice(a * 2, b * 2);
  }
  const [a, b] = cut(audio.channels[0].length);
  const left = audio.channels[0].subarray(a, b), right = (audio.channels[1] || audio.channels[0]).subarray(a, b);
  const l = resample(left, audio.rate, RATE), r = resample(right, audio.rate, RATE);
  // 16-bit audio that only had its rate changed, or anything deeper: dithered, ±1 LSB triangular.
  const dither = audio.rate !== RATE || audio.bits > 16, out = new Int16Array(l.length * 2);
  for (let i = 0; i < l.length; i++) {
    for (let c = 0; c < 2; c++) {
      const v = (c ? r : l)[i] * 32768 + (dither ? random() - random() : 0);
      out[i * 2 + c] = Math.max(-32768, Math.min(32767, Math.round(v)));
    }
  }
  return out;
}

module.exports = { RATE, losslessKind, readWav, readFlac, readAudio, resample, toCdAudio };
