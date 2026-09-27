'use strict';
/**
 * A FLAC encoder in plain JavaScript, for ripping CDs (rip.js): 16-bit stereo 44.1 kHz in, a .flac file out —
 * lossless, nothing to install. Each 4096-sample frame keeps, per channel, the smallest of: a constant, the samples
 * as they are, a FIXED predictor (order 0–4) or an order-8 LPC predictor, its residual Rice-coded in 1–16 partitions;
 * and the smallest of the four ways FLAC stores stereo (left/right, left/side, side/right, mid/side).
 * https://xiph.org/flac/format.html
 */
const crypto = require('crypto');

const BLOCK = 4096;
const LPC_ORDER = 8, LPC_PRECISION = 15;
const MAX_PARTITION_ORDER = 4, MAX_RICE = 14;

class BitWriter {
  constructor(bytes = 1 << 16) { this.buf = new Uint8Array(bytes); this.pos = 0; }
  ensure(bits) {
    const need = (this.pos + bits + 7) >> 3;
    if (need <= this.buf.length) return;
    const grown = new Uint8Array(Math.max(need, this.buf.length * 2));
    grown.set(this.buf);
    this.buf = grown;
  }
  // `n` ≤ 30 bits of `value` (negative numbers as two's complement).
  write(value, n) {
    this.ensure(n);
    const v = value & ((1 << n) - 1);
    for (let i = n - 1; i >= 0; i--) {
      if ((v >> i) & 1) this.buf[this.pos >> 3] |= 0x80 >> (this.pos & 7);
      this.pos++;
    }
  }
  // q zero bits, then a one.
  unary(q) { this.ensure(q + 1); this.pos += q; this.buf[this.pos >> 3] |= 0x80 >> (this.pos & 7); this.pos++; }
  align() { this.pos = (this.pos + 7) & ~7; }
  get byte() { return this.pos >> 3; }
}

const CRC8 = new Uint8Array(256), CRC16 = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let c = i; for (let b = 0; b < 8; b++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  CRC8[i] = c;
  let d = i << 8; for (let b = 0; b < 8; b++) d = d & 0x8000 ? ((d << 1) ^ 0x8005) & 0xffff : (d << 1) & 0xffff;
  CRC16[i] = d;
}
function crc8(bytes, from, to) { let c = 0; for (let i = from; i < to; i++) c = CRC8[c ^ bytes[i]]; return c; }
function crc16(bytes, from, to) { let c = 0; for (let i = from; i < to; i++) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ bytes[i]]; return c; }

// ---- Residuals ----------------------------------------------------------------------------------------------------

// Rice codes signed numbers folded to unsigned: 0, -1, 1, -2, 2… → 0, 1, 2, 3, 4…
function fold(residual, order) {
  const f = new Uint32Array(residual.length);
  for (let i = order; i < residual.length; i++) { const r = residual[i]; f[i] = r >= 0 ? r * 2 : -r * 2 - 1; }
  return f;
}
function riceBits(folded, from, to, k) {
  let bits = (to - from) * (k + 1);
  for (let i = from; i < to; i++) bits += folded[i] >>> k;
  return bits;
}
// The cheapest partition order (0–4) and Rice parameter per partition. → { porder, params, bits } or null.
function bestRice(folded, n, order) {
  let best = null;
  for (let po = 0; po <= MAX_PARTITION_ORDER; po++) {
    if (n % (1 << po)) break;
    const part = n >> po;
    if (part <= order) break;
    let bits = 6;
    const params = [];
    for (let p = 0; p < (1 << po); p++) {
      const from = p === 0 ? order : p * part, to = (p + 1) * part;
      let sum = 0;
      for (let i = from; i < to; i++) sum += folded[i];
      const guess = Math.max(0, Math.min(MAX_RICE, Math.floor(Math.log2(sum / Math.max(1, to - from) + 1))));
      let bk = guess, bb = Infinity;
      for (let k = Math.max(0, guess - 1); k <= Math.min(MAX_RICE, guess + 1); k++) {
        const b = riceBits(folded, from, to, k);
        if (b < bb) { bb = b; bk = k; }
      }
      bits += 4 + bb;
      params.push(bk);
    }
    if (!best || bits < best.bits) best = { porder: po, params, bits };
  }
  return best;
}
function writeResidual(bw, folded, n, order, rice) {
  bw.write(0, 2); // Rice, 4-bit parameters
  bw.write(rice.porder, 4);
  const part = n >> rice.porder;
  for (let p = 0; p < (1 << rice.porder); p++) {
    const k = rice.params[p], mask = (1 << k) - 1;
    bw.write(k, 4);
    for (let i = p === 0 ? order : p * part, to = (p + 1) * part; i < to; i++) {
      bw.unary(folded[i] >>> k);
      if (k) bw.write(folded[i] & mask, k);
    }
  }
}

