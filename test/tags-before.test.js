'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { remember, original, parse } = require('../src/main/tags-before');

test('the first value of each field is kept through later changes', () => {
  let r = remember({}, '/a.mp3', { title: 'trk 1', album: null, year: null }, { title: 'One', album: 'X' }, 10);
  r = remember(r, '/a.mp3', { title: 'One', album: 'X', year: null }, { title: 'Uno', year: '1999' }, 20);
  assert.deepStrictEqual(r['/a.mp3'], { at: 10, tags: { title: 'trk 1', album: null, year: null } });
});

test('a cover is not kept; a field the file has no idea of is not either', () => {
  assert.deepStrictEqual(remember({}, '/a.mp3', { title: 'x' }, { cover: 'data:…', nonsense: 1 }), {});
});

test('putting back: only what differs from the file now', () => {
  const r = { '/a.mp3': { at: 10, tags: { title: 'trk 1', album: null } } };
  assert.deepStrictEqual(original(r, '/a.mp3', { title: 'One', album: null }), { at: 10, changes: { title: 'trk 1' } });
  assert.strictEqual(original(r, '/a.mp3', { title: 'trk 1', album: '' }), null, 'already as it was');
  assert.strictEqual(original(r, '/b.mp3', {}), null);
});

test('a broken file reads as nothing kept', () => {
  assert.deepStrictEqual(parse('{'), {});
  assert.deepStrictEqual(parse('[1]'), {});
});
