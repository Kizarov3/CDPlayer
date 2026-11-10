import test from 'node:test';
import assert from 'node:assert';
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