// ---- Predictors ---------------------------------------------------------------------------------------------------

function fixedResidual(x, order) {
  const r = new Int32Array(x.length);
  for (let i = order; i < x.length; i++) {
    switch (order) {
      case 0: r[i] = x[i]; break;
      case 1: r[i] = x[i] - x[i - 1]; break;
      case 2: r[i] = x[i] - 2 * x[i - 1] + x[i - 2]; break;
      case 3: r[i] = x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3]; break;
      default: r[i] = x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4];
    }
  }
  return r;
}

// Order-8 LPC: Welch-windowed autocorrelation, Levinson–Durbin, coefficients quantised to 15 bits.
function planLpc(x, bps) {
  const n = x.length, order = LPC_ORDER;
  const w = new Float64Array(n), h = (n - 1) / 2;
  for (let i = 0; i < n; i++) { const t = (i - h) / h; w[i] = x[i] * (1 - t * t); }
  const R = new Float64Array(order + 1);
  for (let lag = 0; lag <= order; lag++) { let s = 0; for (let i = lag; i < n; i++) s += w[i] * w[i - lag]; R[lag] = s; }
  if (!(R[0] > 0)) return null;
  const a = new Float64Array(order + 1);
  let err = R[0];
  for (let i = 1; i <= order; i++) {
    let acc = R[i];
    for (let j = 1; j < i; j++) acc -= a[j] * R[i - j];
    const k = acc / err, prev = a.slice();
    a[i] = k;
    for (let j = 1; j < i; j++) a[j] = prev[j] - k * prev[i - j];
    err *= 1 - k * k;
    if (!(err > 0)) return null;
  }
  let max = 0;
  for (let j = 1; j <= order; j++) max = Math.max(max, Math.abs(a[j]));
  if (!(max > 0)) return null;
  const shift = LPC_PRECISION - 2 - Math.floor(Math.log2(max));
  if (shift < 0 || shift > 15) return null;
  const lim = 1 << (LPC_PRECISION - 1), q = new Int32Array(order);
  let carry = 0;
  for (let j = 0; j < order; j++) {
    carry += a[j + 1] * 2 ** shift;
    const v = Math.max(-lim, Math.min(lim - 1, Math.round(carry)));
    q[j] = v; carry -= v;
  }
  const r = new Int32Array(n), div = 2 ** shift;
  for (let i = order; i < n; i++) {
    let s = 0;
    for (let j = 0; j < order; j++) s += q[j] * x[i - 1 - j];
    const v = x[i] - Math.floor(s / div);
    if (v > 0x3fffffff || v < -0x3fffffff) return null;
    r[i] = v;
  }
  const folded = fold(r, order), rice = bestRice(folded, n, order);
  if (!rice) return null;
  return { kind: 'lpc', order, q, shift, folded, rice, bits: 8 + order * bps + 4 + 5 + order * LPC_PRECISION + rice.bits };
}

// The smallest way to store one channel of a frame.
function planChannel(x, bps) {
  const n = x.length;
  let constant = true;
  for (let i = 1; i < n && constant; i++) if (x[i] !== x[0]) constant = false;
  if (constant) return { kind: 'constant', bits: 8 + bps };
  let best = { kind: 'verbatim', bits: 8 + n * bps };
  for (let order = 0; order <= 4 && order < n; order++) {
    const folded = fold(fixedResidual(x, order), order), rice = bestRice(folded, n, order);
    if (!rice) continue;
    const bits = 8 + order * bps + rice.bits;
    if (bits < best.bits) best = { kind: 'fixed', order, folded, rice, bits };
  }
  if (n > LPC_ORDER * 2) { const lpc = planLpc(x, bps); if (lpc && lpc.bits < best.bits) best = lpc; }
  return best;
}
function writeSubframe(bw, plan, x, bps) {
  bw.write(0, 1);
  if (plan.kind === 'constant') { bw.write(0, 6); bw.write(0, 1); bw.write(x[0], bps); return; }
  if (plan.kind === 'verbatim') { bw.write(1, 6); bw.write(0, 1); for (let i = 0; i < x.length; i++) bw.write(x[i], bps); return; }
  if (plan.kind === 'fixed') bw.write(8 | plan.order, 6); else bw.write(32 | (plan.order - 1), 6);
  bw.write(0, 1); // no wasted bits
  for (let i = 0; i < plan.order; i++) bw.write(x[i], bps);
  if (plan.kind === 'lpc') {
    bw.write(LPC_PRECISION - 1, 4);
    bw.write(plan.shift, 5);
    for (let j = 0; j < plan.order; j++) bw.write(plan.q[j], LPC_PRECISION);
  }
  writeResidual(bw, plan.folded, x.length, plan.order, plan.rice);
}

