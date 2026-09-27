'use strict';
/**
 * A FLAC decoder, to check every file the ripper writes before it's kept (and in tests): 1–2 channels, 8–24 bits,
 * CONSTANT / VERBATIM / FIXED / LPC subframes with wasted bits, Rice and Rice2 residuals, every stereo mode; the frame
 * CRCs and the stream's MD5 are checked. Throws on anything wrong.
 */
const crypto = require('crypto');
const { crc8, crc16 } = require('./flac');

class BitReader {
  constructor(buf, byte = 0) { this.buf = buf; this.pos = byte * 8; }
  read(n) {
    let v = 0;
    for (let i = 0; i < n; i++) { v = v * 2 + ((this.buf[this.pos >> 3] >> (7 - (this.pos & 7))) & 1); this.pos++; }
    return v;
  }
  signed(n) { if (!n) return 0; const v = this.read(n); return v >= 2 ** (n - 1) ? v - 2 ** n : v; }
  unary() { let q = 0; while (!this.read(1)) { q++; if (this.pos > this.buf.length * 8) throw new Error('bad residual'); } return q; }
  align() { this.pos = (this.pos + 7) & ~7; }
  get byte() { return this.pos >> 3; }
}

function readUtf8(br) {
  const first = br.read(8);
  if (first < 0x80) return first;
  let ones = 0;
  while ((first << ones) & 0x80) ones++;
  let v = first & (0xff >> (ones + 1));
  for (let i = 1; i < ones; i++) v = v * 64 + (br.read(8) & 0x3f);
  return v;
}

function readResidual(br, x, n, order) {
  const method = br.read(2);
  if (method > 1) throw new Error('bad residual method');
  const pbits = method ? 5 : 4, escape = method ? 31 : 15;
  const porder = br.read(4), part = n >> porder;
  let i = order;
  for (let p = 0; p < (1 << porder); p++) {
    const count = p === 0 ? part - order : part, k = br.read(pbits);
    if (k === escape) { const bits = br.read(5); for (let c = 0; c < count; c++) x[i++] = br.signed(bits); continue; }
    for (let c = 0; c < count; c++) {
      const u = br.unary() * 2 ** k + br.read(k);
      x[i++] = u % 2 ? -(u + 1) / 2 : u / 2;
    }
  }
}

function readSubframe(br, n, bps) {
  if (br.read(1)) throw new Error('bad subframe');
  const type = br.read(6);
  let wasted = 0;
  if (br.read(1)) { wasted = 1; while (!br.read(1)) wasted++; }
  const b = bps - wasted, x = new Int32Array(n);
  if (type === 0) x.fill(br.signed(b));
  else if (type === 1) for (let i = 0; i < n; i++) x[i] = br.signed(b);
  else if ((type & 0x38) === 0x08 && (type & 7) <= 4) {
    const order = type & 7;
    for (let i = 0; i < order; i++) x[i] = br.signed(b);
    readResidual(br, x, n, order);
    for (let i = order; i < n; i++) {
      switch (order) {
        case 0: break;
        case 1: x[i] += x[i - 1]; break;
        case 2: x[i] += 2 * x[i - 1] - x[i - 2]; break;
        case 3: x[i] += 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3]; break;
        default: x[i] += 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4];
      }
    }
  } else if (type & 0x20) {
    const order = (type & 0x1f) + 1;
    for (let i = 0; i < order; i++) x[i] = br.signed(b);
    const precision = br.read(4) + 1;
    if (precision === 16) throw new Error('bad LPC precision');
    const shift = br.signed(5);
    if (shift < 0) throw new Error('bad LPC shift');
    const q = new Int32Array(order);
    for (let j = 0; j < order; j++) q[j] = br.signed(precision);
    readResidual(br, x, n, order);
    const div = 2 ** shift;
    for (let i = order; i < n; i++) { let s = 0; for (let j = 0; j < order; j++) s += q[j] * x[i - 1 - j]; x[i] += Math.floor(s / div); }
  } else throw new Error('bad subframe type');
  if (wasted) for (let i = 0; i < n; i++) x[i] *= 2 ** wasted;
  return x;
}

