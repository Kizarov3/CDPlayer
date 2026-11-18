'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { shorterTitles, bareAlbum } = require('../src/main/online');

test("an edition named past the album's title is cut back a word at a time, longest first", () => {
  assert.deepStrictEqual(shorterTitles('OK Computer OKNOTOK 1997 2017'), ['OK Computer OKNOTOK 1997', 'OK Computer OKNOTOK', 'OK Computer', 'OK']);
  assert.deepStrictEqual(shorterTitles(bareAlbum('Kid A Mnesia (Deluxe Edition)')), ['Kid A', 'Kid']);
  assert.deepStrictEqual(shorterTitles('Toxicity'), []);
  assert.deepStrictEqual(shorterTitles(''), []);
});
