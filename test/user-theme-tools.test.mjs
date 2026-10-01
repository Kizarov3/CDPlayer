import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import {
  THEMES, BUILTIN_COUNT, SCENES, sceneOf, sceneModes, visualizerModeFor, particleModeFor, contrast, hex, fromHex,
  fromFile, toFile, setUserThemes, draftFrom, startFrom,
} from '../src/renderer/js/theme.js';

const require = createRequire(import.meta.url);
const main = require('../src/main/user-themes.js');

const file = { cdtheme: 1, name: 'VAPOR', scene: 'OCEAN', image: null, blur: 0, dim: 30,
  colors: { bg: [10, 0, 20], card: [20, 10, 30], accent: [255, 0, 170], accent2: [0, 220, 255], text: [250, 240, 255], muted: [150, 140, 170] } };

test('the built-in themes and scenes are the ones the main process knows', () => {
  assert.deepStrictEqual(THEMES.slice(0, BUILTIN_COUNT).map((t) => t.name), main.BUILTIN);
  assert.deepStrictEqual(SCENES, main.SCENES);
});

test('every scene: its visualizer and what falls behind the player', () => {
  assert.deepStrictEqual(SCENES.map(sceneModes), [
    { visualizer: 'BARS', particles: 'NONE' }, { visualizer: 'TREE', particles: 'SNOW' },
    { visualizer: 'CONSTELLATION', particles: 'GALAXY' }, { visualizer: 'WAVES', particles: 'OCEAN' },
    { visualizer: 'MATRIX_RAIN', particles: 'MATRIX' }, { visualizer: 'LEAVES', particles: 'AUTUMN' },
  ]);
});

test('built-in themes keep their scenes; a theme of your own has the one you picked', () => {
  const byName = (n) => THEMES.find((t) => t.name === n);
  assert.deepStrictEqual(['RED', 'SNOW', 'AUTO', 'OCEAN'].map((n) => sceneOf(byName(n))), ['BARS', 'SNOW', 'BARS', 'OCEAN']);
  assert.strictEqual(visualizerModeFor({ name: 'SNOW 2', scene: 'MATRIX' }), 'MATRIX_RAIN');
  assert.strictEqual(particleModeFor({ name: 'MINE', scene: 'BARS' }), 'NONE');
});

test('contrast, as WCAG measures it', () => {
  assert.strictEqual(Math.round(contrast([0, 0, 0], [255, 255, 255])), 21);
  assert.strictEqual(contrast([90, 90, 90], [90, 90, 90]), 1);
  assert.ok(contrast([138, 142, 148], [17, 17, 19]) >= 4.5);
});

test('hex there and back', () => {
  assert.strictEqual(hex([255, 0, 170]), '#ff00aa');
  assert.deepStrictEqual(fromHex('#FF00AA'), [255, 0, 170]);
});

test('a file theme and the list theme are the same theme', () => {
  const t = fromFile(file);
  assert.strictEqual(t.user, true);
  assert.deepStrictEqual(t.accent, [255, 0, 170]);
  assert.deepStrictEqual(toFile(t), file);
});

test('your themes come after the built-in ones, and replace the last lot', () => {
  setUserThemes([file, { ...file, name: 'ACID' }]);
  assert.deepStrictEqual(THEMES.slice(BUILTIN_COUNT).map((t) => t.name), ['VAPOR', 'ACID']);
  setUserThemes([]);
  assert.strictEqual(THEMES.length, BUILTIN_COUNT);
});

test('a draft is a copy to change freely; START FROM takes colors and scene, not the image or name', () => {
  const base = fromFile({ ...file, image: 'data:image/jpeg;base64,AAAA', blur: 5 });
  const d = draftFrom(base, 'MY THEME');
  d.bg[0] = 99;
  assert.strictEqual(base.bg[0], 10);
  assert.deepStrictEqual([d.name, d.image, d.blur, d.scene, d.user], ['MY THEME', base.image, 5, 'OCEAN', true]);
  startFrom(d, THEMES.find((t) => t.name === 'SNOW'));
  assert.deepStrictEqual([d.name, d.image, d.scene, d.accent], ['MY THEME', base.image, 'SNOW', [214, 44, 54]]);
  startFrom(d, THEMES[0], { keepScene: true });
  assert.strictEqual(d.scene, 'SNOW');
});
