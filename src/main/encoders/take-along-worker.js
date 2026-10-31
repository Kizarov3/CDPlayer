'use strict';
// TAKE ALONG's MP3 320, off the main thread: a lossless file read, brought to CD audio (pcm.js) and encoded as the
// ripper's MP3s are (mp3.js, with LAME's Info frame, so an album stays gapless). The last file read is kept, decoded,
// for the next song cut from it — a cue sheet's tracks all come out of one album-length file.
const { parentPort } = require('worker_threads');
const fs = require('fs');
const { readAudio, toCdAudio } = require('./pcm');
const { encodeMp3 } = require('./mp3');

let last = null; // { filePath, stamp, audio }

function convert({ filePath, kind, from, to }) {
  const st = fs.statSync(filePath), stamp = `${st.size}:${st.mtimeMs}`;
  if (!last || last.filePath !== filePath || last.stamp !== stamp) {
    last = null; // (let the one before go first: an album-length file is hundreds of MB)
    last = { filePath, stamp, audio: readAudio(kind, fs.readFileSync(filePath)) };
  }
  const pcm = toCdAudio(last.audio, { from, to });
  if (pcm.length < 2) throw new Error('no audio in the file');
  return encodeMp3(pcm);
}

parentPort.on('message', (job) => {
  try {
    const file = convert(job);
    const out = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    parentPort.postMessage({ id: job.id, file: out }, [out]);
  } catch (e) {
    parentPort.postMessage({ id: job.id, error: String(e.message || e) });
  }
});
