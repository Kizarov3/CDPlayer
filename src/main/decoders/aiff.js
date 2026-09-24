'use strict';
const { convertPcm } = require('./wav');

// 80-bit IEEE 754 extended precision — AIFF's COMM chunk stores the sample rate this way.
function readExtended(buf, offset) {
  const exponent = buf.readUInt16BE(offset) & 0x7fff;
  const sign = buf[offset] & 0x80 ? -1 : 1;
  const hi = buf.readUInt32BE(offset + 2), lo = buf.readUInt32BE(offset + 6);
  if (exponent === 0 && hi === 0 && lo === 0) return 0;
  const mantissa = hi * 2 ** 32 + lo;
  return sign * mantissa * 2 ** (exponent - 16383 - 63);
}

/** AIFF / AIFF-C → WAV. Handles uncompressed big/little-endian integers, 32/64-bit floats, and G.711. */
function aiffToWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'FORM') throw new Error('Not an AIFF file');
  const formType = buf.toString('ascii', 8, 12);
  if (formType !== 'AIFF' && formType !== 'AIFC') throw new Error('Not an AIFF file');
  let comm = null, ssnd = null;
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32BE(pos + 4);
    const body = pos + 8;
    if (id === 'COMM') {
      comm = {
        channels: buf.readUInt16BE(body),
        frames: buf.readUInt32BE(body + 2),
        bits: buf.readUInt16BE(body + 6),
        sampleRate: readExtended(buf, body + 8),
        compression: formType === 'AIFC' && size >= 22 ? buf.toString('ascii', body + 18, body + 22) : 'NONE',
      };
    } else if (id === 'SSND') {
      const dataOffset = buf.readUInt32BE(body);
      // A streamed/truncated file can declare a bigger chunk than what's actually on disk — clamp to what's there.
      ssnd = buf.subarray(body + 8 + dataOffset, Math.min(buf.length, body + size));
    }
    pos = body + size + (size & 1); // chunks are padded to even lengths
  }
  if (!comm || !ssnd) throw new Error('AIFF file is missing COMM or SSND');
  const { channels, bits, sampleRate, compression } = comm;
  let format;
  switch (compression) {
    case 'NONE': case 'twos': format = { encoding: 'signed', bits, bigEndian: true }; break;
    case 'sowt': format = { encoding: 'signed', bits, bigEndian: false }; break;
    case 'fl32': case 'FL32': format = { encoding: 'float', bits: 32, bigEndian: true }; break;
    case 'fl64': case 'FL64': format = { encoding: 'float', bits: 64, bigEndian: true }; break;
    case 'ulaw': case 'ULAW': format = { encoding: 'ulaw', bits: 8 }; break;
    case 'alaw': case 'ALAW': format = { encoding: 'alaw', bits: 8 }; break;
    case 'raw ': format = { encoding: 'unsigned', bits: 8 }; break;
    default: throw new Error(`Unsupported AIFF-C compression "${compression}"`);
  }
  if (format.encoding === 'signed' && ![8, 16, 24, 32].includes(bits)) {
    // Odd depths (12, 20...) are stored left-justified in whole bytes — treat them as the next container size.
    format.bits = Math.ceil(bits / 8) * 8;
  }
  const frameBytes = channels * (format.encoding === 'ulaw' || format.encoding === 'alaw' ? 1 : format.bits / 8);
  const data = ssnd.subarray(0, Math.min(ssnd.length, comm.frames * frameBytes || ssnd.length));
  return convertPcm(data, { ...format, channels, sampleRate });
}

module.exports = { aiffToWav, readExtended };
