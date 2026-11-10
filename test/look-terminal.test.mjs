// test/look-terminal.test.mjs — TERMINAL's canvas across a theme change: it draws only the cells that changed, so a
// change of theme (its colours, or light ↔ dark) must start it over — the whole canvas in the new paper, every cell again.
import test from 'node:test';
import assert from 'node:assert';

// (a canvas that only writes down what's drawn on it)
function fakeCanvas() {
  const calls = [];
  const ctx = {
    calls, fillStyle: '', font: '', textBaseline: '', globalAlpha: 1,
    fillRect(x, y, w, h) { calls.push({ op: 'fillRect', style: this.fillStyle, x, y, w, h }); },
    fillText(ch) { calls.push({ op: 'fillText', style: this.fillStyle, ch }); },
    measureText: () => ({ width: 8 }), save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, setTransform() {},
  };
  return { width: 0, height: 0, clientWidth: 80, clientHeight: 37, style: {}, addEventListener() {}, getContext: () => ctx, ctx };
}
globalThis.window = { devicePixelRatio: 1 };
globalThis.document = { createElement: () => fakeCanvas() };

const { colors, shown, THEMES } = await import('../src/renderer/js/theme.js');
const { TerminalLook } = await import('../src/renderer/js/look-terminal.js');

const RED = THEMES.find((t) => t.name === 'RED'), WHITE = THEMES.find((t) => t.name === 'WHITE');
const KEYS = ['bg', 'card', 'accent', 'accent2', 'text', 'muted'];
const showTheme = (t, light = t === WHITE) => { for (const k of KEYS) colors[k] = [...t[k]]; shown.light = light; };

function setUp() {
  const canvas = fakeCanvas();
  const look = new TerminalLook(canvas, { model: () => ({}), act() {}, discFace: () => null, discTurn: () => 0 });
  look.measure();
  const cells = [[{ ch: 'C', color: 'accent' }, { ch: 'D', color: 'text' }, null], [{ ch: '─', color: 'muted' }, { ch: 'x', color: [200, 180, 40] }, { ch: ' ', color: 'text' }]];
  return { canvas, look, grid: { rows: 2, cols: 3, cells } };
}
const fullFill = (canvas) => canvas.ctx.calls.find((c) => c.op === 'fillRect' && c.x === 0 && c.y === 0 && c.w === canvas.width && c.h === canvas.height);
const drawnText = (canvas) => canvas.ctx.calls.filter((c) => c.op === 'fillText').map((c) => c.ch);

test('TERMINAL: RED → WHITE → RED repaints the whole canvas in the new paper, every cell again', () => {
  const { canvas, look, grid } = setUp();
  showTheme(RED);
  look.paint(grid);
  assert.strictEqual(fullFill(canvas).style, 'rgb(17,17,19)');
  canvas.ctx.calls.length = 0;
  look.paint(grid);
  assert.deepStrictEqual(canvas.ctx.calls, [], 'nothing changed: nothing drawn');

  showTheme(WHITE);
  look.paint(grid);
  assert.strictEqual(fullFill(canvas).style, 'rgb(251,251,252)', 'the light paper over all of it');
  assert.deepStrictEqual(drawnText(canvas), ['C', 'D', 'x'], 'every character drawn again on it');
  assert.ok(canvas.ctx.calls.some((c) => c.op === 'fillText' && c.style === 'rgb(224,68,46)'), "in WHITE's accent");

  canvas.ctx.calls.length = 0;
  showTheme(RED);
  look.paint(grid);
  assert.strictEqual(fullFill(canvas).style, 'rgb(17,17,19)', 'and back to the dark paper');
  assert.deepStrictEqual(drawnText(canvas), ['C', 'D', 'x']);
});

test('TERMINAL: every step of the colour fade, and light changing alone, start it over', () => {
  const { canvas, look, grid } = setUp();
  showTheme(RED);
  look.paint(grid);
  for (const f of [0.25, 0.5, 1]) { // (theme.js's fade: the colours eased from one theme to the other)
    canvas.ctx.calls.length = 0;
    for (const k of KEYS) colors[k] = RED[k].map((v, i) => Math.round(v + (WHITE[k][i] - v) * f));
    shown.light = true;
    look.paint(grid);
    assert.strictEqual(fullFill(canvas).style, `rgb(${colors.bg.join(',')})`, `at ${f}`);
    assert.deepStrictEqual(drawnText(canvas), ['C', 'D', 'x'], `at ${f}`);
  }
  canvas.ctx.calls.length = 0;
  shown.light = false; // (the same colours, the disc's characters drawn for the other paper)
  look.paint(grid);
  assert.ok(fullFill(canvas));
  showTheme(RED);
});
