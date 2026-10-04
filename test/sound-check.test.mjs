import test from 'node:test';
import assert from 'node:assert';
import { createSoundCheck } from '../src/renderer/js/sound-check.js';

// A little library: details per path, an album per path, a cache, and a measure() that answers when told to.
function world({ details = {}, albums = {}, cached = {}, loudness = {} } = {}) {
  const store = { ...cached }, measured = [], waiting = [];
  const sc = createSoundCheck({
    details: async (p) => details[p] || { duration: 200, replayGain: null, cue: null },
    cache: {
      get: async (files) => Object.fromEntries(files.filter((f) => store[f]).map((f) => [f, store[f]])),
      put: async (f, e) => { store[f] = e; },
      album: async (p) => albums[p] || null,
    },
    measure: (file) => { measured.push(file); return new Promise((resolve, reject) => waiting.push({ file, go: () => (loudness[file] === 'broken' ? reject(new Error('decode')) : resolve({ loudness: loudness[file], peak: 0.5, duration: 200 })) })); },
  });
  // Answers each measurement as it's asked for, until nothing more has been asked for a few turns of the event loop.
  const flush = async () => {
    for (let idle = 0; idle < 3;) {
      await new Promise((r) => setTimeout(r, 0));
      if (waiting.length) { idle = 0; waiting.shift().go(); } else idle++;
    }
  };
  // Answers the next measurement, once one is asked for.
  const next = async () => { while (!waiting.length) await new Promise((r) => setTimeout(r, 0)); waiting.shift().go(); await new Promise((r) => setTimeout(r, 0)); };
  const asked = async () => { while (!waiting.length) await new Promise((r) => setTimeout(r, 0)); };
  return { sc, store, measured, flush, next, asked };
}
const applied = () => { const list = []; return { list, apply: (info, ramp) => list.push({ db: Math.round(info.db * 10) / 10, scope: info.scope, source: info.source, ramp }) }; };

test('OFF knows nothing and measures nothing', async () => {
  const w = world();
  assert.strictEqual(await w.sc.known('/a.flac', 'OFF'), null);
  const a = applied(); w.sc.follow('/a.flac', 'OFF', a.apply); await w.flush();
  assert.deepStrictEqual([w.measured, a.list], [[], []]);
});

test('tags are used at once, without measuring', async () => {
  const w = world({ details: { '/a.flac': { duration: 200, replayGain: { trackGain: -6, trackPeak: 0.5, albumGain: -8, albumPeak: 0.5 } } } });
  assert.deepStrictEqual((await w.sc.known('/a.flac', 'TRACK')).db.toFixed(1), '-6.0');
  assert.deepStrictEqual((await w.sc.known('/a.flac', 'ALBUM')).db.toFixed(1), '-8.0');
  assert.deepStrictEqual(w.measured, []);
});

test('an unmeasured song is measured, then ramped in over a second; then its album over two', async () => {
  const w = world({ albums: { '/a.flac': ['/a.flac', '/b.flac'] }, loudness: { '/a.flac': -10, '/b.flac': -20 } });
  assert.strictEqual(await w.sc.known('/a.flac', 'ALBUM'), null);
  const a = applied(); w.sc.follow('/a.flac', 'ALBUM', a.apply); await w.flush();
  assert.deepStrictEqual(w.measured, ['/a.flac', '/b.flac']);
  assert.deepStrictEqual(a.list[0], { db: -8, scope: 'TRACK', source: 'MEASURED', ramp: 1 });
  assert.strictEqual(a.list[1].scope, 'ALBUM'); assert.strictEqual(a.list[1].ramp, 2);
  assert.ok(await w.sc.known('/b.flac', 'ALBUM')); // the album is cached now
});

test('a measurement that lands after the track changed is not applied', async () => {
  const w = world({ loudness: { '/a.flac': -10, '/c.flac': -14 } });
  const a = applied(), c = applied();
  w.sc.follow('/a.flac', 'TRACK', a.apply);
  w.sc.follow('/c.flac', 'TRACK', c.apply);
  await w.flush();
  assert.deepStrictEqual(a.list, []);
  assert.strictEqual(c.list.length, 1);
  assert.ok(w.store['/a.flac'], 'but its measurement is still kept');
});

