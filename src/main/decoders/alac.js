'use strict';
/**
 * Apple Lossless (ALAC) decoder in plain JavaScript — a port of Apple's open-source reference decoder
 * (github.com/macosforge/alac, Apache License 2.0): the adaptive-Golomb entropy decoder (ag_dec.c), the dynamic
 * predictor (dp_dec.c), stereo un-mixing (matrix_dec.c) and the frame parser (ALACDecoder.cpp). Chromium ships no
 * ALAC decoder, so Apple Lossless .m4a files are decoded here and handed to the player as WAV.
 */
const { parseMp4Audio } = require('./mp4');
const { buildWav } = require('./wav');

const ID_SCE = 0, ID_CPE = 1, ID_CCE = 2, ID_LFE = 3, ID_DSE = 4, ID_PCE = 5, ID_FIL = 6, ID_END = 7;
const QBSHIFT = 9, QB = 1 << QBSHIFT, MMULSHIFT = 2, MDENSHIFT = QBSHIFT - MMULSHIFT - 1, MOFF = 1 << (MDENSHIFT - 2);
const BITOFF = 24, N_MAX_MEAN_CLAMP = 0xffff, N_MEAN_CLAMP_VAL = 0xffff;
const MAX_PREFIX_16 = 9, MAX_PREFIX_32 = 9, MAX_DATATYPE_BITS_16 = 16;

function parseConfig(cookie) {
  return {
    frameLength: cookie.readUInt32BE(0),
    bitDepth: cookie[5],
    pb: cookie[6],
    mb: cookie[7],
    kb: cookie[8],
    numChannels: cookie[9],
    maxRun: cookie.readUInt16BE(10),
    sampleRate: cookie.readUInt32BE(20),
  };
}

// Big-endian 32-bit read that tolerates running a few bytes past the end (the buffer is zero-padded).
function read32(buf, byte) {
  return ((buf[byte] << 24) | (buf[byte + 1] << 16) | (buf[byte + 2] << 8) | buf[byte + 3]) >>> 0;
}

class BitReader {
  constructor(buf, byteLength) { this.buf = buf; this.pos = 0; this.end = byteLength * 8; }
  read(n) {
    if (n === 0) return 0;
    if (n > 24) { const hi = this.read(n - 16); return hi * 65536 + this.read(16); }
    const v = ((read32(this.buf, this.pos >>> 3) << (this.pos & 7)) >>> 0) >>> (32 - n);
    this.pos += n;
    return v;
  }
  advance(n) { this.pos += n; }
  byteAlign() { this.pos = (this.pos + 7) & ~7; }
}

function getStreamBits(buf, bitOffset, numBits) {
  const byteOffset = bitOffset >>> 3, sh = bitOffset & 7;
  const load1 = read32(buf, byteOffset);
  let result;
  if (numBits + sh > 32) {
    result = ((load1 << sh) >>> 0) >>> (32 - numBits);
    result = (result | (buf[byteOffset + 4] >>> (8 - (numBits + sh - 32)))) >>> 0;
  } else {
    result = load1 >>> (32 - numBits - sh);
  }
  if (numBits !== 32) result = (result & ((1 << numBits) - 1)) >>> 0;
  return result;
}

function dynGet(buf, st, m, k) {
  let bits = st.pos;
  let stream = (read32(buf, bits >>> 3) << (bits & 7)) >>> 0;
  let pre = Math.clz32(~stream >>> 0);
  let result;
  if (pre >= MAX_PREFIX_16) {
    pre = MAX_PREFIX_16;
    bits += pre;
    stream = (stream << pre) >>> 0;
    result = stream >>> (32 - MAX_DATATYPE_BITS_16);
    bits += MAX_DATATYPE_BITS_16;
  } else {
    bits += pre + 1;
    stream = (stream << (pre + 1)) >>> 0;
    const v = stream >>> (32 - k);
    bits += k;
    result = pre * m + v - 1;
    if (v < 2) { result -= v - 1; bits -= 1; }
  }
  st.pos = bits;
  return result;
}

