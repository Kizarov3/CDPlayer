'use strict';
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const { EventEmitter } = require('events');
const { createWordFit } = require('../src/main/word-fit');
const { alignPhones, alignSong } = require('../src/main/karaoke/align');
const { phonesOf, readsAsEnglish, linePhones, BLANK, PHONES } = require('../src/main/karaoke/phones');
const { fft, resample, melSpectrogram, maskedMono } = require('../src/main/karaoke/dsp');

function fakeWorkers(reply) {
  const made = [];
  const createWorker = () => { const w = new EventEmitter(); w.terminate = () => { w.gone = true; }; w.postMessage = (m) => { w.last = m; setImmediate(() => reply(w, m)); }; made.push(w); return w; };
  return { createWorker, made };
}
function setup(reply) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wordfit-')), song = path.join(dir, 'song.flac'), models = path.join(dir, 'models');
  fs.writeFileSync(song, 'x'); fs.mkdirSync(models);
  const f = fakeWorkers(reply);
  return { dir, song, models, ...f, fit: createWordFit({ dir: path.join(dir, 'kept'), modelsDir: models, fs, createWorker: f.createWorker }) };
}
const pcm = () => ({ left: new Float32Array(4), right: new Float32Array(4), lines: [], move: 0.5 });

test('only with the models there', () => {
  const s = setup(() => {});
  assert.strictEqual(s.fit.available(), false);
  for (const m of ['vocals.int8.onnx', 'accompaniment.int8.onnx', 'aligner.onnx']) fs.writeFileSync(path.join(s.models, m), '');
  assert.strictEqual(s.fit.available(), true);
});
test('a song is timed once, and again only if its file or lyrics change', async () => {
  const s = setup((w, m) => w.emit('message', { id: m.id, words: [[{ time: 1, end: 2 }]] }));
  assert.strictEqual(s.fit.get(s.song, 'la'), undefined);
  const out = await s.fit.run(s.song, 'la', pcm());
  assert.deepStrictEqual(out, { move: 0.5, words: [[{ time: 1, end: 2 }]] });
  assert.deepStrictEqual(s.fit.get(s.song, 'la'), out);
  assert.strictEqual(s.fit.get(s.song, 'other'), undefined);
  fs.writeFileSync(s.song, 'changed');
  assert.strictEqual(s.fit.get(s.song, 'la'), undefined);
});
test("a song its words can't be read for is remembered as such", async () => {
  const s = setup((w, m) => w.emit('message', { id: m.id, words: null }));
  await s.fit.run(s.song, 'la', pcm());
  assert.deepStrictEqual(s.fit.get(s.song, 'la'), { move: 0.5, words: null });
});
test('the newest song takes the place of one waiting, and the worker goes when none is left', async () => {
  const s = setup((w, m) => w.emit('message', { id: m.id, words: [] }));
  const first = s.fit.run(s.song, 'a', pcm()), second = s.fit.run(s.song, 'b', pcm()), third = s.fit.run(s.song, 'c', pcm());
  assert.deepStrictEqual(await first, { move: 0.5, words: [] });
  assert.strictEqual(await second, undefined);
  assert.deepStrictEqual(await third, { move: 0.5, words: [] });
  assert.ok(s.made.every((w) => w.gone));
});
test('a failure is told, is not kept, and the next song still goes', async () => {
  let n = 0;
  const s = setup((w, m) => (n++ ? w.emit('message', { id: m.id, words: [] }) : w.emit('message', { id: m.id, error: 'no' })));
  await assert.rejects(s.fit.run(s.song, 'a', pcm()), /no/);
  assert.strictEqual(s.fit.get(s.song, 'a'), undefined);
  assert.deepStrictEqual(await s.fit.run(s.song, 'b', pcm()), { move: 0.5, words: [] });
});

