import test from 'node:test';
import assert from 'node:assert';
import { voiceEnvelope, voiceBreaks, lyricsMove, holdLongWords, holdLastWords, SYNC_RATE } from '../src/renderer/js/lyrics-sync.js';

const DT = 0.02;
// Twenty-four lines of uneven length and gap, as a song has.
const lines = Array.from({ length: 24 }, (_, i) => {
  const time = 10 + i * 6 + ((i * 7) % 5) * 0.4, len = 1.5 + ((i * 3) % 4) * 0.5;
  return { time, end: time + len, text: 'la la la la', words: [{ time, end: time + len, text: 'la' }] };
});
// A level for each frame, higher where the voice is: at the lines' times moved by `by`.
const envelopeFor = (by, seconds = 180, whenMoved = () => by) => {
  const e = new Float32Array(Math.round(seconds / DT)).fill(3);
  for (const l of lines) for (let f = Math.round((l.time + whenMoved(l.time)) / DT); f < (l.end + whenMoved(l.time)) / DT; f++) e[f] = 6;
  return e;
};
const near = (a, b) => assert.ok(Math.abs(a - b) <= 0.04, `${a} is not about ${b}`);

test('lyrics early or late against the voice: moved by that much', () => {
  near(lyricsMove(envelopeFor(0.4), lines), 0.4);
  near(lyricsMove(envelopeFor(-0.5), lines), -0.5);
});

test('lyrics on the voice already, or a move too small to matter: left alone', () => {
  assert.strictEqual(lyricsMove(envelopeFor(0), lines), 0);
  assert.strictEqual(lyricsMove(envelopeFor(0.06), lines), 0);
});

test('a move so big it is likelier wrong: left alone', () => {
  assert.strictEqual(lyricsMove(envelopeFor(3), lines), 0);
});

test('no voice to go by, or too few lines: left alone', () => {
  assert.strictEqual(lyricsMove(new Float32Array(9000).fill(4), lines), 0);
  assert.strictEqual(lyricsMove(envelopeFor(0.4), lines.slice(0, 5)), 0);
  assert.strictEqual(lyricsMove(new Float32Array(0), lines), 0);
});

test('thirds of the song that disagree: not moved as a whole', () => {
  const parts = envelopeFor(0, 180, (t) => (t < 60 ? 0.7 : t < 110 ? -0.7 : 0.15));
  assert.strictEqual(lyricsMove(parts, lines), 0);
});

test('the voice is heard in the middle of the stereo picture, not at its sides', async () => {
  const seconds = 2, n = seconds * SYNC_RATE, tone = Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 800 * i) / SYNC_RATE));
  const silent = new Float32Array(n);
  const middle = await voiceEnvelope(tone, tone), side = await voiceEnvelope(tone, silent), both = await voiceEnvelope(tone, Float32Array.from(tone, (v) => -v));
  const at = (e) => e[Math.floor(e.length / 2)];
  assert.ok(at(middle) > 8, `middle ${at(middle)}`);
  assert.ok(at(side) < 3.1, `one side alone ${at(side)}`); // (as much in the sides as in the middle: nothing left)
  assert.ok(at(both) < 3.1, `out of phase ${at(both)}`);
  assert.strictEqual(middle.length, Math.floor((n - 1024) / 320));
});

test('it stops to let the window draw', async () => {
  let rests = 0;
  await voiceEnvelope(new Float32Array(SYNC_RATE * 30), new Float32Array(SYNC_RATE * 30), async () => { rests++; });
  assert.ok(rests >= 3);
});

const frames = (seconds, value) => new Float32Array(Math.round(seconds / DT)).fill(value);
const zone = (a, from, to, value) => { for (let f = Math.round(from / DT); f < Math.round(to / DT); f++) a[f] = value; };

test('a held note the words cut short: held up to the breath, the words stamped before it laid after it', () => {
  const env = frames(40, 12.5); zone(env, 14.2, 14.3, 9); // (the breath, at 14.2)
  const line = { time: 10, text: 'Feed my eyes can', words: [{ time: 10, text: 'Feed ' }, { time: 13, text: 'my ' }, { time: 13.5, text: 'eyes ' }, { time: 17, text: 'can' }] };
  const [held] = holdLongWords(voiceBreaks(env), [line, { time: 20, text: 'next' }]);
  assert.ok(Math.abs(held.words[0].end - 14.2) < 0.1, `held to ${held.words[0].end}`);
  assert.ok(held.words[1].time >= 14.15 && held.words[1].time < held.words[2].time && held.words[2].time < 17, 'my and eyes after it, in order');
  assert.strictEqual(held.words[3].time, 17); // (the next word that was right stays)
  assert.deepStrictEqual(held.words.map((w) => w.text), line.words.map((w) => w.text));
});

test('no deep breath after it, or short words: the stamps stand', () => {
  const line = { time: 10, text: 'a b', words: [{ time: 10, text: 'a ' }, { time: 13, text: 'b' }] };
  assert.strictEqual(holdLongWords(voiceBreaks(frames(40, 12.5)), [line, { time: 20, text: 'next' }]), null);
  const env = frames(40, 12.5); zone(env, 10.8, 10.9, 9);
  const quick = { time: 10, text: 'a b', words: [{ time: 10, text: 'a ' }, { time: 10.5, text: 'b' }] };
  assert.strictEqual(holdLongWords(voiceBreaks(env), [quick, { time: 20, text: 'next' }]), null);
});