// ---- Frames and the stream ------------------------------------------------------------------------------------------

function writeUtf8(bw, v) {
  if (v < 0x80) { bw.write(v, 8); return; }
  const c = v < 0x800 ? 1 : v < 0x10000 ? 2 : v < 0x200000 ? 3 : v < 0x4000000 ? 4 : 5;
  bw.write([0, 0xC0, 0xE0, 0xF0, 0xF8, 0xFC][c] | Math.floor(v / 2 ** (6 * c)), 8);
  for (let i = c - 1; i >= 0; i--) bw.write(0x80 | (Math.floor(v / 2 ** (6 * i)) & 0x3f), 8);
}
const STEREO = [
  { code: 0b0001, a: 'L', b: 'R' }, // left, right
  { code: 0b1000, a: 'L', b: 'S' }, // left, side
  { code: 0b1001, a: 'S', b: 'R' }, // side, right
  { code: 0b1010, a: 'M', b: 'S' }, // mid, side
];
function writeFrame(bw, L, R, frameNo) {
  const n = L.length, S = new Int32Array(n), M = new Int32Array(n);
  for (let i = 0; i < n; i++) { S[i] = L[i] - R[i]; M[i] = (L[i] + R[i]) >> 1; }
  const ch = { L, R, S, M }, bps = { L: 16, R: 16, M: 16, S: 17 }, plans = {};
  for (const k of Object.keys(ch)) plans[k] = planChannel(ch[k], bps[k]);
  const mode = STEREO.reduce((best, m) => (plans[m.a].bits + plans[m.b].bits < plans[best.a].bits + plans[best.b].bits ? m : best));
  const start = bw.byte;
  bw.write(0x3ffe, 14); bw.write(0, 1); bw.write(0, 1);
  bw.write(0b0111, 4); // block size: 16 bits at the end of the header
  bw.write(0b1001, 4); // 44.1 kHz
  bw.write(mode.code, 4);
  bw.write(0b100, 3); // 16 bits a sample
  bw.write(0, 1);
  writeUtf8(bw, frameNo);
  bw.write(n - 1, 16);
  bw.write(crc8(bw.buf, start, bw.byte), 8);
  writeSubframe(bw, plans[mode.a], ch[mode.a], bps[mode.a]);
  writeSubframe(bw, plans[mode.b], ch[mode.b], bps[mode.b]);
  bw.align();
  bw.write(crc16(bw.buf, start, bw.byte), 16);
  return bw.byte - start;
}

/** Interleaved 16-bit stereo PCM → a FLAC file. */
function encodeFlac(pcm, { sampleRate = 44100 } = {}) {
  if (sampleRate !== 44100) throw new Error('only 44.1 kHz (CD audio)');
  if (pcm.length % 2) throw new Error('stereo PCM has an even number of samples');
  const total = pcm.length / 2;
  const bw = new BitWriter(pcm.length * 2 + 4096);
  for (const c of 'fLaC') bw.write(c.charCodeAt(0), 8);
  bw.write(1, 1); bw.write(0, 7); bw.write(34, 24); // the one (last) metadata block: STREAMINFO, 34 bytes
  const info = bw.byte;
  bw.pos += 34 * 8; bw.ensure(0);
  let minFrame = 0, maxFrame = 0;
  for (let s = 0, f = 0; s < total; s += BLOCK, f++) {
    const n = Math.min(BLOCK, total - s), L = new Int32Array(n), R = new Int32Array(n);
    for (let i = 0; i < n; i++) { L[i] = pcm[(s + i) * 2]; R[i] = pcm[(s + i) * 2 + 1]; }
    const size = writeFrame(bw, L, R, f);
    minFrame = minFrame ? Math.min(minFrame, size) : size;
    maxFrame = Math.max(maxFrame, size);
  }
  const md5 = crypto.createHash('md5').update(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)).digest();
  const si = new BitWriter(34);
  si.write(BLOCK, 16); si.write(BLOCK, 16); si.write(minFrame, 24); si.write(maxFrame, 24);
  si.write(sampleRate, 20); si.write(1, 3); si.write(15, 5);
  si.write(Math.floor(total / 2 ** 30), 6); si.write(total % 2 ** 30, 30); // 36 bits of total samples
  si.buf.set(md5, 18);
  bw.buf.set(si.buf.subarray(0, 34), info);
  return Buffer.from(bw.buf.buffer, 0, bw.byte);
}

module.exports = { encodeFlac, crc8, crc16, BLOCK };
