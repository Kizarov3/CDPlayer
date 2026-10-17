'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createAutomixCache } = require('../src/main/automix-cache');

const setup = (stats, text = null) => {
  const writes = [];
  const cache = createAutomixCache({ read: () => text, write: (s) => writes.push(JSON.parse(s)), stat: (f) => stats[f] || null, delayMs: 0 });
  return { cache, writes };
};
const edges = { start: 0.25, end: 201.5, fadeStart: 195.1234, introRise: 1, duration: 203 };

test("a song's edges are kept with its file's size and date, and dropped once the file changes", async () => {
  const stats = { '/a.flac': { size: 10, mtimeMs: 1000 } };
  const { cache, writes } = setup(stats);
  cache.put('/a.flac', edges);
  assert.deepStrictEqual(cache.get(['/a.flac', '/b.flac']), { '/a.flac': { ...edges, fadeStart: 195.123 } });
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(writes.length, 1);
  assert.strictEqual(writes[0].tracks['/a.flac'].stamp, '10:1000');
  stats['/a.flac'] = { size: 11, mtimeMs: 2000 };
  assert.deepStrictEqual(cache.get(['/a.flac']), {});
});

test('a silent song is remembered as null; a broken cache is ignored', () => {
  const stats = { '/s.wav': { size: 1, mtimeMs: 1 } };
  const { cache } = setup(stats);
  cache.put('/s.wav', null);
  assert.deepStrictEqual(cache.get(['/s.wav']), { '/s.wav': null });
  assert.deepStrictEqual(setup(stats, '{nope').cache.get(['/s.wav']), {});
});
