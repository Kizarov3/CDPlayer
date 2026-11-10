import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { THEMES, isLight, shown, contrast, fromFile, setColors } from '../src/renderer/js/theme.js';

// setColors / applyColors touch the page's style and the frame clock: stand-ins that never run a frame.
globalThis.document = { documentElement: { style: { setProperty() {} } } };
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

const byName = (n) => THEMES.find((x) => x.name === n);

test('isLight: a light background is, a dark one is not', () => {
  assert.strictEqual(isLight([251, 251, 252]), true);
  assert.strictEqual(isLight([17, 17, 19]), false);
});

test('WHITE is the only light built-in theme, and sits right before AUTO', () => {
  for (const t of THEMES.filter((x) => x.name !== 'WHITE')) assert.strictEqual(isLight(t.bg), false, t.name);
  assert.strictEqual(THEMES.at(-2).name, 'WHITE');
  assert.strictEqual(THEMES.at(-1).name, 'AUTO');
});

test('WHITE text and muted read at 4.5:1 on its background and its cards', () => {
  const w = byName('WHITE');
  for (const k of ['text', 'muted']) for (const on of ['bg', 'card']) assert.ok(contrast(w[k], w[on]) >= 4.5, `${k} on ${on}: ${contrast(w[k], w[on])}`);
});

test('a theme of your own with a light background is light', () => {
  const t = fromFile({ name: 'PAPER', colors: { bg: [240, 236, 228], card: [250, 248, 244], accent: [200, 60, 40], accent2: [120, 120, 120], text: [30, 30, 30], muted: [100, 100, 100] } });
  assert.strictEqual(isLight(t.bg), true);
});

test('shown.light follows setColors at once, before any frame, animated or not', () => {
  setColors(byName('WHITE'), true);
  assert.strictEqual(shown.light, true);
  setColors(byName('RED'), true);
  assert.strictEqual(shown.light, false);
  setColors(byName('WHITE'), false);
  assert.strictEqual(shown.light, true);
});

// main decides at startup whether the window opens light (startup-theme.js, CommonJS): its rule and its WHITE must be theme.js's.
const require = createRequire(import.meta.url);
const startup = require('../src/main/startup-theme.js');

test('main’s light rule agrees with theme.js’s isLight on every colour (a grid, and the greys round the threshold)', () => {
  const samples = [];
  for (let r = 0; r <= 255; r += 5) for (let g = 0; g <= 255; g += 5) for (let b = 0; b <= 255; b += 5) samples.push([r, g, b]);
  for (let v = 170; v <= 200; v++) samples.push([v, v, v], [v, v + 3, v - 3].map((x) => Math.max(0, Math.min(255, x))));
  let light = 0;
  for (const c of samples) { assert.strictEqual(startup.isLight(c), isLight(c), c.join(',')); if (isLight(c)) light++; }
  assert.ok(light > 0 && light < samples.length);
});

test('main’s WHITE is THEMES’ WHITE (its copy of the palette has not drifted)', () => {
  const w = byName('WHITE');
  assert.deepStrictEqual(startup.WHITE, Object.fromEntries(startup.KEYS.map((k) => [k, w[k]])));
});

// first-paint.js run as the page runs it, with what preload hands it (the --cdp-light= value, or null)
const firstPaint = (startsLight) => {
  const set = {}, classes = [];
  const root = { classList: { add: (c) => classes.push(c) }, style: { setProperty: (k, v) => { set[k] = v; } } };
  runInNewContext(readFileSync(new URL('../src/renderer/js/first-paint.js', import.meta.url), 'utf8'), { window: { cdp: { startsLight } }, document: { documentElement: root } });
  return { set, classes };
};
const asVars = (p) => Object.fromEntries(['bg', 'card', 'accent', 'accent2', 'text', 'muted'].map((k) => [`--${k}`, p[k].join(', ')]));

test('first frame of a saved WHITE: exactly THEMES’ WHITE, from what main passes', () => {
  const { set, classes } = firstPaint(startup.paletteArg(startup.lightPalette('WHITE', [])));
  assert.deepStrictEqual(classes, ['light']);
  assert.deepStrictEqual(set, asVars(byName('WHITE')));
});

test('first frame of a light theme of your own: light, in its own colours', () => {
  const paper = { name: 'PAPER', colors: { bg: [240, 236, 228], card: [250, 248, 244], accent: [200, 60, 40], accent2: [120, 120, 120], text: [30, 30, 30], muted: [100, 100, 100] } };
  const { set, classes } = firstPaint(startup.paletteArg(startup.lightPalette('PAPER', [paper])));
  assert.deepStrictEqual(classes, ['light']);
  assert.deepStrictEqual(set, asVars(paper.colors));
});

test('first frame of a dark theme, or of a garbled value: nothing touched', () => {
  for (const v of [null, undefined, '', '1,2,3', '1,2,3;4,5,6;7,8,9;1,2,3;4,5,6;7,8,999', 'a;b;c;d;e;f']) {
    assert.deepStrictEqual(firstPaint(v), { set: {}, classes: [] }, String(v));
  }
});
