import test from 'node:test';
import assert from 'node:assert';
import { powerEnvelope, detectHidden, BLOCK_SECONDS, splitTitle, hiddenPhase, countdown, hiddenName, displayTitle, shownTitle } from '../src/renderer/js/hidden-track.js';

// Synthetic songs at 8 kHz (the waveform's decode rate): noise-and-tone "music" at a given level, digital zeros,
// 16-bit dither, tape hiss.
const RATE = 8000;
let seed = 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return (s - 3) * Math.SQRT2; };
const dbLin = (d) => 10 ** (d / 20);
function music(sec, rmsDb, { fadeOut = 0, pauses = false } = {}) {
  const n = Math.round(sec * RATE), out = new Float32Array(n), a = dbLin(rmsDb);
  for (let i = 0; i < n; i++) {
    const t = i / RATE, beat = 0.6 + 0.4 * Math.abs(Math.sin(Math.PI * t * 2));
    let g = a * beat * (gauss() * 0.7 + Math.sin(2 * Math.PI * 220 * t) * 0.7);
    if (fadeOut && t > sec - fadeOut) g *= ((sec - t) / fadeOut) ** 2;
    if (pauses && (t % 4) > 3) g = 0;
    out[i] = g;
  }
  return out;
}
const zeros = (sec) => new Float32Array(Math.round(sec * RATE));
const dither = (sec) => { const n = Math.round(sec * RATE), o = new Float32Array(n), lsb = 1 / 32768; for (let i = 0; i < n; i++) o[i] = (rnd() - rnd()) * lsb; return o; };
const hiss = (sec, d) => { const n = Math.round(sec * RATE), o = new Float32Array(n), a = dbLin(d); for (let i = 0; i < n; i++) o[i] = gauss() * a; return o; };
const cat = (...xs) => { const n = xs.reduce((s, x) => s + x.length, 0), o = new Float32Array(n); let p = 0; for (const x of xs) { o.set(x, p); p += x.length; } return o; };
const add = (x, y) => { const o = new Float32Array(x.length); for (let i = 0; i < x.length; i++) o[i] = x[i] + y[i]; return o; };
const detect = (x, y = x) => detectHidden(powerEnvelope([x, y], RATE));

const found = [
  ['Nevermind-like: a 232 s song fading out, 598 s of zeros, a 405 s hidden song', () => cat(music(232, -14, { fadeOut: 8 }), zeros(598), music(405, -12)), [232, 830]],
  ['the same with 16-bit dither for silence', () => cat(music(232, -14, { fadeOut: 8 }), dither(598), music(405, -12)), [232, 830]],
  ['the same with -58 dBFS hiss under everything', () => { const x = cat(music(232, -14, { fadeOut: 8 }), zeros(598), music(405, -12)); return add(x, hiss(x.length / RATE, -58)); }, [232, 830]],
  ['Dookie-like: a 170 s song, 80 s of zeros, a 96 s hidden song', () => cat(music(170, -10), zeros(80), music(96, -10)), [170, 250]],
  ['a quiet a cappella hidden song at -38 dBFS with 1 s pauses', () => cat(music(300, -14), dither(240), music(90, -38, { pauses: true })), [300, 540]],
];
for (const [name, make, [songEnd, hiddenStart]] of found) {
  test(`found: ${name}`, () => {
    const r = detect(make());
    assert.ok(r, 'nothing found');
    assert.ok(Math.abs(r.songEnd - songEnd) <= 2, `songEnd ${r.songEnd}`);
    assert.ok(Math.abs(r.hiddenStart - hiddenStart) <= 0.2, `hiddenStart ${r.hiddenStart}`);
  });
}

