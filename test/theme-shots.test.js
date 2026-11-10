'use strict';
// test/theme-shots.test.js — the pure parts of the theme screenshots tool
const test = require('node:test');
const assert = require('node:assert');
const { darkCheck, diffShare } = require('../src/main/theme-shots');

const grey = (n, v) => new Uint8Array(n).fill(v);

test('darkCheck: all black is dark', () => {
  assert.deepStrictEqual(darkCheck(grey(100, 0), 10, 10), { dark: true, darkShare: 1, mean: 0 });
});
test('darkCheck: all #fbfbfc is not dark', () => {
  const r = darkCheck(grey(100, 0xfb), 10, 10);
  assert.strictEqual(r.dark, false);
  assert.strictEqual(r.darkShare, 0);
});
test('darkCheck: half black, half white is not dark', () => {
  const g = new Uint8Array(100); g.fill(255, 50);
  const r = darkCheck(g, 10, 10);
  assert.strictEqual(r.dark, false);
  assert.strictEqual(r.darkShare, 0.5);
});
test('darkCheck: a wide picture is looked at downscaled', () => {
  const r = darkCheck(grey(400 * 2, 0), 400, 2);
  assert.strictEqual(r.dark, true);
});

test('diffShare: identical buffers differ nowhere', () => {
  const a = Buffer.alloc(16, 7);
  assert.strictEqual(diffShare(a, Buffer.from(a)), 0);
});
test('diffShare: one pixel of four changed by 20 is 0.25', () => {
  const a = Buffer.alloc(16, 100), b = Buffer.from(a);
  b[5] += 20;
  assert.strictEqual(diffShare(a, b), 0.25);
});
test('diffShare: a change of 5 is not counted', () => {
  const a = Buffer.alloc(16, 100), b = Buffer.from(a);
  b[5] += 5;
  assert.strictEqual(diffShare(a, b), 0);
});
