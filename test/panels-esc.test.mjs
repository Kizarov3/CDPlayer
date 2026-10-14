import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

// Esc closes the topmost panel (panels.js ESC_ORDER): a panel left out of the list can't be closed with Esc —
// worse, Esc then falls through and closes what's behind it (the shelf) with the panel still up.
test('every panel panels.js opens can be closed with Esc', () => {
  const src = fs.readFileSync('src/renderer/js/panels.js', 'utf8');
  const order = JSON.parse(/const ESC_ORDER = (\[[^\]]*\])/.exec(src)[1].replace(/'/g, '"'));
  const opened = [...new Set([...src.matchAll(/openPanel\('([\w-]+)'/g)].map((m) => m[1]))];
  assert.deepStrictEqual(opened.filter((name) => !order.includes(name)), []);
});
