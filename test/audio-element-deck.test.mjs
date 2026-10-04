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
  createChannelSplitter() { return node(); }
  createChannelMerger() { return node(); }
  createDelay() { return { ...node(), delayTime: param() }; }
  createPanner() { return { ...node(), positionX: param(), positionY: param(), positionZ: param() }; }
  createConvolver() { return node(); }
  createBuffer(channels, length) { const d = Array.from({ length: channels }, () => new Float32Array(length)); return { getChannelData: (c) => d[c] }; }
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

class RoutedContext extends globalThis.AudioContext { createMediaElementSource() { return { connect() {}, disconnect() {} }; } }
const routedEngine = () => { const e = new AudioEngine(); e.ctx = new RoutedContext(); return e; };
globalThis.Audio = class extends FakeElement {};

test('a deck starts at the trim it was loaded with, and setTrim changes it', async () => {
  const engine = routedEngine();
  await engine.load('cdp://app/media?p=a', { autoPlay: false, trim: 0.5 });
  assert.strictEqual(engine.deck.trim.gain.value, 0.5);
  let target = null;
  engine.deck.trim.gain.setTargetAtTime = (v) => { target = v; };
  engine.setTrim(0.25, 1);
  assert.strictEqual(target, 0.25);
  engine.setTrim(0.75);
  assert.strictEqual(engine.deck.trim.gain.value, 0.75);
});

test('trim survives the crossfade curves', async () => {
  const engine = routedEngine();
  await engine.load('cdp://app/media?p=a', { autoPlay: true, trim: 0.5 });
  await engine.load('cdp://app/media?p=b', { autoPlay: false, crossfadeSeconds: 2, trim: 0.3 });
  engine.cancelCrossfade();
  assert.strictEqual(engine.deck.trim.gain.value, 0.3);
  assert.strictEqual(engine.deck.gain.gain.value, 1);
});

test('a supplied element has no trim, and setTrim leaves it alone', async () => {
  const engine = new AudioEngine();
  await engine.load('spotify:track:A', { autoPlay: false, element: new FakeElement() });
  assert.strictEqual(engine.deck.trim, null);
  engine.setTrim(0.5); // no throw
});

const { SEAM_LEAD } = await import('../src/renderer/js/audio.js');
const curves = (deck) => { const got = []; deck.gain.gain.setValueCurveAtTime = (c) => got.push(Array.from(c)); return got; };
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

test('prepare leaves a paused standby at gain 0, at the segment start', async () => {
  const engine = routedEngine();
  await engine.load('cdp://app/media?p=a', { autoPlay: true });
  assert.strictEqual(await engine.prepare('cdp://app/media?p=b', { segment: { start: 30, end: 90 }, trim: 0.5 }), true);
  const s = engine.standby;
  assert.deepStrictEqual([s.el.paused, s.el.currentTime, s.gain.gain.value, s.trim.gain.value, s.end], [true, 30, 0, 0.5, 90]);
  assert.deepStrictEqual(engine.prepared, { url: 'cdp://app/media?p=b', start: 30 });
});

test('a new load, stop or cancelPrepared drops the standby', async () => {
  const engine = routedEngine();
  await engine.load('cdp://app/media?p=a', { autoPlay: true });
  await engine.prepare('cdp://app/media?p=b');
  const s = engine.standby;
  await engine.load('cdp://app/media?p=c', { autoPlay: false });
  assert.strictEqual(engine.prepared, null);
  assert.ok(s.el.loads >= 1, 'disposed');
  await engine.prepare('cdp://app/media?p=b'); engine.stop(); assert.strictEqual(engine.prepared, null);
  await engine.load('cdp://app/media?p=a', { autoPlay: true });
  await engine.prepare('cdp://app/media?p=b'); engine.cancelPrepared(); assert.strictEqual(engine.prepared, null);
});

