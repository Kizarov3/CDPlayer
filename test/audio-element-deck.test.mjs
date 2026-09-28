import test from 'node:test';
import assert from 'node:assert';

// Just enough Web Audio for AudioEngine's constructor and gain handling.
const param = () => ({ value: 1, setTargetAtTime() {}, cancelScheduledValues() {}, setValueCurveAtTime() {} });
const node = () => ({ connect() {}, disconnect() {}, gain: param() });
globalThis.AudioContext = class {
  constructor() { this.currentTime = 0; this.state = 'running'; this.destination = node(); this.sampleRate = 44100; }
  createGain() { return node(); }
  createBiquadFilter() { return { ...node(), type: '', frequency: param(), Q: param() }; }
  createAnalyser() { return { ...node(), fftSize: 0, frequencyBinCount: 1024, smoothingTimeConstant: 0 }; }
  createMediaElementSource() { throw new Error('a supplied element must not be routed through Web Audio'); }
  resume() { return Promise.resolve(); }
};
const { AudioEngine } = await import('../src/renderer/js/audio.js');

class FakeElement {
  constructor() { this.paused = true; this.ended = false; this.currentTime = 0; this.duration = 200; this.h = {}; this.loads = 0; setTimeout(() => this.fire('loadedmetadata'), 0); }
  addEventListener(t, f) { (this.h[t] = this.h[t] || []).push(f); }
  removeEventListener(t, f) { this.h[t] = (this.h[t] || []).filter((x) => x !== f); }
  fire(t) { for (const f of this.h[t] || []) f(); }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute() {}
  load() { this.loads++; }
}

test('a supplied element is the deck: position, length, play, seek and end come from it', async () => {
  const engine = new AudioEngine();
  const el = new FakeElement();
  const endedDecks = [];
  engine.onEnded = (d) => endedDecks.push(d);
  assert.strictEqual(await engine.load('spotify:track:A', { autoPlay: true, element: el }), true);
  assert.ok(engine.playing);
  assert.strictEqual(engine.duration, 200);
  engine.seek(42);
  assert.strictEqual(el.currentTime, 42);
  assert.strictEqual(engine.position, 42);
  el.fire('ended');
  assert.deepStrictEqual(endedDecks, [engine.deck]);
});

test('no crossfade out of a supplied element: it stops as the next track loads', async () => {
  const engine = new AudioEngine();
  const a = new FakeElement();
  await engine.load('spotify:track:A', { autoPlay: true, element: a });
  const b = new FakeElement();
  await engine.load('spotify:track:B', { autoPlay: true, crossfadeSeconds: 5, element: b });
  assert.ok(!engine.crossfading);
  assert.strictEqual(a.loads, 1); // disposed
  engine.stop();
  assert.strictEqual(b.loads, 1);
});