test('a word that was right is not made late: a shallow dip, or a word barely long, stays on its stamp', () => {
  const line = { time: 10, text: 'a b', words: [{ time: 10, text: 'a ' }, { time: 13, text: 'b' }] };
  const shallow = frames(40, 12.5); zone(shallow, 14.2, 14.3, 11);
  assert.strictEqual(holdLongWords(voiceBreaks(shallow), [line, { time: 20, text: 'next' }]), null);
  const deep = frames(40, 12.5); zone(deep, 11.5, 11.6, 9);
  const barely = { time: 10, text: 'a b', words: [{ time: 10, text: 'a ' }, { time: 11.2, text: 'b' }] };
  assert.strictEqual(holdLongWords(voiceBreaks(deep), [barely, { time: 20, text: 'next' }]), null);
});

test('a held note running through most of a long next word: held to the stop, the next word sung after it', () => {
  const env = frames(40, 12.5); zone(env, 16, 16.1, 9); // ("Jesus" stops at 16, well into the time stamped for "Christ")
  const line = { time: 11.7, text: 'Jesus Christ deny', words: [{ time: 11.7, text: 'Jesus ' }, { time: 13.3, text: 'Christ ', end: 16.9 }, { time: 17.8, text: 'deny' }] };
  const [held] = holdLongWords(voiceBreaks(env), [line, { time: 20, text: 'next' }]);
  assert.ok(Math.abs(held.words[1].time - 16) < 0.1, `Christ at ${held.words[1].time}`);
  assert.strictEqual(held.words[2].time, 17.8);
});

test('a stop at the very end of a long next word is that word finishing: the stamps stand', () => {
  const env = frames(40, 12.5); zone(env, 15.8, 15.9, 9);
  const line = { time: 11.7, text: 'Jesus Christ deny', words: [{ time: 11.7, text: 'Jesus ' }, { time: 13.3, text: 'Christ ' }, { time: 16, text: 'deny' }] };
  assert.strictEqual(holdLongWords(voiceBreaks(env), [line, { time: 20, text: 'next' }]), null);
});

test("a line's last word sung on past its stamp: held until the voice in the middle falls, not to the next line", () => {
  const centre = frames(40, 0.4); zone(centre, 10, 18, 1);
  const line = { time: 10, text: 'my misery', end: 13, words: [{ time: 10, text: 'my ' }, { time: 11, end: 13, text: 'misery' }] };
  const [held] = holdLastWords(centre, [line, { time: 30, text: 'next' }]);
  assert.ok(Math.abs(held.words[1].end - 18) < 0.5, `held to ${held.words[1].end}`);
  assert.strictEqual(held.end, held.words[1].end);
  assert.strictEqual(held.words[0].time, 10);
});

test('a band playing on to the next line, or a voice that stopped when stamped: left as they are', () => {
  const line = { time: 10, text: 'a misery', end: 13, words: [{ time: 10, text: 'a ' }, { time: 11, end: 13, text: 'misery' }] };
  assert.strictEqual(holdLastWords(frames(40, 1), [line, { time: 16, text: 'next' }]), null);
  const off = frames(40, 0.4); zone(off, 10, 13, 1);
  assert.strictEqual(holdLastWords(off, [line, { time: 30, text: 'next' }]), null);
});

test('a short stamp held on while the voice stays, to where it falls away and stays down', () => {
  const quick = { time: 10, text: 'gonna rain', end: 11, words: [{ time: 10, text: 'gonna ' }, { time: 10.6, end: 11, text: 'rain' }] };
  const long = frames(40, 0.4); zone(long, 10, 15, 1); // ("rain", stamped 0.4 s, sung for 4)
  const [held] = holdLastWords(long, [quick, { time: 30, text: 'next' }]);
  assert.ok(Math.abs(held.end - 15) < 0.5, `to ${held.end}`);
  const little = frames(40, 0.4); zone(little, 10, 11.7, 1);
  const [ran] = holdLastWords(little, [quick, { time: 30, text: 'next' }]);
  assert.ok(Math.abs(ran.end - 11.7) < 0.4, `to ${ran.end}`);
});

test('a short stamp is not held so far that it is likelier a band than a voice', () => {
  const quick = { time: 10, text: 'gonna shut', end: 11, words: [{ time: 10, text: 'gonna ' }, { time: 10.6, end: 11, text: 'shut' }] };
  const band = frames(40, 0.4); zone(band, 10, 19, 1);
  assert.strictEqual(holdLastWords(band, [quick, { time: 30, text: 'next' }]), null);
});

test('a word stamped long goes by its own level: its voice sinking under what it held at first is no stop', () => {
  const line = { time: 10, text: 'my misery', end: 14, words: [{ time: 10, text: 'my ' }, { time: 10.5, end: 14, text: 'misery' }] };
  const centre = frames(40, 0.2); zone(centre, 10, 20, 0.6); zone(centre, 14, 17, 1.2);
  const [held] = holdLastWords(centre, [line, { time: 30, text: 'next' }]);
  assert.ok(Math.abs(held.end - 20) < 0.5, `to ${held.end}`);
});

test('a passing dip in a band playing on is no voice stopping: left as stamped', () => {
  const quick = { time: 10, text: 'gonna shut', end: 11, words: [{ time: 10, text: 'gonna ' }, { time: 10.6, end: 11, text: 'shut' }] };
  const dip = frames(40, 1); zone(dip, 15, 15.42, 0.55);
  assert.strictEqual(holdLastWords(dip, [quick, { time: 30, text: 'next' }]), null);
});

test('a line timed as a whole has its last word held too', () => {
  const whole = frames(40, 0.4); zone(whole, 10, 12.6, 1);
  const [timed] = holdLastWords(whole, [{ time: 10, text: 'one two' }, { time: 30, text: 'next' }]);
  assert.ok(Math.abs(timed.end - 12.6) < 0.4, `to ${timed.end}`);
  assert.deepStrictEqual(timed.words.map((w) => w.text.trim()), ['one', 'two']);
});