function dynGet32(buf, st, m, k, maxBits) {
  let bits = st.pos;
  let stream = (read32(buf, bits >>> 3) << (bits & 7)) >>> 0;
  let result = Math.clz32(~stream >>> 0);
  if (result >= MAX_PREFIX_32) {
    result = getStreamBits(buf, bits + MAX_PREFIX_32, maxBits);
    bits += MAX_PREFIX_32 + maxBits;
  } else {
    bits += result + 1;
    if (k !== 1) {
      stream = (stream << (result + 1)) >>> 0;
      const v = stream >>> (32 - k);
      bits += k - 1;
      result = result * m;
      if (v >= 2) { result += v - 1; bits += 1; }
    }
  }
  st.pos = bits;
  return result;
}

function dynDecomp(params, buf, st, endBits, pc, numSamples, maxSize) {
  const { pb, kb, wb } = params;
  let mb = params.mb0, zmode = 0, c = 0, out = 0;
  while (c < numSamples) {
    if (st.pos >= endBits) throw new Error('ALAC: ran off the end of the packet');
    let m = mb >>> QBSHIFT;
    let k = Math.min(31 - Math.clz32(m + 3), kb);
    m = (1 << k) - 1;
    const n = dynGet32(buf, st, m, k, maxSize);
    const ndecode = n + zmode;
    const multiplier = (-(ndecode & 1)) | 1;
    pc[out++] = (Math.floor((ndecode + 1) / 2) * multiplier) | 0;
    c++;
    mb = (pb * (n + zmode) + mb - ((pb * mb) >>> QBSHIFT)) >>> 0;
    if (n > N_MAX_MEAN_CLAMP) mb = N_MEAN_CLAMP_VAL;
    zmode = 0;
    if (((mb << MMULSHIFT) >>> 0) < QB && c < numSamples) {
      zmode = 1;
      k = Math.clz32(mb) - BITOFF + ((mb + MOFF) >>> MDENSHIFT);
      const mz = ((1 << k) - 1) & wb;
      const zeros = dynGet(buf, st, mz, k);
      if (c + zeros > numSamples) throw new Error('ALAC: zero run overflows the frame');
      for (let j = 0; j < zeros; j++) { pc[out++] = 0; c++; }
      if (zeros >= 65535) zmode = 0;
      mb = 0;
    }
  }
}

function sign(i) { return i > 0 ? 1 : i < 0 ? -1 : 0; }

function unpcBlock(pc1, out, num, coefs, numActive, chanBits, denShift) {
  const chanShift = 32 - chanBits;
  const denHalf = 1 << (denShift - 1);
  out[0] = pc1[0];
  if (numActive === 0) {
    if (num > 1 && pc1 !== out) out.set(pc1.subarray(1, num), 1);
    return;
  }
  if (numActive === 31) {
    let prev = out[0];
    for (let j = 1; j < num; j++) {
      const del = (pc1[j] + prev) | 0;
      prev = (del << chanShift) >> chanShift;
      out[j] = prev;
    }
    return;
  }
  for (let j = 1; j <= numActive; j++) {
    const del = (pc1[j] + out[j - 1]) | 0;
    out[j] = (del << chanShift) >> chanShift;
  }
  const lim = numActive + 1;
  for (let j = lim; j < num; j++) {
    const base = j - 1;
    const top = out[j - lim];
    let sum1 = 0;
    for (let k = 0; k < numActive; k++) sum1 = (sum1 + Math.imul(coefs[k], (out[base - k] - top) | 0)) | 0;
    let del = pc1[j];
    let del0 = del;
    const sg = sign(del);
    del = (del + top + (((sum1 + denHalf) | 0) >> denShift)) | 0;
    out[j] = (del << chanShift) >> chanShift;
    if (sg > 0) {
      for (let k = numActive - 1; k >= 0; k--) {
        const dd = (top - out[base - k]) | 0;
        const sgn = sign(dd);
        coefs[k] -= sgn;
        del0 = (del0 - Math.imul(numActive - k, Math.imul(sgn, dd) >> denShift)) | 0;
        if (del0 <= 0) break;
      }
    } else if (sg < 0) {
      for (let k = numActive - 1; k >= 0; k--) {
        const dd = (top - out[base - k]) | 0;
        const sgn = sign(dd);
        coefs[k] += sgn;
        del0 = (del0 - Math.imul(numActive - k, Math.imul(-sgn, dd) >> denShift)) | 0;
        if (del0 >= 0) break;
      }
    }
  }
}

