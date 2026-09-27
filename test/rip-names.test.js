'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { safeName, albumFolder, trackFiles } = require('../src/main/rip-names');

test('names safe on every system', () => {
  assert.strictEqual(safeName('AC/DC: Live? <1991> "Best" | *'), 'AC_DC_ Live_ _1991_ _Best_ _ _');
  assert.strictEqual(safeName('Trailing dots... '), 'Trailing dots');
  assert.strictEqual(safeName('CON'), '_CON');
  assert.strictEqual(safeName('com1'), '_com1');
  assert.strictEqual(safeName('tab\there'), 'tab_here');
  assert.strictEqual(safeName('x'.repeat(300)).length, 120);
  assert.strictEqual(safeName('///'), '___');
  assert.strictEqual(safeName('   '), '_');
});

test('the album folder: artist / album (year), or Unknown Artist for a disc MusicBrainz doesn\'t know', () => {
  assert.strictEqual(albumFolder('/m', { albumArtist: 'Limp Bizkit', album: 'Three Dollar Bill, Yall$', year: '1997' }), path.join('/m', 'Limp Bizkit', 'Three Dollar Bill, Yall$ (1997)'));
  assert.strictEqual(albumFolder('/m', { albumArtist: 'Radiohead', album: 'OK Computer', year: null }), path.join('/m', 'Radiohead', 'OK Computer'));
  assert.strictEqual(albumFolder('/m', { album: null, discId: '6u6SZ6TRjV_O9VDaKMAucGeZEOY-' }), path.join('/m', 'Unknown Artist', 'Audio CD (6u6SZ6TR)'));
});

test('track files: numbered, a double album\'s disc first, same titles kept apart', () => {
  assert.deepStrictEqual(trackFiles([{ number: 1, title: 'Intro' }, { number: 2, title: 'Pollution' }]), ['01 Intro.flac', '02 Pollution.flac']);
  assert.deepStrictEqual(trackFiles([{ number: 5, title: 'A', disc: 2, discs: 2 }]), ['2-05 A.flac']);
  assert.deepStrictEqual(trackFiles([{ number: 1, title: null }, { number: 2, title: '' }]), ['01 Track 1.flac', '02 Track 2.flac']);
  const same = trackFiles([{ number: 1, title: 'Interlude' }, { number: 1, title: 'Interlude' }]);
  assert.strictEqual(new Set(same).size, 2);
});