const RATES = [0, 88200, 176400, 192000, 8000, 16000, 22050, 24000, 32000, 44100, 48000, 96000];
const DEPTHS = [0, 8, 12, 0, 16, 20, 24, 0];

/** A FLAC file → { samples (interleaved Int32Array), sampleRate, channels, bps, totalSamples }. */
function decodeFlac(buf) {
  if (buf.toString('ascii', 0, 4) !== 'fLaC') throw new Error('bad: not FLAC');
  let p = 4, info = null;
  for (;;) {
    const last = buf[p] & 0x80, type = buf[p] & 0x7f, len = buf.readUIntBE(p + 1, 3);
    if (type === 0) {
      const br = new BitReader(buf, p + 4);
      br.read(16); br.read(16); br.read(24); br.read(24);
      info = { sampleRate: br.read(20), channels: br.read(3) + 1, bps: br.read(5) + 1, totalSamples: br.read(36), md5: buf.subarray(p + 4 + 18, p + 4 + 34) };
    }
    p += 4 + len;
    if (last) break;
  }
  if (!info) throw new Error('bad: no STREAMINFO');
  const { channels, bps } = info, samples = new Int32Array(info.totalSamples * channels);
  let at = 0;
  while (p < buf.length && at < samples.length) {
    const start = p, br = new BitReader(buf, p);
    if (br.read(14) !== 0x3ffe) throw new Error('bad frame sync');
    br.read(2);
    const bsCode = br.read(4), rateCode = br.read(4), chCode = br.read(4), sizeCode = br.read(3);
    br.read(1);
    readUtf8(br);
    let n;
    if (bsCode === 1) n = 192;
    else if (bsCode >= 2 && bsCode <= 5) n = 576 * 2 ** (bsCode - 2);
    else if (bsCode === 6) n = br.read(8) + 1;
    else if (bsCode === 7) n = br.read(16) + 1;
    else if (bsCode >= 8) n = 256 * 2 ** (bsCode - 8);
    else throw new Error('bad block size');
    if (rateCode === 12) br.read(8); else if (rateCode === 13 || rateCode === 14) br.read(16);
    const depth = sizeCode ? DEPTHS[sizeCode] : bps;
    if (br.read(8) !== crc8(buf, start, br.byte - 1)) throw new Error('bad header CRC');
    const nch = chCode < 8 ? chCode + 1 : 2;
    if (nch !== channels) throw new Error('bad channel count');
    const ch = [];
    for (let c = 0; c < nch; c++) {
      const side = (chCode === 8 && c === 1) || (chCode === 9 && c === 0) || (chCode === 10 && c === 1);
      ch.push(readSubframe(br, n, depth + (side ? 1 : 0)));
    }
    br.align();
    const crcAt = br.byte;
    if (br.read(16) !== crc16(buf, start, crcAt)) throw new Error('bad frame CRC');
    p = br.byte;
    for (let i = 0; i < n; i++) {
      let l, r;
      if (nch === 1) { samples[at++] = ch[0][i]; continue; }
      if (chCode === 8) { l = ch[0][i]; r = l - ch[1][i]; }
      else if (chCode === 9) { r = ch[1][i]; l = ch[0][i] + r; }
      else if (chCode === 10) { const s = ch[1][i], m = ch[0][i] * 2 + (s & 1); l = (m + s) >> 1; r = (m - s) >> 1; }
      else { l = ch[0][i]; r = ch[1][i]; }
      samples[at++] = l; samples[at++] = r;
    }
  }
  if (at !== samples.length) throw new Error('bad: fewer samples than STREAMINFO says');
  const md5 = Buffer.from(info.md5);
  if (md5.some((b) => b !== 0)) { // (some encoders leave it unset: all zeros)
    const bytes = Math.ceil(bps / 8), raw = Buffer.alloc(samples.length * bytes);
    for (let i = 0; i < samples.length; i++) raw.writeIntLE(samples[i], i * bytes, bytes);
    if (!crypto.createHash('md5').update(raw).digest().equals(md5)) throw new Error('bad MD5');
  }
  return { samples, sampleRate: info.sampleRate, channels, bps, totalSamples: info.totalSamples };
}

module.exports = { decodeFlac };
