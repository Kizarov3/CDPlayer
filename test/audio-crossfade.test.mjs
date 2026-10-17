import test from 'node:test';
import assert from 'node:assert';

// Just enough Web Audio for AudioEngine; decks are made by hand below, so their elements are fakes too.
const param = () => ({ value: 1, setTargetAtTime() {}, cancelScheduledValues() {}, setValueCurveAtTime() {} });
const node = () => ({ connect() {}, disconnect() {}, gain: param() });
globalThis.AudioContext = class {
  constructor() { this.currentTime = 0; this.state = 'running'; this.destination = node(); this.sampleRate = 44100; }
  createGain() { return node(); }
  createWaveShaper() { return { connect() {}, disconnect() {}, curve: null }; }
  createBiquadFilter() { return { ...node(), type: '', frequency: param(), Q: param() }; }
  createAnalyser() { return { ...node(), fftSize: 0, frequencyBinCount: 1024, smoothingTimeConstant: 0 }; }
  createChannelSplitter() { return node(); }
  createChannelMerger() { return node(); }
  createDelay() { return { ...node(), delayTime: param() }; }
  createPanner() { return { ...node(), positionX: param(), positionY: param(), positionZ: param() }; }
  createConvolver() { return node(); }
  createBuffer(channels, length) { const d = Array.from({ length: channels }, () => new Float32Array(length)); return { getChannelData: (c) => d[c] }; }
  resume() { return Promise.resolve(); }
};
const { AudioEngine } = await import('../src/renderer/js/audio.js');

// A file deck whose metadata arrives only when told (`ready()`), playing until disposed.
function engineWithFakeDecks() {
  const engine = new AudioEngine();
  const made = [];
  engine.createDeck = (url) => {
    const h = {};
    const el = { paused: true, currentTime: 0, duration: 200, addEventListener: (t, f) => { (h[t] = h[t] || []).push(f); }, removeEventListener: (t, f) => { h[t] = (h[t] || []).filter((x) => x !== f); },
      play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; }, removeAttribute() {}, load() {} };
    const deck = { el, source: node(), trim: null, gain: node(), url, start: 0, end: null, endFired: false, disposed: false, ready: () => (h.loadedmetadata || []).forEach((f) => f()) };
    made.push(deck);
    return deck;
  };
  const dispose = engine.disposeDeck.bind(engine);
  engine.disposeDeck = (deck) => { if (deck) deck.disposed = true; dispose(deck); };
  return { engine, made };
}

test('a new track while a crossfade waits for the next one\'s length: the old track stops, it doesn\'t play on unstoppable', async () => {
  const { engine, made } = engineWithFakeDecks();
  const first = engine.load('a.flac'); made[0].ready(); await first; // A playing
  const fading = engine.load('b.flac', { crossfadeSeconds: 6 });     // crossfade to B: waiting for B's length
  const jump = engine.load('c.flac');                                // the user picks C meanwhile
  made[1].ready(); made[2].ready();
  await Promise.all([fading, jump]);
  assert.strictEqual(made[0].disposed, true, 'A, the track fading out, is gone');
  assert.strictEqual(made[1].disposed, true, 'B too');
  assert.strictEqual(engine.deck, made[2]);
});

test('stop() during that wait stops the old track too', async () => {
  const { engine, made } = engineWithFakeDecks();
  const first = engine.load('a.flac'); made[0].ready(); await first;
  const fading = engine.load('b.flac', { crossfadeSeconds: 6 });
  engine.stop();
  made[1].ready(); await fading;
  assert.strictEqual(made[0].disposed, true);
});