test('words read from the dictionary, an unknown one by its letters, swear words unstarred, punctuation as nothing', () => {
  assert.deepStrictEqual(phonesOf('Rain'), ['ɹ', 'eɪ', 'n']);
  assert.deepStrictEqual(phonesOf("Fallin'"), phonesOf('falling'));
  assert.deepStrictEqual(phonesOf('f**king'), phonesOf('fucking'));
  assert.deepStrictEqual(phonesOf('card'), ['k', 'ɑːɹ', 'd']);
  assert.deepStrictEqual(phonesOf(','), []);
  assert.ok(phonesOf('zzgrblt').length > 2);
  assert.ok(['Rain', 'runneth', 'zzgrblt', 'boy'].flatMap(phonesOf).every((p) => PHONES.includes(p)));
});
test('a word made of words ("tongue-tied", quote and all) said as its parts, not spelled out as one unknown word', () => {
  assert.deepStrictEqual(phonesOf('tongue-tied"'), [...phonesOf('tongue'), ...phonesOf('tied')]);
  assert.deepStrictEqual(phonesOf('half–way'), [...phonesOf('half'), ...phonesOf('way')]); // (an en dash too)
  assert.deepStrictEqual(phonesOf('-'), []);
  assert.strictEqual(readsAsEnglish([['I', 'feel', 'so', 'tongue-tied', 'and', 'half-way', 'gone']]), true);
});
test('a song in another language or run together is not taken for English', () => {
  assert.strictEqual(readsAsEnglish([['I', 'think', "it's", 'gonna', 'rain']]), true);
  assert.strictEqual(readsAsEnglish([['Я', 'иду', 'домой', 'сейчас']]), false);
  assert.strictEqual(readsAsEnglish([['Thehellishumongous', 'thedevil\'samongus', 'Whatdoesanybodydowith', 'freedom']]), false);
});
test('a line as phones, spaces between its words, a word without any skipped', () => {
  const { ids, spans } = linePhones(['we', ',', 'go']);
  assert.deepStrictEqual(spans.map((s) => s.word), [0, 2]);
  assert.strictEqual(ids[spans[0].last + 1], PHONES.indexOf(' '));
});
test('phones land where the frames say they are, a held one for all its frames', () => {
  const classes = 72, plan = [BLANK, BLANK, 3, 3, 3, 3, 3, BLANK, 7, 7, 3, BLANK], song = new Float32Array(plan.length * classes).fill(-10);
  plan.forEach((c, t) => { song[t * classes + c] = 0; });
  assert.deepStrictEqual(alignPhones(song, classes, 0, plan.length, [3, 7, 3]), [{ first: 2, last: 6 }, { first: 8, last: 9 }, { first: 10, last: 10 }]);
});
test('too few frames for the phones: none, and it asks only of the frames given', () => {
  const song = new Float32Array(6 * 72);
  assert.strictEqual(alignPhones(song, 72, 0, 3, [1, 2, 3]), null);
  assert.ok(alignPhones(song, 72, 1, 6, [1, 2]));
});

test('a whole song in one path: phones found where the frames say, within their reach', () => {
  const classes = 72, plan = [BLANK, 3, 3, 3, BLANK, BLANK, 7, 7, BLANK, 5, BLANK, BLANK], song = new Float32Array(plan.length * classes).fill(-10);
  plan.forEach((c, t) => { song[t * classes + c] = 0; });
  const all = [[0, 12], [0, 12], [0, 12]];
  assert.deepStrictEqual(alignSong(song, classes, plan.length, [3, 7, 5], all), [{ first: 1, last: 3 }, { first: 6, last: 7 }, { first: 9, last: 9 }]);
});
test('a phone kept to its reach, however the frames look, and none found out of order', () => {
  const classes = 72, plan = [BLANK, 3, 3, 3, BLANK, BLANK, 7, 7, BLANK, 5, BLANK, BLANK], song = new Float32Array(plan.length * classes).fill(-10);
  plan.forEach((c, t) => { song[t * classes + c] = 0; });
  const out = alignSong(song, classes, plan.length, [3, 7, 5], [[5, 9], [5, 9], [5, 11]]);
  assert.ok(out[0].first >= 5 && out[0].last < 9);
  assert.ok(out[0].last < out[1].first && out[1].last < out[2].first);
});
test("phones that can't fit in their reach: none, and the song isn't taken to have been timed", () => {
  const song = new Float32Array(12 * 72);
  assert.strictEqual(alignSong(song, 72, 12, [1, 2, 3], [[0, 1], [0, 1], [0, 1]]), null);
  assert.strictEqual(alignSong(song, 72, 3, [1, 2, 3], [[0, 3], [0, 3], [0, 3]]), null);
});

test('a transform there and back', () => {
  const re = Float64Array.from({ length: 64 }, (_, i) => Math.sin(i)), im = new Float64Array(64), was = Array.from(re);
  fft(re, im); fft(re, im, true);
  re.forEach((v, i) => assert.ok(Math.abs(v - was[i]) < 1e-9));
});
test('a tone keeps its pitch and level through a change of rate', () => {
  const tone = (rate, n) => Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / rate));
  const out = resample(tone(44100, 44100), 44100, 16000), want = tone(16000, 16000);
  assert.ok(Math.abs(out.length - 16000) <= 1);
  for (let i = 200; i < 15800; i += 37) assert.ok(Math.abs(out[i] - want[i]) < 0.01, `at ${i}: ${out[i]} vs ${want[i]}`);
});
test('the spectrogram: as many bands and frames as asked, the tone in its band', () => {
  const x = Float32Array.from({ length: 22050 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / 22050)), { data, T } = melSpectrogram(x);
  assert.strictEqual(T, 1 + Math.floor(22050 / 256));
  assert.strictEqual(data.length, 128 * T);
  let top = 0; for (let m = 0; m < 128; m++) if (data[m * T + 40] > data[top * T + 40]) top = m;
  assert.ok(top > 25 && top < 50, `band ${top}`);
});
test('all let through by the mask, a song comes back as itself; nothing let through, as silence', async () => {
  const n = 40000, left = Float32Array.from({ length: n }, (_, i) => Math.sin(i * 0.03)), right = Float32Array.from({ length: n }, (_, i) => Math.sin(i * 0.05));
  const spec = { size: 1024, hop: 256, bins: 512, split: 32 };
  const whole = await maskedMono(left, right, spec, (m) => [m[0].map(() => 1), m[1].map(() => 1)]);
  for (let i = 2000; i < n - 2000; i += 97) assert.ok(Math.abs(whole[i] - (left[i] + right[i]) / 2) < 0.02, `at ${i}`);
  const none = await maskedMono(left, right, spec, (m) => [m[0].map(() => 0), m[1].map(() => 0)]);
  assert.ok(none.every((v) => v === 0));
});

