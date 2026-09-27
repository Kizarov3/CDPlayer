'use strict';
// Encodes a track to FLAC off the main thread, then decodes the result and compares it with the audio it came from:
// a file is only ever handed back if it plays back as exactly the disc's audio.
const { parentPort } = require('worker_threads');
const { encodeFlac } = require('./flac');
const { decodeFlac } = require('./flac-decode');

parentPort.on('message', ({ id, pcm }) => {
  try {
    const flac = encodeFlac(pcm);
    const back = decodeFlac(flac).samples;
    if (back.length !== pcm.length) throw new Error('couldn\'t check: wrong length');
    for (let i = 0; i < pcm.length; i++) if (back[i] !== pcm[i]) throw new Error(`couldn't check: sample ${i} differs`);
    const out = flac.buffer.slice(flac.byteOffset, flac.byteOffset + flac.byteLength); // just the file, not the writer's spare room
    parentPort.postMessage({ id, flac: out }, [out]);
  } catch (e) {
    parentPort.postMessage({ id, error: String(e.message || e) });
  }
});
