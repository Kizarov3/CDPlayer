'use strict';
/** The "FLAC · 24-BIT · 96 KHZ" / "MP3 · 320 KBPS" readout shown under the track title. */

function codecName(format, ext) {
  const codec = String(format.codec || ''), container = String(format.container || '');
  if (/alac/i.test(codec)) return 'ALAC';
  if (/flac/i.test(codec)) return 'FLAC';
  if (/aac/i.test(codec)) return 'AAC';
  if (/layer 3/i.test(codec)) return 'MP3';
  if (/opus/i.test(codec)) return 'OPUS';
  if (/vorbis/i.test(codec)) return 'OGG VORBIS';
  if (/^wave/i.test(container)) return 'WAV';
  if (/^aiff/i.test(container)) return 'AIFF';
  return ext || null;
}

function kilohertz(hz) {
  const k = hz / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)} KHZ`;
}

/** music-metadata's `format` (may be null) plus the file extension → the readout, or just the extension. */
function describeFormat(format, ext) {
  if (!format) return ext || '';
  const name = codecName(format, ext);
  const lossless = format.lossless || ['FLAC', 'ALAC', 'WAV', 'AIFF'].includes(name);
  const parts = [name];
  if (lossless) {
    if (format.bitsPerSample) parts.push(`${format.bitsPerSample}-BIT`);
    if (format.sampleRate) parts.push(kilohertz(format.sampleRate));
  } else if (format.bitrate >= 8000) {
    parts.push(`${Math.round(format.bitrate / 1000)} KBPS`);
  }
  if (format.numberOfChannels === 1) parts.push('MONO');
  return parts.filter(Boolean).join(' · ');
}

module.exports = { describeFormat };