test("a word's sounds over its frames: the held note goes to the vowel, even where the model hears nothing clear", () => {
  const { soundsInside } = require('../src/main/karaoke/align');
  const { linePhones } = require('../src/main/karaoke/phones');
  const { ids, spans } = linePhones(['rain']), own = ids.slice(spans[0].first, spans[0].last + 1), classes = 72, frames = 100;
  // Nothing in the model's favour for any sound in the middle; only the very start and end say anything.
  const song = new Float32Array(frames * classes).fill(-4);
  song[own[0]] = -0.1; song[(frames - 1) * classes + own[2]] = -0.1;
  assert.deepStrictEqual(soundsInside(song, classes, 0, frames, own), [1, 99]);
  assert.strictEqual(soundsInside(song, classes, 0, 2, own), null); // (fewer frames than sounds)
  assert.strictEqual(soundsInside(song, classes, 0, frames, own.slice(0, 1)), null); // (one sound: nothing to share)
});

test("words that can't be read are found out before the song is decoded, and remembered", async () => {
  const s = setup((w, m) => w.emit('message', { id: m.id, reads: false }));
  assert.strictEqual(await s.fit.reads(s.song, 'la', [{ words: ['世界'] }], 0.5), false);
  assert.deepStrictEqual(s.fit.get(s.song, 'la'), { move: 0.5, words: null });
  assert.strictEqual(s.made[0].gone, true); // (its memory back)
  assert.strictEqual(s.made[0].last.onlyRead, true);
});
test('words that can be read, or a worker that fails to say: on to the timing, nothing kept', async () => {
  const s = setup((w, m) => w.emit('message', { id: m.id, reads: true }));
  assert.strictEqual(await s.fit.reads(s.song, 'la', [{ words: ['rain'] }], 0), true);
  assert.strictEqual(s.fit.get(s.song, 'la'), undefined);
  const lost = setup((w) => w.emit('error', new Error('gone')));
  assert.strictEqual(await lost.fit.reads(lost.song, 'la', [], 0), true);
});

test("a word's sounds each get time to fill over, as far as the word has it; none past its end", () => {
  const { spacedBeats } = require('../src/main/karaoke/fit-words');
  const round = (l) => l.map((x) => Math.round(x * 100) / 100);
  assert.deepStrictEqual(round(spacedBeats(10, 14, [10.03, 13.99])), [10.12, 13.88]); // (a held vowel between)
  assert.deepStrictEqual(round(spacedBeats(10, 10.3, [10.01, 10.02])), [10.1, 10.2]); // (a short word: evenly)
  assert.deepStrictEqual(round(spacedBeats(10, 14, [11, 12])), [11, 12]); // (with room already: as they were)
});

test('cancel: what is going is stopped, what is waiting answers undefined, and the next song still gets timed', async () => {
  const workers = [];
  const fake = () => {
    const handlers = {};
    const w = {
      on: (n, f) => { (handlers[n] = handlers[n] || new Set()).add(f); }, off: (n, f) => handlers[n] && handlers[n].delete(f),
      emit: (n, v) => { for (const f of [...(handlers[n] || [])]) f(v); },
      postMessage: (m) => { w.last = m; }, terminate: () => { w.terminated = true; w.emit('exit', 1); },
    };
    workers.push(w);
    return w;
  };
  const files = new Map();
  const memFs = {
    existsSync: () => true, mkdirSync: () => {}, statSync: () => ({ size: 1, mtimeMs: 1 }),
    writeFileSync: (p, s) => files.set(p, s), readFileSync: (p) => { if (!files.has(p)) throw new Error('none'); return files.get(p); },
  };
  const { createWordFit } = require('../src/main/word-fit');
  const fit = createWordFit({ dir: '/d', modelsDir: '/m', fs: memFs, createWorker: fake });
  const song = () => ({ left: new Float32Array(1), right: new Float32Array(1), lines: [], move: 0 });
  const going = fit.run('/a', 'x', song()), waiting = fit.run('/b', 'x', song());
  fit.cancel();
  await assert.rejects(going);
  assert.strictEqual(await waiting, undefined);
  assert.ok(workers[0].terminated);
  assert.strictEqual(fit.get('/a', 'x'), undefined); // (nothing kept for a song left)
  const next = fit.run('/c', 'x', song());
  await new Promise((go) => { setImmediate(go); });
  const w = workers[workers.length - 1];
  assert.notStrictEqual(w, workers[0]);
  w.emit('message', { id: w.last.id, words: [[{ time: 1, end: 2 }]] });
  assert.deepStrictEqual((await next).words, [[{ time: 1, end: 2 }]]);
});
