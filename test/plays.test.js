'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { recordPlay } = require('../src/main/plays');

test('a play counts, and is the last; the first play is only noted when it really is the first', () => {
  const plays = { counts: new Map(), last: new Map(), first: new Map() };
  assert.strictEqual(recordPlay(plays, '/a', 100), 1);
  assert.strictEqual(plays.first.get('/a'), 100);
  assert.strictEqual(recordPlay(plays, '/a', 200), 2);
  assert.strictEqual(plays.first.get('/a'), 100, 'the first stays the first');
  assert.strictEqual(plays.last.get('/a'), 200);
});

test('a song played before first plays were noted gets no made-up first date', () => {
  const plays = { counts: new Map([['/old', 47]]), last: new Map([['/old', 50]]), first: new Map() };
  assert.strictEqual(recordPlay(plays, '/old', 900), 48);
  assert.strictEqual(plays.first.has('/old'), false);
  assert.strictEqual(plays.last.get('/old'), 900);
});

test('the most recently played come last, so the oldest are the ones dropped', () => {
  const plays = { counts: new Map([['/a', 1], ['/b', 1]]), last: new Map([['/a', 1], ['/b', 2]]), first: new Map() };
  recordPlay(plays, '/a', 3);
  assert.deepStrictEqual([...plays.counts.keys()], ['/b', '/a']);
  assert.deepStrictEqual([...plays.last.keys()], ['/b', '/a']);
});
