'use strict';

/**
 * Builds a canonical little-endian RIFF/WAVE file. Every fallback decoder in this folder (AIFF, AU, ALAC) funnels
 * its output through here, so Chromium only ever has to play plain WAV — which it decodes natively on every OS.
 */
function buildWav({ sampleRate, channels, bitsPerSample, float = false, data }) {
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(float ? 3 : 1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(Math.round(sampleRate), 24);
  header.writeUInt32LE(Math.round(sampleRate) * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// G.711 expansions, shared by AIFF-C ("ulaw"/"alaw") and Sun AU (encodings 1 and 27).
function ulawToLinear(value) {
  const u = ~value & 0xff;
  const sign = u & 0x80, exponent = (u >> 4) & 0x07, mantissa = u & 0x0f;
  let sample = (((mantissa << 3) + 0x84) << exponent) - 0x84;
  return sign ? -sample : sample;
}
function alawToLinear(value) {
  const a = value ^ 0x55;
  const sign = a & 0x80, exponent = (a >> 4) & 0x07, mantissa = a & 0x0f;
  let sample = exponent === 0 ? (mantissa << 4) + 8 : ((mantissa << 4) + 0x108) << (exponent - 1);
  return sign ? sample : -sample;
}

/**
 * Converts raw PCM of any common layout into WAV-ready little-endian bytes. Integer depths of 16/24/32 are kept as
 * is (only byte order changes), 8-bit becomes 16-bit (WAV's 8-bit is unsigned, a needless special case), floats stay
 * 32-bit float, and G.711 companded audio expands to 16-bit.
 */
function convertPcm(src, { encoding, bits, bigEndian, channels, sampleRate }) {
  const bytesPerSample = encoding === 'ulaw' || encoding === 'alaw' ? 1 : bits / 8;
  const count = Math.floor(src.length / bytesPerSample);
  let out, outBits = bits, float = false;
  if (encoding === 'float') {
    float = true; outBits = 32;
    out = Buffer.alloc(count * 4);
    for (let i = 0; i < count; i++) {
      const o = i * bytesPerSample;
      const v = bits === 64 ? (bigEndian ? src.readDoubleBE(o) : src.readDoubleLE(o)) : (bigEndian ? src.readFloatBE(o) : src.readFloatLE(o));
      out.writeFloatLE(v, i * 4);
    }
  } else if (encoding === 'ulaw' || encoding === 'alaw') {
    outBits = 16;
    out = Buffer.alloc(count * 2);
    const expand = encoding === 'ulaw' ? ulawToLinear : alawToLinear;
    for (let i = 0; i < count; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, expand(src[i]))), i * 2);
  } else if (bits === 8) {
    outBits = 16;
    out = Buffer.alloc(count * 2);
    const unsigned = encoding === 'unsigned';
    for (let i = 0; i < count; i++) out.writeInt16LE(((unsigned ? src[i] - 128 : (src[i] << 24) >> 24)) << 8, i * 2);
  } else if (!bigEndian) {
    out = src.subarray(0, count * bytesPerSample);
  } else {
    out = Buffer.alloc(count * bytesPerSample);
    for (let i = 0; i < count; i++) {
      const o = i * bytesPerSample;
      for (let b = 0; b < bytesPerSample; b++) out[o + b] = src[o + bytesPerSample - 1 - b];
    }
  }
  return buildWav({ sampleRate, channels, bitsPerSample: outBits, float, data: Buffer.from(out) });
}

module.exports = { buildWav, convertPcm, ulawToLinear, alawToLinear };
