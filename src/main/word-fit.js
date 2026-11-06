'use strict';
/**
 * Karaoke's words timed by the voice in the file (karaoke/worker.js), each song once: kept per song and lyrics in the
 * data folder's karaoke-words, until the file changes. A song its lyrics can't be read for is kept too (words: null), so
 * it isn't decoded again for nothing. One song at a time; a song asked for while another's going replaces any waiting.
 */
const crypto = require('crypto'), path = require('path');
const VERSION = 2; // (a change of model or method: songs are timed again)
const MODELS = ['vocals.int8.onnx', 'accompaniment.int8.onnx', 'aligner.onnx'];

function createWordFit({ dir, modelsDir, fs, createWorker }) {
  const fileOf = (file, lyrics) => path.join(dir, `${crypto.createHash('sha1').update(`${VERSION}\n${file}\n${lyrics}`).digest('hex')}.json`);
  const stampOf = (file) => { try { const st = fs.statSync(file); return `${st.size}:${Math.round(st.mtimeMs)}`; } catch { return null; } };
  let waiting = null, going = false, worker = null, nextId = 1;

  function work({ left, right, lines }) {
    return new Promise((resolve, reject) => {
      const id = nextId++, w = worker || (worker = createWorker());
      const done = () => { w.off('message', onMessage); w.off('error', onLost); w.off('exit', onLost); };
      const onMessage = (m) => {
        if (m.id !== id || m.progress !== undefined) return;
        done();
        m.error ? reject(new Error(m.error)) : resolve(m.words);
      };
      const onLost = (e) => { done(); if (worker === w) worker = null; reject(e instanceof Error ? e : new Error('the word timing stopped')); };
      w.on('message', onMessage); w.on('error', onLost); w.on('exit', onLost);
      w.postMessage({ id, left, right, lines }, left.buffer === right.buffer ? [left.buffer] : [left.buffer, right.buffer]);
    });
  }
  function next() {
    if (going) return;
    const job = waiting;
    if (!job) { if (worker) { const w = worker; worker = null; w.terminate(); } return; } // (the models' memory back between songs)
    waiting = null; going = true;
    work(job.song).then(
      (words) => { going = false; job.finish(words); next(); },
      (e) => { going = false; job.fail(e); next(); },
    );
  }
  return {
    /** Whether it can be done at all (the models are there). */
    available() { return MODELS.every((m) => fs.existsSync(path.join(modelsDir, m))); },
    /** → { move, words } as kept for this file and lyrics, or undefined. */
    get(file, lyrics) {
      try {
        const kept = JSON.parse(fs.readFileSync(fileOf(file, lyrics), 'utf8'));
        return kept.stamp === stampOf(file) ? { move: kept.move, words: kept.words } : undefined;
      } catch { return undefined; }
    },
    /** `song`: { left, right, lines, move } → { move, words } (kept), or undefined when another song took its place. */
    run(file, lyrics, song) {
      return new Promise((resolve, reject) => {
        if (waiting) waiting.finish.dropped();
        const finish = (words) => {
          const out = { move: song.move, words: words || null };
          try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(fileOf(file, lyrics), JSON.stringify({ stamp: stampOf(file), ...out })); } catch { /* (it's just done again next time) */ }
          resolve(out);
        };
        finish.dropped = () => resolve(undefined);
        waiting = { song, finish, fail: reject };
        next();
      });
    },
  };
}
module.exports = { createWordFit };
