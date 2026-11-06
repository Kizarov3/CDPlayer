'use strict';
// Lyrics in Latin letters (karaoke/romanize.js), in a worker that goes away a while after the last song asked: Japanese's
// dictionary is too much memory to keep for nothing.
const IDLE_MS = 30000;
function createRomanize({ createWorker, idleMs = IDLE_MS }) {
  let worker = null, timer = null, nextId = 1, going = 0;
  const ask = (texts) => new Promise((resolve, reject) => {
    clearTimeout(timer);
    const id = nextId++, w = worker || (worker = createWorker());
    going++;
    const done = () => {
      w.off('message', onMessage); w.off('error', onLost); w.off('exit', onLost);
      if (--going === 0 && worker === w) timer = setTimeout(() => { if (worker === w) worker = null; w.terminate(); }, idleMs);
    };
    const onMessage = (m) => { if (m.id !== id) return; done(); m.error ? reject(new Error(m.error)) : resolve(m.lines); };
    const onLost = (e) => { if (worker === w) worker = null; done(); reject(e instanceof Error ? e : new Error('the romanizing stopped')); };
    w.on('message', onMessage); w.on('error', onLost); w.on('exit', onLost);
    w.postMessage({ id, texts });
  });
  return { lines: ask };
}
module.exports = { createRomanize };
