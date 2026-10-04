'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { createLibraryWatch, relevant } = require('../src/main/library-watch');

function fakeWatch() {
  const made = [];
  const watch = (folder, opts, listener) => {
    const w = new EventEmitter();
    w.folder = folder; w.opts = opts; w.closed = false; w.close = () => { w.closed = true; };
    w.fire = (name) => listener('change', name);
    made.push(w);
    return w;
  };
  return { watch, made };
}
function fakeTimers() {
  let now = 0, list = [];
  return {
    setTimeout: (fn, ms) => { const t = { fn, at: now + ms }; list.push(t); return t; },
    clearTimeout: (t) => { list = list.filter((x) => x !== t); },
    advance(ms) { now += ms; const due = list.filter((t) => t.at <= now); list = list.filter((t) => t.at > now); due.forEach((t) => t.fn()); },
  };
}

test('what counts: audio, cue sheets and covers — not hidden or temporary files', () => {
  for (const n of ['Album/01 Song.flac', 'a.MP3', 'x/y/disc.cue', 'Album/cover.jpg', 'folder.png', null]) assert.strictEqual(relevant(n), true, n);
  for (const n of ['.DS_Store', 'Album/._01.flac', 'Album/.cdplayer-rip-3.flac', 'Album/.01 Song.cdplayer-1-2.flac', 'notes.txt', 'Album/booklet.pdf']) assert.strictEqual(relevant(n), false, n);
});

test('a burst is one change, once the folder has been quiet', () => {
  const { watch, made } = fakeWatch(), timers = fakeTimers();
  let changes = 0;
  const lw = createLibraryWatch({ watch, timers, onChange: () => changes++ });
  lw.start('/music');
  assert.deepStrictEqual(made[0].opts, { recursive: true });
  for (let i = 0; i < 20; i++) { made[0].fire(`Album/${i}.flac`); timers.advance(1000); }
  assert.strictEqual(changes, 0);
  timers.advance(3000);
  assert.strictEqual(changes, 1);
  made[0].fire('.DS_Store'); timers.advance(5000);
  assert.strictEqual(changes, 1);
});

test('the same folder keeps its watch; another one replaces it', () => {
  const { watch, made } = fakeWatch();
  const lw = createLibraryWatch({ watch, timers: fakeTimers(), onChange() {} });
  lw.start('/music'); lw.start('/music');
  assert.strictEqual(made.length, 1);
  lw.start('/other');
  assert.deepStrictEqual([made.length, made[0].closed, lw.folder], [2, true, '/other']);
  lw.start(null);
  assert.deepStrictEqual([made[1].closed, lw.folder], [true, null]);
});

test('an erroring watch is stopped, and a throwing one never starts', () => {
  const { watch, made } = fakeWatch(), timers = fakeTimers();
  let changes = 0;
  const lw = createLibraryWatch({ watch, timers, onChange: () => changes++ });
  lw.start('/music');
  made[0].emit('error', Object.assign(new Error('gone'), { code: 'ENOENT' }));
  assert.deepStrictEqual([made[0].closed, lw.folder], [true, null]);
  const throwing = createLibraryWatch({ watch: () => { throw Object.assign(new Error('no'), { code: 'ENOSPC' }); }, timers, onChange() {} });
  assert.doesNotThrow(() => throwing.start('/music'));
  assert.strictEqual(throwing.folder, null);
});

test('stop() drops a change that was waiting for quiet', () => {
  const { watch, made } = fakeWatch(), timers = fakeTimers();
  let changes = 0;
  const lw = createLibraryWatch({ watch, timers, onChange: () => changes++ });
  lw.start('/music'); made[0].fire('a.flac'); lw.stop(); timers.advance(5000);
  assert.strictEqual(changes, 0);
});