class AlacDecoder {
  constructor(cookie) {
    this.config = parseConfig(cookie);
    const n = this.config.frameLength;
    this.predictor = new Int32Array(n);
    this.mixU = new Int32Array(n);
    this.mixV = new Int32Array(n);
    this.shiftBuffer = new Uint16Array(n * 2);
    this.coefsU = new Int16Array(32);
    this.coefsV = new Int16Array(32);
  }

  /** Decodes one packet into `out` (Int32Array, interleaved, full bitDepth scale). Returns the sample-frame count. */
  decodePacket(packet, out) {
    const cfg = this.config;
    const numChannels = cfg.numChannels;
    const buf = Buffer.alloc(packet.length + 8);
    packet.copy(buf);
    const bits = new BitReader(buf, packet.length);
    let numSamples = cfg.frameLength;
    let channelIndex = 0;

    for (;;) {
      if (bits.pos >= bits.end) break;
      const tag = bits.read(3);
      if (tag === ID_END) break;
      if (tag === ID_SCE || tag === ID_LFE || tag === ID_CPE) {
        const pair = tag === ID_CPE;
        if (channelIndex + (pair ? 2 : 1) > numChannels) break;
        bits.read(4); // element instance tag
        if (bits.read(12) !== 0) throw new Error('ALAC: bad element header');
        const headerByte = bits.read(4);
        const partialFrame = headerByte >> 3;
        let bytesShifted = (headerByte >> 1) & 3;
        if (bytesShifted === 3) throw new Error('ALAC: bad shift');
        const escapeFlag = headerByte & 1;
        let chanBits = cfg.bitDepth - bytesShifted * 8 + (pair ? 1 : 0);
        if (partialFrame) numSamples = bits.read(16) * 65536 + bits.read(16);
        if (numSamples > cfg.frameLength) throw new Error('ALAC: frame too long');
        let mixBits = 0, mixRes = 0;
        let shiftStart = 0;

        if (escapeFlag === 0) {
          mixBits = bits.read(8);
          mixRes = (bits.read(8) << 24) >> 24;
          const channels = pair ? 2 : 1;
          const params = [];
          for (let ch = 0; ch < channels; ch++) {
            let hb = bits.read(8);
            const mode = hb >> 4, denShift = hb & 0xf;
            hb = bits.read(8);
            const pbFactor = hb >> 5, numCoefs = hb & 0x1f;
            const coefs = ch === 0 ? this.coefsU : this.coefsV;
            for (let i = 0; i < numCoefs; i++) coefs[i] = bits.read(16);
            params.push({ mode, denShift, pbFactor, numCoefs, coefs });
          }
          if (bytesShifted) {
            shiftStart = bits.pos;
            bits.advance(bytesShifted * 8 * channels * numSamples);
          }
          for (let ch = 0; ch < channels; ch++) {
            const p = params[ch];
            const ag = { mb0: cfg.mb, pb: Math.floor((cfg.pb * p.pbFactor) / 4), kb: cfg.kb, wb: (1 << cfg.kb) - 1 };
            const st = { pos: bits.pos };
            dynDecomp(ag, buf, st, bits.end, this.predictor, numSamples, chanBits);
            bits.pos = st.pos;
            const target = ch === 0 ? this.mixU : this.mixV;
            if (p.mode !== 0) unpcBlock(this.predictor, this.predictor, numSamples, null, 31, chanBits, 0);
            unpcBlock(this.predictor, target, numSamples, p.coefs, p.numCoefs, chanBits, p.denShift);
          }
        } else {
          chanBits = cfg.bitDepth;
          const shift = 32 - chanBits;
          const readSample = () => {
            if (chanBits <= 16) return (bits.read(chanBits) << shift) >> shift;
            const hi = (bits.read(16) << 16) >> shift;
            return hi | bits.read(chanBits - 16);
          };
          for (let i = 0; i < numSamples; i++) {
            this.mixU[i] = readSample();
            if (pair) this.mixV[i] = readSample();
          }
          bytesShifted = 0;
        }

        const shift = bytesShifted * 8;
        if (bytesShifted) {
          const reader = new BitReader(buf, packet.length);
          reader.pos = shiftStart;
          const n = numSamples * (pair ? 2 : 1);
          for (let i = 0; i < n; i++) this.shiftBuffer[i] = reader.read(shift);
        }

        const depth = cfg.bitDepth;
        const finish = (value, shiftValue) => {
          if (depth === 20) return value << 4;
          if (shift) return (value << shift) | shiftValue;
          return value;
        };
        if (!pair) {
          for (let i = 0, o = channelIndex; i < numSamples; i++, o += numChannels) {
            out[o] = depth === 16 ? (this.mixU[i] << 16) >> 16 : finish(this.mixU[i], this.shiftBuffer[i]);
          }
          channelIndex += 1;
        } else {
          for (let i = 0, o = channelIndex; i < numSamples; i++, o += numChannels) {
            let l = this.mixU[i], r = this.mixV[i];
            if (mixRes !== 0) {
              l = (this.mixU[i] + this.mixV[i] - (Math.imul(mixRes, this.mixV[i]) >> mixBits)) | 0;
              r = (l - this.mixV[i]) | 0;
            }
            if (depth === 16) { out[o] = (l << 16) >> 16; out[o + 1] = (r << 16) >> 16; }
            else { out[o] = finish(l, this.shiftBuffer[i * 2]); out[o + 1] = finish(r, this.shiftBuffer[i * 2 + 1]); }
          }
          channelIndex += 2;
        }
      } else if (tag === ID_DSE) {
        bits.read(4);
        const align = bits.read(1);
        let count = bits.read(8);
        if (count === 255) count += bits.read(8);
        if (align) bits.byteAlign();
        bits.advance(count * 8);
      } else if (tag === ID_FIL) {
        let count = bits.read(4);
        if (count === 15) count += bits.read(8) - 1;
        bits.advance(count * 8);
      } else if (tag === ID_CCE || tag === ID_PCE) {
        throw new Error('ALAC: unsupported element');
      }
      if (channelIndex >= numChannels) break;
    }
    return numSamples;
  }
}

