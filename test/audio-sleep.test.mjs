import test from 'node:test';
import assert from 'node:assert';

// Just enough Web Audio for AudioEngine, with the graph's input and the context's suspend() watched.
const param = () => ({ value: 1, setTargetAtTime() {}, cancelScheduledValues() {}, setValueCurveAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
const node = () => {
  const n = { outs: new Set(), gain: param() };
  n.connect = (to) => { n.outs.add(to); return to; };
  n.disconnect = (to) => { if (to) n.outs.delete(to); else n.outs.clear(); };
  return n;
};
let suspends = 0;
globalThis.AudioContext = class {
  constructor() { this.currentTime = 0; this.state = 'running'; this.destination = node(); this.sampleRate = 44100; }
  createGain() { return node(); }
  createWaveShaper() { return { ...node(), curve: null }; }
  createBiquadFilter() { return { ...node(), type: '', frequency: param(), Q: param() }; }
  createAnalyser() { return { ...node(), fftSize: 0, frequencyBinCount: 1024, smoothingTimeConstant: 0 }; }
  createChannelSplitter() { return node(); }
  createChannelMerger() { return node(); }
  createDelay() { return { ...node(), delayTime: param() }; }
  createPanner() { return { ...node(), positionX: param(), positionY: param(), positionZ: param() }; }
  createConvolver() { return node(); }
  createBuffer(channels, length) { const d = Array.from({ length: channels }, () => new Float32Array(length)); return { getChannelData: (c) => d[c] }; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { suspends++; this.state = 'suspended'; return Promise.resolve(); }
};
const { AudioEngine } = await import('../src/renderer/js/audio.js');

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test('paused a while, the processing is cut off but the output keeps running (a stopped output lets the speakers doze off, and the song comes back late)', async () => {
  const engine = new AudioEngine();
  const el = { paused: false };
  engine.deck = { el };
  assert.ok(engine.input.outs.has(engine.eq[0]));
  el.paused = true;
  engine.sleepSoon(1);
  await tick();
  assert.strictEqual(suspends, 0, 'the context is never suspended');
  assert.strictEqual(engine.ctx.state, 'running');
  assert.ok(!engine.input.outs.has(engine.eq[0]), 'the EQ, spatial audio and meters get nothing to work through');
  engine.wake();
  assert.ok(engine.input.outs.has(engine.eq[0]), 'woken, the songs go through them again');
  engine.wake();
  assert.strictEqual(engine.input.outs.size, 1);
});

test('still sounding when the timer fires: nothing is cut off', async () => {
  const engine = new AudioEngine();
  engine.deck = { el: { paused: false } };
  engine.sleepSoon(1);
  await tick();
  assert.ok(engine.input.outs.has(engine.eq[0]));
});

test('play() connects the processing again before the song starts', async () => {
  const engine = new AudioEngine();
  let connectedAtPlay = null;
  const el = { paused: true, play: async () => { connectedAtPlay = engine.input.outs.has(engine.eq[0]); el.paused = false; }, pause() { el.paused = true; } };
  engine.deck = { el };
  engine.sleepSoon(1);
  await tick();
  await engine.play();
  assert.strictEqual(connectedAtPlay, true);
});