test('a file that fails to measure is skipped, and not tried again', async () => {
  const w = world({ loudness: { '/x.flac': 'broken' } });
  const a = applied(); w.sc.follow('/x.flac', 'TRACK', a.apply); await w.flush();
  w.sc.follow('/x.flac', 'TRACK', a.apply); await w.flush();
  assert.deepStrictEqual([w.measured, a.list], [['/x.flac'], []]);
});

test('a file over 20 minutes without tags is left as it is', async () => {
  const w = world({ details: { '/mix.flac': { duration: 3600, replayGain: null, cue: null } } });
  const a = applied(); w.sc.follow('/mix.flac', 'TRACK', a.apply); await w.flush();
  assert.deepStrictEqual([w.measured, a.list], [[], []]);
});

test('cue tracks share their file\'s measurement', async () => {
  const cue = (n) => ({ duration: 200, replayGain: null, cue: { file: '/album.flac', start: n * 200, end: n * 200 + 200 } });
  const w = world({
    details: { '/album.cue#1': cue(0), '/album.cue#2': cue(1), '/album.flac': { duration: 1000, replayGain: null, cue: null } },
    albums: { '/album.cue#1': ['/album.cue#1', '/album.cue#2'] }, loudness: { '/album.flac': -12 },
  });
  const a = applied(); w.sc.follow('/album.cue#1', 'ALBUM', a.apply); await w.flush();
  assert.deepStrictEqual(w.measured, ['/album.flac']);
  assert.strictEqual(a.list.at(-1).db, -6);
});

test('a hi-res file too big to decode safely is left alone; the same length at 44.1 kHz is measured', async () => {
  const w = world({
    details: {
      '/hires.flac': { duration: 600, replayGain: null, cue: null, format: { sampleRate: 192000 } },
      '/cd.flac': { duration: 600, replayGain: null, cue: null, format: { sampleRate: 44100 } },
    },
    loudness: { '/cd.flac': -12 },
  });
  const a = applied(); w.sc.follow('/hires.flac', 'TRACK', a.apply); await w.flush();
  w.sc.follow('/cd.flac', 'TRACK', a.apply); await w.flush();
  assert.deepStrictEqual(w.measured, ['/cd.flac']);
});

test('an album left behind stops being measured', async () => {
  const w = world({ albums: { '/a1.flac': ['/a1.flac', '/a2.flac', '/a3.flac'] }, loudness: { '/a1.flac': -10, '/a2.flac': -10, '/a3.flac': -10, '/c.flac': -14 } });
  const a = applied(), c = applied();
  w.sc.follow('/a1.flac', 'ALBUM', a.apply);
  await w.next(); // the song itself
  await w.asked(); // the album's second song is being measured — the loop over the album is running
  w.sc.follow('/c.flac', 'TRACK', c.apply); // and now the listener has moved on
  await w.flush();
  assert.deepStrictEqual(w.measured, ['/a1.flac', '/a2.flac', '/c.flac']);
  assert.strictEqual(c.list.length, 1);
});

test('follow() answers what it settled on: nothing for a file it can\'t measure', async () => {
  const w = world({ loudness: { '/x.flac': 'broken', '/y.flac': -12 } });
  const x = w.sc.follow('/x.flac', 'TRACK', () => {}); await w.flush();
  assert.strictEqual(await x, null);
  const y = w.sc.follow('/y.flac', 'TRACK', () => {}); await w.flush();
  assert.strictEqual(Math.round((await y).db), -6);
});

test('a song not on the shelf is evened out on its own in ALBUM', async () => {
  const w = world({ loudness: { '/lone.mp3': -12 } });
  const a = applied(); w.sc.follow('/lone.mp3', 'ALBUM', a.apply); await w.flush();
  assert.deepStrictEqual(a.list, [{ db: -6, scope: 'TRACK', source: 'MEASURED', ramp: 1 }]);
});
