import test from 'node:test';
import assert from 'node:assert';

// AUTOMIX in the playback engine (audio.js), edge cases beyond audio-element-deck.test.mjs: arming with nothing on
// standby, a rebuild (setRate) or pause mid-mix, a crossfade over a mix, and seams whose next song starts late.

// Just enough Web Audio (as in audio-element-deck.test.mjs), with every file routed, contexts that remember their rate
// and whether they were closed, and a rate (999) the "browser" refuses.
const param = () => ({ value: 1, setTargetAtTime() {}, cancelScheduledValues() {}, setValueCurveAtTime() {}, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
const node = () => ({ connect() {}, disconnect() {}, gain: param() });
const contexts = [];
globalThis.AudioContext = class {
  constructor(opts = {}) {
    if (opts.sampleRate === 999) throw new Error('NotSupportedError');
    this.currentTime = 0; this.state = 'running'; this.destination = node(); this.sampleRate = opts.sampleRate || 44100; this.closed = false;
    this.shapers = [];
    contexts.push(this);
  }
  createGain() { return node(); }
  createWaveShaper() { const s = { connect() {}, disconnect() {}, curve: null }; this.shapers.push(s); return s; }
  createBiquadFilter() { return { ...node(), type: '', frequency: param(), Q: param() }; }
  createAnalyser() { return { ...node(), fftSize: 0, frequencyBinCount: 1024, smoothingTimeConstant: 0 }; }
  createChannelSplitter() { return node(); }
  createChannelMerger() { return node(); }
  createDelay() { return { ...node(), delayTime: param() }; }
  createPanner() { return { ...node(), positionX: param(), positionY: param(), positionZ: param() }; }
  createConvolver() { return node(); }
  createBuffer(channels, length) { const d = Array.from({ length: channels }, () => new Float32Array(length)); return { getChannelData: (c) => d[c] }; }
  createMediaElementSource() { return { connect() {}, disconnect() {} }; }
  close() { this.closed = true; return Promise.resolve(); }
  resume() { return Promise.resolve(); }
};

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
globalThis.Audio = class extends FakeElement {};

const { AudioEngine, SEAM_LEAD, SEAM_BLEND } = await import('../src/renderer/js/audio.js');
const routedEngine = () => new AudioEngine();
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const timedCurves = (deck) => { const got = []; deck.gain.gain.setValueCurveAtTime = (c, at, len) => got.push({ c: Array.from(c), at, len }); return got; };
const url = (k) => `cdp://app/media?p=${k}`;
// A playing song `a`, `b` on standby; armed with `plan` unless it's null.
async function standing(plan = { at: 190, overlap: 5, fadeIn: 3, fadeOut: true }) {
  const engine = routedEngine();
  await engine.load(url('a'), { autoPlay: true });
  await engine.prepare(url('b'));
  if (plan) engine.armMix(plan);
  return engine;
}
// …and the mix under way: a fading out, b playing.
async function mixing(plan) {
  const engine = await standing(plan);
  const a = engine.deck, b = engine.standby;
  a.el.currentTime = engine.mix.at;
  engine.watchSeam(); await tick(20);
  assert.strictEqual(engine.deck, b); assert.strictEqual(engine.fadingOut, a);
  return { engine, a, b };
}
// The standby's play() held until release() — a next song that's slow to start.
function holdPlay(deck) {
  let release;
  deck.el.play = function () { return new Promise((r) => { release = () => { this.paused = false; r(); }; }); };
  return () => release();
}

test('armMix with nothing on standby is a no-op: a standby prepared afterwards seams at the end', async () => {
  const engine = routedEngine();
  await engine.load(url('a'), { autoPlay: true });
  engine.armMix({ at: 150, overlap: 5, fadeIn: 3, fadeOut: true });
  assert.strictEqual(engine.mix, null);
  assert.strictEqual(engine.seamLeft(), engine.timeLeft(), 'the seam is still the end');
  await engine.prepare(url('b'));
  assert.strictEqual(engine.mix, null);
  engine.deck.el.currentTime = 150;
  engine.watchSeam(); await tick(20);
  assert.strictEqual(engine.deck.url, url('a'), 'no mix at the plan\'s moment');
  // and after stop, arming is still a no-op
  engine.stop();
  engine.armMix({ at: 1, overlap: 1, fadeIn: 1, fadeOut: true });
  assert.strictEqual(engine.mix, null);
});

test('armMix, cancelPrepared, then a new standby without armMix: a gapless seam at the end, not a mix', async () => {
  const engine = await standing({ at: 150, overlap: 5, fadeIn: 3, fadeOut: true });
  engine.cancelPrepared();
  assert.strictEqual(engine.mix, null);
  await engine.prepare(url('c'));
  const a = engine.deck, c = engine.standby, outC = timedCurves(a), inC = timedCurves(c);
  a.el.currentTime = 150;
  engine.watchSeam(); await tick(20);
  assert.strictEqual(c.el.paused, true, 'nothing at the old plan\'s moment');
  a.el.currentTime = a.el.duration - SEAM_LEAD / 2;
  engine.watchSeam(); await tick(20);
  assert.strictEqual(engine.deck, c);
  assert.strictEqual(outC.length, 1); assert.strictEqual(outC[0].len, SEAM_BLEND, 'a seam\'s blend, not an overlap');
  assert.strictEqual(inC[0].len, SEAM_BLEND);
  assert.ok(!engine.crossfading); assert.strictEqual(engine.guard.curve, null, 'no guard for a seam');
  await tick(80);
  assert.ok(a.el.paused);
});

test('a mix with no overlap (overlap 0) seams gaplessly at its moment, without the guard', async () => {
  const engine = await standing({ at: 194, overlap: 0, fadeIn: 0, fadeOut: false });
  const a = engine.deck, b = engine.standby, outC = timedCurves(a);
  a.el.currentTime = 194 - SEAM_LEAD / 2;
  engine.watchSeam(); await tick(20);
  assert.strictEqual(engine.deck, b, 'at the end of its sound, not of its file');
  assert.strictEqual(outC[0].len, SEAM_BLEND);
  assert.ok(!engine.crossfading); assert.strictEqual(engine.guard.curve, null);
});

test('setRate mid-mix: nothing left fading, the guard off in the old graph and the new, no late callbacks', async () => {
  const { engine, a, b } = await mixing({ at: 190, overlap: 0.2, fadeIn: 0.1, fadeOut: true });
  assert.ok(engine.guard.curve, 'guarding during the mix');
  const oldCtx = engine.ctx, oldGuard = engine.guard;
  let done = 0;
  engine.onCrossfadeDone = () => done++;
  assert.strictEqual(await engine.setRate(48000), true);
  assert.notStrictEqual(engine.ctx, oldCtx); assert.strictEqual(engine.rate, 48000);
  assert.ok(oldCtx.closed);
  assert.strictEqual(engine.fadingOut, null); assert.ok(!engine.crossfading);
  assert.strictEqual(engine.deck, null); assert.strictEqual(engine.standby, null); assert.strictEqual(engine.mix, null);
  assert.ok(a.el.paused && b.el.paused, 'both songs let go');
  assert.strictEqual(engine.guarding, false);
  assert.strictEqual(oldGuard.curve, null);
  assert.notStrictEqual(engine.guard, oldGuard);
  assert.strictEqual(engine.guard.curve, null, 'the new graph starts unguarded');
  await tick(300);
  assert.strictEqual(done, 0, 'the old mix\'s timer is gone');
  assert.strictEqual(engine.guard.curve, null);
  // the new graph mixes (and guards) as the old one did
  await engine.load(url('c'), { autoPlay: true });
  await engine.prepare(url('d'));
  engine.armMix({ at: 190, overlap: 0.1, fadeIn: 0.1, fadeOut: true });
  engine.deck.el.currentTime = 190;
  engine.watchSeam(); await tick(20);
  assert.ok(engine.guard.curve instanceof Float32Array, 'guarding the new mix');
  assert.strictEqual(oldGuard.curve, null, 'not the old graph\'s guard');
  await tick(200);
  assert.strictEqual(engine.guard.curve, null);
});

test('setRate to a rate the browser refuses, mid-mix: it stays at its rate, the mix stopped and the guard off', async () => {
  const { engine, a } = await mixing({ at: 190, overlap: 5, fadeIn: 3, fadeOut: true });
  const ctx = engine.ctx, guard = engine.guard;
  assert.strictEqual(await engine.setRate(999), false);
  assert.strictEqual(engine.ctx, ctx); assert.strictEqual(engine.guard, guard);
  assert.ok(!ctx.closed);
  assert.strictEqual(guard.curve, null); assert.strictEqual(engine.guarding, false);
  assert.ok(!engine.crossfading); assert.ok(a.el.paused);
});

test('pause mid-mix, then play: only the incoming song plays on, at full level, unguarded', async () => {
  const { engine, a, b } = await mixing({ at: 190, overlap: 5, fadeIn: 3, fadeOut: true });
  let done = 0;
  engine.onCrossfadeDone = () => done++;
  engine.pause();
  assert.ok(a.el.paused && b.el.paused);
  assert.ok(!engine.crossfading); assert.strictEqual(engine.guard.curve, null);
  await engine.play();
  assert.strictEqual(engine.deck, b);
  assert.strictEqual(b.el.paused, false, 'the incoming plays');
  assert.strictEqual(a.el.paused, true, 'the outgoing stays let go of');
  assert.ok(a.el.loads >= 1, 'and disposed');
  assert.strictEqual(b.gain.gain.value, 1);
  assert.ok(!engine.crossfading); assert.strictEqual(engine.guard.curve, null);
  await tick(60);
  assert.strictEqual(done, 0);
});

test('a crossfade load during a mix\'s overlap: the mix\'s old song goes at once, the mix\'s new one fades into the loaded one', async () => {
  const { engine, a, b } = await mixing({ at: 190, overlap: 0.3, fadeIn: 0.2, fadeOut: true });
  let done = 0;
  engine.onCrossfadeDone = () => done++;
  const bCurves = timedCurves(b);
  await engine.load(url('c'), { autoPlay: true, crossfadeSeconds: 0.1 });
  const c = engine.deck;
  assert.strictEqual(c.url, url('c'));
  assert.ok(a.el.paused && a.el.loads >= 1, 'the mix\'s outgoing is gone');
  assert.strictEqual(engine.fadingOut, b, 'the mix\'s incoming is now the one fading');
  assert.strictEqual(b.el.paused, false);
  assert.strictEqual(bCurves.length, 1); assert.strictEqual(bCurves[0].len, 0.1);
  assert.ok(bCurves[0].c[0] > 0.99 && bCurves[0].c.at(-1) < 0.01, 'b falls over the crossfade');
  assert.ok(engine.guard.curve, 'guarding the crossfade');
  assert.strictEqual(c.el.paused, false);
  await tick(400); // past both the crossfade and what would have been the mix's end
  assert.strictEqual(done, 1, 'only the crossfade reports done');
  assert.ok(!engine.crossfading); assert.ok(b.el.paused);
  assert.strictEqual(engine.guard.curve, null);
  assert.strictEqual(engine.deck, c); assert.strictEqual(c.el.paused, false);
});

test('a seam whose next song starts after another song was put on: the late one goes, no advance, no mix, no guard', async () => {
  const engine = await standing({ at: 190, overlap: 5, fadeIn: 3, fadeOut: true });
  const a = engine.deck, b = engine.standby, release = holdPlay(b);
  const advanced = [], ended = [];
  engine.onAdvance = (d) => advanced.push(d);
  engine.onEnded = (d) => ended.push(d);
  a.el.currentTime = 190;
  engine.watchSeam(); await tick(5);
  assert.strictEqual(engine.deck, a, 'still starting');
  await engine.load(url('c'), { autoPlay: true });
  const c = engine.deck;
  release(); await tick(10);
  assert.strictEqual(engine.deck, c);
  assert.ok(b.el.paused && b.el.loads >= 1, 'the late starter is let go');
  assert.ok(a.el.paused);
  assert.deepStrictEqual(advanced, []); assert.deepStrictEqual(ended, []);
  assert.ok(!engine.crossfading); assert.strictEqual(engine.guard.curve, null);
  assert.strictEqual(c.el.paused, false); assert.strictEqual(c.gain.gain.value, 1);
});

test('…and if that other song was put on with a crossfade, the crossfade carries on untouched', async () => {
  const engine = await standing({ at: 190, overlap: 5, fadeIn: 3, fadeOut: true });
  const a = engine.deck, b = engine.standby, release = holdPlay(b);
  a.el.currentTime = 190;
  engine.watchSeam(); await tick(5);
  await engine.load(url('c'), { autoPlay: true, crossfadeSeconds: 0.2 });
  const c = engine.deck;
  assert.strictEqual(engine.fadingOut, a);
  release(); await tick(10);
  assert.strictEqual(engine.deck, c);
  assert.strictEqual(engine.fadingOut, a, 'still fading a into c');
  assert.ok(engine.guard.curve, 'guarded for the crossfade');
  assert.ok(b.el.paused);
  await tick(300);
  assert.ok(!engine.crossfading); assert.strictEqual(engine.guard.curve, null);
});

test('a seam whose next song starts after setRate: the late one goes, and the new graph stays unguarded', async () => {
  const engine = await standing({ at: 190, overlap: 5, fadeIn: 3, fadeOut: true });
  const a = engine.deck, b = engine.standby, release = holdPlay(b);
  const advanced = [];
  engine.onAdvance = (d) => advanced.push(d);
  a.el.currentTime = 190;
  engine.watchSeam(); await tick(5);
  assert.strictEqual(await engine.setRate(96000), true);
  release(); await tick(10);
  assert.strictEqual(engine.deck, null);
  assert.ok(a.el.paused && b.el.paused);
  assert.deepStrictEqual(advanced, []);
  assert.strictEqual(engine.guard.curve, null); assert.strictEqual(engine.guarding, false);
  assert.ok(!engine.crossfading);
});

// BUG: seam() checks that the playing song isn't paused only before it awaits the next one's play(). A PAUSE in the
// ~10 ms while the next song starts is then overridden: the mix starts anyway (the paused song "fading out", the guard
// on) and the next song plays on although the player was paused — engine.playing is true after a pause().
test('a pause while the next song is starting wins: nothing plays on afterwards', async () => {
  const engine = await standing({ at: 190, overlap: 5, fadeIn: 3, fadeOut: true });
  const a = engine.deck, b = engine.standby, release = holdPlay(b);
  a.el.currentTime = 190;
  engine.watchSeam(); await tick(5);
  engine.pause();
  release(); await tick(10);
  assert.strictEqual(engine.playing, false, 'paused means paused');
  assert.ok(b.el.paused);
  assert.ok(!engine.crossfading); assert.strictEqual(engine.guard.curve, null);
});
