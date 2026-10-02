import test from 'node:test';
import assert from 'node:assert';

// Just enough Web Audio: contexts remember their rate, whether they were closed, and their output device.
const param = () => ({ value: 1, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {}, setValueCurveAtTime() {} });
const node = () => ({ connect() {}, disconnect() {}, gain: param() });
const made = [];
globalThis.AudioContext = class {
  constructor(opts = {}) {
    if (opts.sampleRate === 999) throw new Error('NotSupportedError');
    this.sampleRate = opts.sampleRate || 48000; this.currentTime = 0; this.state = 'running'; this.destination = node(); this.closed = false; this.sinkId = '';
    made.push(this);
  }
  createGain() { return node(); }
  createBiquadFilter() { return { ...node(), type: '', frequency: param(), Q: param() }; }
  createAnalyser() { return { ...node(), fftSize: 0, frequencyBinCount: 1024, smoothingTimeConstant: 0 }; }
  createChannelSplitter() { return node(); }
  createChannelMerger() { return node(); }
  createDelay() { return { ...node(), delayTime: param() }; }
  createPanner() { return { ...node(), positionX: param(), positionY: param(), positionZ: param() }; }
  createConvolver() { return node(); }
  createBuffer(channels, length) { const d = Array.from({ length: channels }, () => new Float32Array(length)); return { getChannelData: (c) => d[c] }; }
  createMediaElementSource() { return node(); }
  setSinkId(id) { this.sinkId = id; return Promise.resolve(); }
  close() { this.closed = true; return Promise.resolve(); }
  resume() { return Promise.resolve(); }
};
globalThis.Audio = class {
  constructor() { this.paused = true; this.h = {}; this.duration = 100; this.currentTime = 0; setTimeout(() => (this.h.loadedmetadata || []).forEach((f) => f()), 0); }
  addEventListener(t, f) { (this.h[t] = this.h[t] || []).push(f); }
  removeEventListener() {}
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute() {}
  load() {}
};
const { AudioEngine } = await import('../src/renderer/js/audio.js');

test('the engine starts at the system rate and can be rebuilt at a song\'s', async () => {
  const engine = new AudioEngine();
  assert.strictEqual(engine.rate, 48000);
  assert.strictEqual(engine.customRate, null);
  const first = engine.ctx;
  assert.strictEqual(await engine.setRate(96000), true);
  assert.strictEqual(engine.rate, 96000);
  assert.strictEqual(engine.customRate, 96000);
  assert.ok(first.closed, 'the old context is let go');
  assert.strictEqual(await engine.setRate(96000), true);
  assert.strictEqual(engine.ctx, made[made.length - 1], 'the same rate: nothing rebuilt');
  assert.strictEqual(await engine.setRate(null), true);
  assert.strictEqual(engine.rate, 48000);
  assert.strictEqual(engine.customRate, null);
});

test('volume, mono, EQ and the output device carry over to the new context', async () => {
  const engine = new AudioEngine();
  engine.setVolume(0.4);
  engine.setMono(true);
  engine.setEq([3, 0, 0, 0, 0, 0, 0, 0, 0, -2]);
  await engine.setOutput('headphones');
  await engine.setRate(44100);
  assert.strictEqual(engine.master.gain.value, 0.4);
  assert.strictEqual(engine.input.channelCount, 1);
  assert.strictEqual(engine.eq[0].gain.value, 3);
  assert.strictEqual(engine.eq[9].gain.value, -2);
  assert.strictEqual(engine.ctx.sinkId, 'headphones');
});

test('a rate change drops what was playing, crossfade included, and tells who listens', async () => {
  const engine = new AudioEngine();
  await engine.load('a.flac', { autoPlay: true });
  await engine.load('b.flac', { autoPlay: true, crossfadeSeconds: 5 });
  assert.ok(engine.crossfading);
  const seen = [];
  engine.onContextChange((ctx) => seen.push(ctx.sampleRate));
  await engine.setRate(96000);
  assert.strictEqual(engine.deck, null);
  assert.ok(!engine.crossfading);
  assert.deepStrictEqual(seen, [96000]);
});

test('a rate the browser refuses: false, the engine keeps its rate', async () => {
  const engine = new AudioEngine();
  assert.strictEqual(await engine.setRate(999), false);
  assert.strictEqual(engine.rate, 48000);
  assert.strictEqual(engine.ctx.closed, false);
});

test('spatial audio sits after the EQ, survives a rate change, and waits while mono is on', async () => {
  const engine = new AudioEngine();
  assert.strictEqual(engine.spatial.dry.gain.value, 1, 'off by default: straight through');
  engine.setSpatial(true, 0.8);
  assert.strictEqual(engine.spatial.dry.gain.value, 0);
  await engine.setRate(96000);
  assert.strictEqual(engine.spatial.dry.gain.value, 0, 'still on in the new context');
  assert.strictEqual(engine.spatialAmount, 0.8);
  engine.setMono(true);
  assert.strictEqual(engine.spatial.dry.gain.value, 1, 'mono: one channel would come from one speaker, so off');
  engine.setMono(false);
  assert.strictEqual(engine.spatial.dry.gain.value, 0);
});
