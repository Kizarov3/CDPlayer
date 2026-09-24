'use strict';
const { convertPcm } = require('./wav');

const ENCODINGS = {
  1: { encoding: 'ulaw', bits: 8 },
  2: { encoding: 'signed', bits: 8 },
  3: { encoding: 'signed', bits: 16 },
  4: { encoding: 'signed', bits: 24 },
  5: { encoding: 'signed', bits: 32 },
  6: { encoding: 'float', bits: 32 },
  7: { encoding: 'float', bits: 64 },
  27: { encoding: 'alaw', bits: 8 },
};

/** Sun/NeXT .au (".snd") → WAV. All fields are big-endian. */
function auToWav(buf) {
  if (buf.toString('ascii', 0, 4) !== '.snd') throw new Error('Not an AU file');
  const dataOffset = buf.readUInt32BE(4);
  const declaredSize = buf.readUInt32BE(8);
  const encodingId = buf.readUInt32BE(12);
  const sampleRate = buf.readUInt32BE(16);
  const channels = buf.readUInt32BE(20);
  const format = ENCODINGS[encodingId];
  if (!format) throw new Error(`Unsupported AU encoding ${encodingId}`);
  // 0xffffffff means "unknown size" — the data simply runs to the end of the file.
  const end = declaredSize === 0xffffffff ? buf.length : Math.min(buf.length, dataOffset + declaredSize);
  return convertPcm(buf.subarray(dataOffset, end), { ...format, bigEndian: true, channels, sampleRate });
}

module.exports = { auToWav };
