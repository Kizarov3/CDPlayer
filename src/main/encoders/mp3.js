'use strict';
/**
 * MP3 and WAV for ripping CDs (rip.js), for players that don't take FLAC. MP3 is LAME's, through lamejs (LGPL-3.0,
 * lame/: its own build, unchanged), at 320 kbps CBR. lamejs writes no LAME Info frame, so one is put in front here, as
 * LAME itself does: it holds the encoder's delay and padding, which players (and CDPlayer's gapless) use to cut the
 * silence MP3 adds at both ends — without it an album ripped to MP3 has a gap between every two tracks.
 */
const fs = require('fs');
const path = require('path');

const RATE = 44100, KBPS = 320, FRAME = 1152;
const ENC_DELAY = 576; // lamejs's ENCDELAY: silence the encoder puts before the audio
let lamejs = null;
// (the build defines a global function lamejs(); it's run here inside its own scope instead)
const lame = () => lamejs || (lamejs = new Function(`${fs.readFileSync(path.join(__dirname, 'lame', 'lame.min.js'), 'utf8')};return lamejs;`)());

// CRC-16 as LAME's tag has it (reflected 0x8005).
function crc16(bytes, from, to, crc = 0) {
  for (let i = from; i < to; i++) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

/** The silent first frame with the Xing "Info" header and LAME's tag (http://gabriel.mp3-tech.org/mp3infotag.html). */
function infoFrame(frames, audioBytes, samples) {
  const size = Math.floor((144 * KBPS * 1000) / RATE); // 1044: no padding byte
  const f = Buffer.alloc(size);
  f.writeUInt32BE(0xfffbe064, 0); // MPEG-1 layer III, no CRC, 320 kbps, 44.1 kHz, joint stereo
  const x = 4 + 32; // after the header and stereo side info
  f.write('Info', x, 'ascii');
  f.writeUInt32BE(0x0f, x + 4); // frames, bytes, TOC and quality follow
  f.writeUInt32BE(frames, x + 8);
  f.writeUInt32BE(size + audioBytes, x + 12);
  for (let i = 0; i < 100; i++) f[x + 16 + i] = Math.floor((i * 256) / 100); // seek table: CBR is a straight line
  f.writeUInt32BE(0, x + 116);
  f.write('LAME3.99r', x + 120, 'ascii');
  f[x + 129] = 0x01; // tag revision 0, CBR
  f[x + 130] = 200; // lowpass: 20 kHz
  f[x + 140] = 255; // bitrate (255: 255 or more)
  const padding = frames * FRAME - ENC_DELAY - samples;
  f[x + 141] = ENC_DELAY >> 4;
  f[x + 142] = ((ENC_DELAY & 0x0f) << 4) | (padding >> 8);
  f[x + 143] = padding & 0xff;
  f.writeUInt32BE(size + audioBytes, x + 148);
  return { frame: f, crcAt: x + 152 };
}

/** Interleaved 16-bit stereo PCM at 44.1 kHz as an MP3 file (a Buffer). */
function encodeMp3(pcm) {
  const samples = pcm.length >> 1, left = new Int16Array(samples), right = new Int16Array(samples);
  for (let i = 0; i < samples; i++) { left[i] = pcm[i * 2]; right[i] = pcm[i * 2 + 1]; }
  const enc = new (lame().Mp3Encoder)(2, RATE, KBPS), parts = [];
  for (let i = 0; i < samples; i += FRAME * 64) {
    const b = enc.encodeBuffer(left.subarray(i, i + FRAME * 64), right.subarray(i, i + FRAME * 64));
    if (b.length) parts.push(Buffer.from(b.buffer, b.byteOffset, b.length));
  }
  const end = enc.flush();
  if (end.length) parts.push(Buffer.from(end.buffer, end.byteOffset, end.length));
  const audio = Buffer.concat(parts);
  // Every frame starts with a sync word; the count is what the Info frame and the padding are worked out from.
  let frames = 0;
  for (let p = 0; p + 4 <= audio.length;) {
    if (audio[p] !== 0xff || (audio[p + 1] & 0xe0) !== 0xe0) throw new Error('the MP3 encoder\'s output is broken');
    frames++;
    p += Math.floor((144 * KBPS * 1000) / RATE) + ((audio[p + 2] >> 1) & 1);
  }
  const { frame, crcAt } = infoFrame(frames, audio.length, samples);
  frame.writeUInt16BE(crc16(audio, 0, audio.length), crcAt); // the music's CRC
  frame.writeUInt16BE(crc16(frame, 0, 190), crcAt + 2); // the tag's own
  return Buffer.concat([frame, audio]);
}

/** Interleaved 16-bit stereo PCM at 44.1 kHz as a WAV file (a Buffer). */
function encodeWav(pcm) {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii'); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

module.exports = { encodeMp3, encodeWav, crc16 };