const notFound = [
  ['a long ambient outro at -46 dBFS, no silence', () => cat(music(240, -14), music(120, -46))],
  ['a song, 600 s of zeros, then 4 s of noise', () => cat(music(240, -14), zeros(600), music(4, -20))],
  ['a song with a 3 s dead stop in the middle', () => cat(music(120, -14), zeros(3), music(120, -14))],
  ['a song with a 20 s quiet interlude at -52 dBFS', () => cat(music(120, -14), music(20, -52), music(120, -14))],
  ['a song then ten minutes of silence to the end', () => cat(music(240, -14, { fadeOut: 8 }), zeros(600))],
  ['30 s of silence before the song (a pregap)', () => cat(zeros(30), music(240, -14))],
];
for (const [name, make] of notFound) test(`not a hidden track: ${name}`, () => assert.strictEqual(detect(make()), null));

test('silence on one channel only is not a gap', () => {
  const left = music(900, -14), right = cat(music(232, -14), zeros(598), music(70, -14));
  assert.strictEqual(detect(left, right), null);
});

test('the envelope has one block per 100 ms, the last one partial', () => {
  const x = zeros(10.05);
  assert.strictEqual(BLOCK_SECONDS, 0.1);
  assert.strictEqual(powerEnvelope([x, x], RATE).length, Math.ceil(x.length / 800));
});

test('a title "A / B" names the song and the hidden one; anything else doesn\'t', () => {
  assert.deepStrictEqual(splitTitle('Something in the Way / Endless, Nameless'), { main: 'Something in the Way', hidden: 'Endless, Nameless' });
  assert.strictEqual(splitTitle('AC/DC'), null);
  assert.strictEqual(splitTitle('A / '), null);
  assert.strictEqual(splitTitle(null), null);
});

const h = { songEnd: 232, hiddenStart: 830, found: false, name: null };

test('the song, the silence and the hidden song are where the position is, however it got there', () => {
  assert.strictEqual(hiddenPhase(null, 10), null);
  assert.deepStrictEqual([0, 231.9, 232, 500, 829.9, 830, 1235].map((p) => hiddenPhase(h, p)), ['song', 'song', 'silence', 'silence', 'silence', 'hidden', 'hidden']);
  assert.strictEqual(hiddenPhase(h, 900), 'hidden'); // a seek from the start straight into it
});

test('the pill counts down to the hidden song, rounding up', () => {
  assert.strictEqual(countdown(h, 830 - 462), 'NOT OVER YET · 7:42');
  assert.strictEqual(countdown(h, 830 - 461.2), 'NOT OVER YET · 7:42');
  assert.strictEqual(countdown(h, 830 - 0.4), 'NOT OVER YET · 0:01');
  assert.strictEqual(countdown({ ...h, found: true, name: 'Endless, Nameless' }, 368), 'ENDLESS, NAMELESS IN 7:42');
  assert.strictEqual(countdown({ ...h, found: true }, 368), 'HIDDEN TRACK IN 7:42');
});

test('the hidden song\'s name, and the title shown before it', () => {
  assert.strictEqual(hiddenName({ ...h, name: 'Endless, Nameless' }, { title: 'Something in the Way' }), 'Endless, Nameless');
  assert.strictEqual(hiddenName(h, { title: 'Something in the Way / Endless, Nameless' }), 'Endless, Nameless');
  assert.strictEqual(hiddenName(h, { title: 'Something in the Way' }), null);
  assert.strictEqual(displayTitle({ title: 'Something in the Way / Endless, Nameless' }), 'Something in the Way');
  assert.strictEqual(displayTitle({ title: 'AC/DC' }), 'AC/DC');
});

test('a medley "A / B" keeps its whole title; only a file with a hidden track shows A', () => {
  assert.strictEqual(shownTitle({ title: 'Speak to Me / Breathe' }, null), 'Speak to Me / Breathe');
  assert.strictEqual(shownTitle({ title: 'Something in the Way / Endless, Nameless' }, h), 'Something in the Way');
  assert.strictEqual(shownTitle({ title: 'Polly' }, h), 'Polly');
});
