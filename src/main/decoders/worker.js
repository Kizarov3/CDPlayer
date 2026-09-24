'use strict';
// Runs a fallback decode off the main process's event loop, so a long Apple Lossless file never freezes IPC.
const { parentPort } = require('worker_threads');
const fs = require('fs');
const { decodeToWav } = require('./index');

parentPort.on('message', ({ id, kind, filePath }) => {
  try {
    const wav = decodeToWav(kind, fs.readFileSync(filePath));
    const copy = new Uint8Array(wav.length);
    copy.set(wav);
    parentPort.postMessage({ id, wav: copy }, [copy.buffer]);
  } catch (e) {
    parentPort.postMessage({ id, error: e.message || String(e) });
  }
});
