'use strict';
// How much of the words the model hears where it put them: too little and there's no such voice in the file.
const test = require('node:test');
const assert = require('node:assert');
const { heardLevel } = require('../src/main/karaoke/fit-words');

test('heardLevel: each sound at its best moment in its span, the middle one of those', () => {
  const classes = 2, frames = 4, quiet = Math.log(0.01), loud = Math.log(0.9), near = (x, y) => assert.ok(Math.abs(x - y) < 1e-6, `${x} ≠ ${y}`);
  const song = new Float32Array([quiet, quiet, loud, quiet, quiet, quiet, quiet, quiet]);
  // (sound 0 is class 0, loud in frame 1; sound 1 is class 1, quiet everywhere)
  near(heardLevel(song, classes, frames, [0, 0, 1], [{ first: 0, last: 1 }, { first: 1, last: 1 }, { first: 2, last: 3 }]), 0.9);
  near(heardLevel(song, classes, frames, [1, 1, 0], [{ first: 0, last: 3 }, { first: 2, last: 3 }, { first: 0, last: 1 }]), 0.01);
  assert.strictEqual(heardLevel(song, classes, frames, [], []), 0);
  near(heardLevel(song, classes, frames, [0], [{ first: 1, last: 99 }]), 0.9); // (a span past the end stops at it)
});
