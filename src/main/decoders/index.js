'use strict';
const path = require('path');
const { aiffToWav } = require('./aiff');
const { auToWav } = require('./au');
const { alacToWav } = require('./alac');
const { parseMp4Audio } = require('./mp4');

/**
 * Formats Chromium can't play on its own and that CDPlayer therefore decodes itself. Everything else (MP3, AAC,
 * FLAC, WAV, OGG, Opus) is streamed to Chromium unchanged.
 */
function fallbackKind(filePath, headBytes) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (ext === 'aif' || ext === 'aiff' || ext === 'aifc') return 'aiff';
  if (ext === 'au' || ext === 'snd') return 'au';
  if ((ext === 'm4a' || ext === 'mp4' || ext === 'alac' || ext === 'caf') && headBytes && looksLikeAlac(headBytes)) return 'alac';
  return null;
}

// ALAC and AAC share the .m4a extension. The codec's fourcc sits in the sample description inside 'moov', which
// can be at the start or the end of the file — callers pass the bytes they have and fall back to a full parse.
function looksLikeAlac(buf) {
  return buf.includes('alac', 0, 'latin1');
}

function decodeToWav(kind, buffer) {
  if (kind === 'aiff') return aiffToWav(buffer);
  if (kind === 'au') return auToWav(buffer);
  if (kind === 'alac') return alacToWav(buffer);
  throw new Error(`No decoder for ${kind}`);
}

module.exports = { fallbackKind, decodeToWav, parseMp4Audio };
