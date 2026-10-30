'use strict';
// Encodes a track off the main thread. FLAC is then decoded again and compared with the audio it came from: a file is
// only ever handed back if it plays back as exactly the disc's audio. (MP3 can't come back the same; WAV is the audio.)
const { parentPort } = require('worker_threads');
const { encodeFlac } = require('./flac');
const { decodeFlac } = require('./flac-decode');
const { encodeMp3, encodeWav } = require('./mp3');

function encode(pcm, format) {
  if (format === 'MP3') return encodeMp3(pcm);
  if (format === 'WAV') return encodeWav(pcm);
  const flac = encodeFlac(pcm);
  const back = decodeFlac(flac).samples;
  if (back.length !== pcm.length) throw new Error('couldn\'t check: wrong length');
  for (let i = 0; i < pcm.length; i++) if (back[i] !== pcm[i]) throw new Error(`couldn't check: sample ${i} differs`);
  return flac;
}

parentPort.on('message', ({ id, pcm, format }) => {
  try {
    const file = encode(pcm, format);
    const out = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength); // just the file, not the writer's spare room
    parentPort.postMessage({ id, file: out }, [out]);
  } catch (e) {
    parentPort.postMessage({ id, error: String(e.message || e) });
  }
});
