'use strict';
// --perf-report's own sums (perf-report.js): the run itself needs the window, these don't.
const test = require('node:test');
const assert = require('node:assert');
const { summarize, chordWav } = require('../src/main/perf-report');

test('a frame is late against the pace the window set itself, not against 60 a second', () => {
  const s = summarize({ frames: [[0, 16.7, 0], [1, 40, 0], [2, 100, 100], [3, 170, 100]], seconds: 2, cpu: { Tab: 1.24, GPU: 0.5 } });
  assert.strictEqual(s.late, 2); // 40 ms at full rate, 170 ms at 10 a second
  assert.strictEqual(s.fps, 2);
  assert.strictEqual(s.worstFrame, 170);
  assert.strictEqual(s.cpuTotal, 1.7);
  assert.strictEqual(s.answers, null);
});

test('clicks and keys: the middle answer and the slowest, with what it was; the scripts that held long frames, most first', () => {
  const s = summarize({
    events: [{ name: 'keydown', d: 40 }, { name: 'pointerdown', d: 24 }, { name: 'click', d: 88 }],
    loafs: [{ block: 30, scripts: [{ src: 'app.js:frame', d: 60 }, { src: 'shelf.js:layout', d: 20 }] }, { block: 10, scripts: [{ src: 'shelf.js:layout', d: 50 }] }],
  });
  assert.deepStrictEqual(s.answers, { n: 3, p50: 40, worst: 88, worstWhat: 'click' });
  assert.strictEqual(s.blockedMs, 40);
  assert.deepStrictEqual(s.slowest, ['shelf.js:layout 70ms', 'app.js:frame 60ms']);
});

test('the music it plays: a WAV of the length asked, stereo 16-bit, never clipping', () => {
  const wav = chordWav(1, 8000);
  assert.strictEqual(wav.toString('ascii', 0, 4), 'RIFF');
  assert.strictEqual(wav.readUInt32LE(40), 8000 * 4);
  let peak = 0;
  for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
  assert.ok(peak > 3000 && peak < 32767, String(peak));
});