/** Decodes a whole Apple Lossless .m4a (as a Buffer) into a WAV Buffer. */
function alacToWav(fileBuffer) {
  const track = parseMp4Audio(fileBuffer);
  if (!track || track.codec !== 'alac' || !track.config) throw new Error('Not an Apple Lossless file');
  const decoder = new AlacDecoder(track.config);
  const { numChannels, bitDepth, frameLength } = decoder.config;
  const sampleRate = decoder.config.sampleRate || track.sampleRate;
  const outBits = bitDepth === 16 ? 16 : bitDepth === 32 ? 32 : 24;
  const bytesPerSample = outBits / 8;
  const frameScratch = new Int32Array(frameLength * numChannels);
  const pieces = [];
  let total = 0;
  for (const [offset, size] of track.packets) {
    if (offset + size > fileBuffer.length) break;
    const frames = decoder.decodePacket(fileBuffer.subarray(offset, offset + size), frameScratch);
    const count = frames * numChannels;
    const piece = Buffer.alloc(count * bytesPerSample);
    for (let i = 0; i < count; i++) {
      const v = frameScratch[i];
      if (outBits === 16) piece.writeInt16LE(v, i * 2);
      else if (outBits === 24) piece.writeIntLE(Math.max(-8388608, Math.min(8388607, v)), i * 3, 3);
      else piece.writeInt32LE(v, i * 4);
    }
    pieces.push(piece);
    total += piece.length;
  }
  return buildWav({ sampleRate, channels: numChannels, bitsPerSample: outBits, data: Buffer.concat(pieces, total) });
}

module.exports = { alacToWav, AlacDecoder };