test('the seam: the standby starts as the deck ends, the decks blend and swap, onAdvance once', async () => {
  const engine = routedEngine();
  await engine.load('cdp://app/media?p=a', { autoPlay: true });
  await engine.prepare('cdp://app/media?p=b');
  const outgoing = engine.deck, incoming = engine.standby;
  const outCurves = curves(outgoing), inCurves = curves(incoming);
  const advanced = [], ended = [];
  engine.onAdvance = (d) => advanced.push(d);
  engine.onEnded = (d) => ended.push(d);
  outgoing.el.currentTime = outgoing.el.duration - 0.1; // within the watch window, not yet the lead
  engine.watchSeam();
  assert.strictEqual(incoming.el.paused, true);
  outgoing.el.currentTime = outgoing.el.duration - SEAM_LEAD / 2;
  await tick(20);
  assert.strictEqual(incoming.el.paused, false);
  assert.strictEqual(engine.deck, incoming);
  assert.strictEqual(engine.prepared, null);
  assert.deepStrictEqual(advanced, [incoming]);
  assert.ok(outCurves[0][0] > 0.99 && outCurves[0].at(-1) < 0.01, 'out falls');
  assert.ok(inCurves[0][0] < 0.01 && inCurves[0].at(-1) > 0.99, 'in rises');
  engine.watchSeam(); await tick(20);
  assert.strictEqual(advanced.length, 1);
  outgoing.el.fire('ended');
  assert.deepStrictEqual(ended, [], 'the old deck ending is ignored');
  await tick(80);
  assert.ok(outgoing.el.paused);
});

test('a paused deck doesn\'t seam', async () => {
  const engine = routedEngine();
  await engine.load('cdp://app/media?p=a', { autoPlay: true });
  await engine.prepare('cdp://app/media?p=b');
  engine.deck.el.currentTime = engine.deck.el.duration - 0.005;
  engine.pause();
  engine.watchSeam(); await tick(20);
  assert.strictEqual(engine.standby.el.paused, true);
  assert.notStrictEqual(engine.deck, engine.standby);
});

test('a seeked-away deck doesn\'t seam', async () => {
  const engine = routedEngine();
  await engine.load('cdp://app/media?p=a', { autoPlay: true });
  await engine.prepare('cdp://app/media?p=b');
  engine.deck.el.currentTime = engine.deck.el.duration - 0.1;
  engine.watchSeam();
  engine.deck.el.currentTime = 10; // seeked back while the fine timer waits
  await tick(30);
  assert.strictEqual(engine.standby.el.paused, true);
  assert.ok(engine.prepared);
});

test('a cue stretch seams at its own end, not the file\'s', async () => {
  const engine = routedEngine();
  await engine.load('cdp://app/media?p=a', { autoPlay: true, segment: { start: 0, end: 60 } });
  await engine.prepare('cdp://app/media?p=b');
  engine.deck.el.currentTime = 60 - SEAM_LEAD / 2;
  engine.watchSeam(); await tick(20);
  assert.strictEqual(engine.deck.url, 'cdp://app/media?p=b');
});

test('a standby that fails to load resolves false', async () => {
  const engine = routedEngine();
  await engine.load('cdp://app/media?p=a', { autoPlay: true });
  const Real = globalThis.Audio;
  globalThis.Audio = class extends FakeElement { fire(t) { super.fire(t === 'loadedmetadata' ? 'error' : t); } };
  try { assert.strictEqual(await engine.prepare('cdp://app/media?p=gone'), false); } finally { globalThis.Audio = Real; }
  assert.strictEqual(engine.prepared, null);
});

test('a refused play keeps the old deck', async () => {
  const engine = routedEngine();
  await engine.load('cdp://app/media?p=a', { autoPlay: true });
  await engine.prepare('cdp://app/media?p=b');
  const old = engine.deck;
  engine.standby.el.play = () => Promise.reject(new Error('NotAllowedError'));
  engine.deck.el.currentTime = engine.deck.el.duration - 0.005;
  engine.watchSeam(); await tick(20);
  assert.strictEqual(engine.deck, old);
  assert.strictEqual(engine.deck.gain.gain.value, 1);
});
