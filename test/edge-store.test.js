'use strict';
// test/edge-store.test.js — dividers.txt and skipped.txt with odd text
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-edge-store-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const store = require('../src/main/store');

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('nothing saved yet: no dividers, no songs passed over', () => {
  assert.deepStrictEqual(store.readDividers(), new Map());
  assert.deepStrictEqual(store.readSkipped(), new Set());
});

test('dividers.txt: tabs, newlines, quotes, backslashes and any alphabet in an id or a name come back as they were', () => {
  const dividers = new Map([
    ['tool\nlateralus\n', 'For the "car"\tnorth'],
    ['a\tb\\c\n"q"\n', 'Лето — ёлка ✨'],
    ['björk\nhomogenic\n', 'two\nlines\r\nand\u2028more'],
    ['日本\n歌\n', 'עברית'],
  ]);
  store.writeDividers(dividers);
  assert.deepStrictEqual(store.readDividers(), dividers);
  const text = fs.readFileSync(path.join(home, 'dividers.txt'), 'utf8');
  assert.strictEqual(text.split('\n').filter(Boolean).length, dividers.size, 'a line each');
  assert.strictEqual(fs.existsSync(path.join(home, 'notes.txt')), false, 'its own file, not the notes');
});

test('dividers.txt: an empty name is none; broken lines and Windows line ends are read past', () => {
  store.writeDividers(new Map([['x\n', ''], ['y\n', 'Y']]));
  assert.deepStrictEqual(store.readDividers(), new Map([['y\n', 'Y']]));
  fs.writeFileSync(path.join(home, 'dividers.txt'), '"a"\t"A"\r\nnot json\n"b"\t""\n\t"no id"\n"c"\t"C"\n');
  assert.deepStrictEqual(store.readDividers(), new Map([['a', 'A'], ['c', 'C']]));
  store.writeDividers(new Map([['only\n', '']]));
  assert.strictEqual(fs.readFileSync(path.join(home, 'dividers.txt'), 'utf8'), '');
  assert.deepStrictEqual(store.readDividers(), new Map());
});

test('skipped.txt: paths with tabs, quotes, spaces at their ends, backslashes and any alphabet come back as they were', () => {
  const paths = new Set(['/music/a\tb.flac', '/music/"quoted" song.mp3', ' /music/ends with space.mp3 ', 'C:\\Music\\Björk\\01 Hunter.flac', '/music/日本/歌.m4a', '/music/🎸.ogg']);
  store.writeSkipped(paths);
  assert.deepStrictEqual(store.readSkipped(), paths);
});

test('skipped.txt: a path with a line break in it can\'t be kept, the others are; blank ones are none', () => {
  store.writeSkipped(new Set(['/ok.mp3', '/bad\nname.mp3', '/bad\rname.mp3', '', '   ']));
  assert.deepStrictEqual(store.readSkipped(), new Set(['/ok.mp3']));
  store.writeSkipped([]);
  assert.deepStrictEqual(store.readSkipped(), new Set());
  fs.writeFileSync(path.join(home, 'skipped.txt'), '/a.mp3\r\n/b.mp3\r\n');
  assert.deepStrictEqual(store.readSkipped(), new Set(['/a.mp3', '/b.mp3']), 'Windows line ends');
});
