// BLIP keeps the window smooth on any machine (a virtual machine without a graphics card too): how often it draws and
// what a drawing costs are counted, not timed.
import test from 'node:test';
import assert from 'node:assert';

const classes = () => { const s = new Set(); return { add: (c) => s.add(c), remove: (c) => s.delete(c), toggle: (c, on) => (on ? s.add(c) : s.delete(c)), contains: (c) => s.has(c) }; };
const listeners = {};
Object.assign(globalThis, {
  document: { body: { classList: classes() } },
  window: { addEventListener: (k, f) => { listeners[k] = f; } },
  matchMedia: () => ({ matches: false }),
  devicePixelRatio: 2,
});
const { createPetView } = await import('../src/renderer/js/pet-view.js');
const { drawDots, frame } = await import('../src/renderer/js/pet-sprite.js');

// a canvas that counts: drawings (clearRect), fills, shadow blurs, resizes (setting width clears and reallocates it)
function fakeCanvas() {
  const n = { draws: 0, fills: 0, blurs: 0, resizes: 0, rects: 0 };
  let w = 0;
  const ctx = new Proxy({}, {
    get: (_, k) => (k === 'clearRect' ? () => n.draws++ : k === 'fill' ? () => n.fills++ : () => {}),
    set: (_, k, v) => { if (k === 'shadowBlur' && v > 0) n.blurs++; return true; },
  });
  const canvas = {
    n, style: {}, height: 0, offsetParent: {}, addEventListener: () => {},
    get width() { return w; }, set width(v) { n.resizes++; w = v; },
    getContext: () => ctx, getBoundingClientRect: () => { n.rects++; return { left: 0, width: 60 }; },
  };
  return canvas;
}
const view = { name: 'BLIP', form: 'kid', stage: 'kid', item: null, temper: 'curious', favourite: null, lastPlay: Date.now() };
async function petOn(canvas = fakeCanvas()) {
  const say = { textContent: '', animate: () => {} }, display = { classList: classes() };
  const pv = createPetView({ canvas, say, display, pet: { on: async () => ({ view, events: [] }), get: async () => view, set: async () => view }, openCard: () => {} });
  await pv.setOn(true);
  return { pv, canvas };
}
// ten seconds of the window's frames at 60 a second
function run(pv, opts, seconds = 10, start = 1e6) {
  for (let i = 0; i < seconds * 60; i++) pv.tick(start + i * (1000 / 60), opts);
}

test('off: nothing drawn, nothing asked, however long the window runs', async () => {
  const canvas = fakeCanvas();
  const pv = createPetView({ canvas, say: {}, display: { classList: classes() }, pet: { on: async () => null }, openCard: () => {} });
  run(pv, { playing: true, level: () => { throw new Error('the music asked for while off'); } });
  assert.strictEqual(canvas.n.draws, 0);
});

test('paused: about two drawings a second, not sixty', async () => {
  const { pv, canvas } = await petOn();
  run(pv, { playing: false });
  assert.ok(canvas.n.draws <= 25, `${canvas.n.draws} drawings in 10 s`);
});

test('playing, the loudness changing every frame: drawn at its own pace (about 5 a second), not on every frame', async () => {
  const { pv, canvas } = await petOn();
  let k = 0;
  run(pv, { playing: true, track: '/a.flac', level: () => 0.3 + 0.3 * Math.abs(Math.sin(k++ / 3)) });
  assert.ok(canvas.n.draws <= 55, `${canvas.n.draws} drawings in 10 s`);
});

test('out of sight (CD VIEW, a narrow window): not drawn at all', async () => {
  const canvas = fakeCanvas(); canvas.offsetParent = null;
  const { pv } = await petOn(canvas);
  run(pv, { playing: true, level: () => 0.5 });
  assert.strictEqual(canvas.n.draws, 0);
});

test('the cursor moving: where it is on the window is looked up a few times a second, not on every mouse move', async () => {
  const { canvas } = await petOn();
  const before = canvas.n.rects;
  for (let i = 0; i < 200; i++) listeners.mousemove({ clientX: i * 5 });
  assert.ok(canvas.n.rects - before <= 3, `${canvas.n.rects - before} lookups for 200 moves`);
});

test('TERMINAL asks for it every frame: worked out again only when it moves', async () => {
  const { pv } = await petOn();
  pv.tick(1e6, { playing: false });
  assert.strictEqual(pv.rows(), pv.rows());
});

test('a drawing: a few fills and blurs for the whole creature, however many dots; the canvas resized only when its size changes', () => {
  const canvas = fakeCanvas(), g = frame(0, { pose: 'paused', form: 'collector', item: 'crown' });
  drawDots(canvas, g, { pitch: 2.6 });
  const resized = canvas.n.resizes; canvas.n.fills = 0; canvas.n.blurs = 0;
  drawDots(canvas, frame(1, { pose: 'paused', form: 'collector', item: 'crown' }), { pitch: 2.6 });
  assert.ok(canvas.n.fills <= 3, `${canvas.n.fills} fills`);
  assert.ok(canvas.n.blurs <= 1, `${canvas.n.blurs} blurs`);
  assert.strictEqual(canvas.n.resizes, resized);
});
