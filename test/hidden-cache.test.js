'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createHiddenCache } = require('../src/main/hidden-cache');

const setup = (stats, text = null) => {
  const writes = [];
  const cache = createHiddenCache({ read: () => text, write: (s) => writes.push(JSON.parse(s)), stat: (f) => stats[f] || null, delayMs: 0 });
  return { cache, writes };
};
const entry = { songEnd: 231.9, hiddenStart: 829.5, name: null, asked: false, found: false };

test('an entry is kept with its file\'s size and date, and unknown again once the file changes', async () => {
  const stats = { '/a.flac': { size: 10, mtimeMs: 1000 } };
  const { cache, writes } = setup(stats);
  assert.strictEqual(cache.get('/a.flac'), undefined);
  cache.put('/a.flac', entry);
  assert.deepStrictEqual(cache.get('/a.flac'), entry);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepStrictEqual(writes.at(-1), { version: 1, tracks: { '/a.flac': { stamp: '10:1000', ...entry } } });
  stats['/a.flac'] = { size: 11, mtimeMs: 2000 };
  assert.strictEqual(cache.get('/a.flac'), undefined);
});

test('"checked, nothing there" is kept as null', () => {
  const { cache } = setup({ '/b.flac': { size: 1, mtimeMs: 1 } });
  cache.put('/b.flac', null);
  assert.strictEqual(cache.get('/b.flac'), null);
});

test('found and the name are merged into the entry', () => {
  const { cache } = setup({ '/a.flac': { size: 10, mtimeMs: 1000 } });
  cache.put('/a.flac', entry);
  cache.update('/a.flac', { found: true });
  cache.update('/a.flac', { name: 'Endless, Nameless', asked: true });
  assert.deepStrictEqual(cache.get('/a.flac'), { ...entry, found: true, name: 'Endless, Nameless', asked: true });
  cache.update('/missing.flac', { found: true }); // nothing to merge into: ignored
  assert.strictEqual(cache.get('/missing.flac'), undefined);
});

test('a saved cache is read back, and a broken one is ignored', () => {
  const stats = { '/a.flac': { size: 10, mtimeMs: 1000 }, '/b.flac': { size: 1, mtimeMs: 1 } };
  const saved = JSON.stringify({ version: 1, tracks: { '/a.flac': { stamp: '10:1000', ...entry }, '/b.flac': { stamp: '1:1', none: true } } });
  const { cache } = setup(stats, saved);
  assert.deepStrictEqual(cache.get('/a.flac'), entry);
  assert.strictEqual(cache.get('/b.flac'), null);
  assert.strictEqual(setup(stats, '{nope').cache.get('/a.flac'), undefined);
});
