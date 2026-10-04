'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createSoundCheckCache } = require('../src/main/soundcheck-cache');

const setup = (stats, text = null) => {
  const writes = [];
  const cache = createSoundCheckCache({ read: () => text, write: (s) => writes.push(JSON.parse(s)), stat: (f) => stats[f] || null, delayMs: 0 });
  return { cache, writes };
};

test('an entry is kept with its file\'s size and date, and dropped once the file changes', async () => {
  const stats = { '/a.flac': { size: 10, mtimeMs: 1000 } };
  const { cache, writes } = setup(stats);
  cache.put('/a.flac', { loudness: -12, peak: 0.9, duration: 200 });
  assert.deepStrictEqual(cache.get(['/a.flac', '/b.flac']), { '/a.flac': { loudness: -12, peak: 0.9, duration: 200 } });
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(writes.length, 1);
  assert.deepStrictEqual(writes[0].tracks['/a.flac'], { stamp: '10:1000', loudness: -12, peak: 0.9, duration: 200 });
  stats['/a.flac'] = { size: 11, mtimeMs: 2000 };
  assert.deepStrictEqual(cache.get(['/a.flac']), {});
});

test('a saved cache is read back, and a broken one is ignored', () => {
  const stats = { '/a.flac': { size: 10, mtimeMs: 1000 } };
  const saved = JSON.stringify({ version: 1, tracks: { '/a.flac': { stamp: '10:1000', loudness: -9, peak: 1, duration: 3 } } });
  assert.strictEqual(setup(stats, saved).cache.get(['/a.flac'])['/a.flac'].loudness, -9);
  assert.deepStrictEqual(setup(stats, '{nope').cache.get(['/a.flac']), {});
});

test('silence is stored as null loudness and read back as -Infinity', () => {
  const stats = { '/s.wav': { size: 1, mtimeMs: 1 } };
  const { cache } = setup(stats);
  cache.put('/s.wav', { loudness: -Infinity, peak: 0, duration: 5 });
  assert.strictEqual(cache.get(['/s.wav'])['/s.wav'].loudness, -Infinity);
});
