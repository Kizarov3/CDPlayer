import test from 'node:test';
import assert from 'node:assert';
import { deriveAutoTheme } from '../src/renderer/js/theme.js';

// A cover of `size`×`size` pixels painted by `paint(x, y)` → [r, g, b], handed to deriveAutoTheme through a stand-in
// for the canvas it reads the pixels from.
function cover(size, paint) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data.set([...paint(x, y), 255], (y * size + x) * 4);
  globalThis.OffscreenCanvas = class { getContext() { return { drawImage() {}, getImageData: () => ({ data }) }; } };
  return { width: size, height: size };
}
const hueOf = ([r, g, b]) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const h = r === max ? (g - b) / (max - min) : g === max ? 2 + (b - r) / (max - min) : 4 + (r - g) / (max - min);
  return (h * 60 + 360) % 360;
};

test('the accent is the colour most of the cover is, not the one a sparse sample happens to land on', () => {
  // In Rainbows at the size the player gets it (1024 px): rows of lettering in one colour, at a spacing that can line
  // up with the pixels sampled. Here: an orange cover with a thin blue line every 21 px (and every 31 px at 1500).
  for (const [size, every] of [[1024, 21], [1500, 31]]) {
    const theme = deriveAutoTheme(cover(size, (x, y) => (y % every === 0 ? [40, 110, 220] : [230, 110, 30])));
    const hue = hueOf(theme.accent);
    assert.ok(hue < 60, `${size} px: accent hue ${Math.round(hue)}° is not orange`);
  }
});

test('a cover that is mostly one colour gives that colour', () => {
  const blue = deriveAutoTheme(cover(600, (x, y) => (x < 540 ? [30, 90, 200] : [220, 40, 40])));
  const h = hueOf(blue.accent);
  assert.ok(h > 190 && h < 240, `accent hue ${Math.round(h)}°`);
});
