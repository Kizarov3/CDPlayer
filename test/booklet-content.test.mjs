import test from 'node:test';
import assert from 'node:assert';
import { albumCredits, albumSummary, albumSmallPrint, sameAlbum } from '../src/renderer/js/booklet-content.js';

const song = (credits, extra = {}) => ({ title: 'x', artist: 'Limp Bizkit', duration: 200, quality: 'AAC · 256 KBPS', credits, ...extra });

test('an album\'s credits: what most of its songs say, one row each, empty ones left out', () => {
  const rows = albumCredits([
    song({ released: '1997-07-01', genre: 'Nu Metal', label: 'Flip', producer: 'Ross Robinson' }),
    song({ released: '1997-07-01', genre: 'Rock', label: 'Flip' }),
    song({ released: '1997', genre: 'Nu Metal', catalog: 'INTD-90124' }),
  ]);
  assert.deepStrictEqual(rows, [
    ['PRODUCED BY', 'Ross Robinson'], ['RELEASED', '1997-07-01'], ['GENRE', 'Nu Metal'], ['LABEL', 'Flip'], ['CATALOG NO.', 'INTD-90124'],
  ]);
  assert.deepStrictEqual(albumCredits([song({}), song(undefined)]), []);
});

test('this album: tracks, length, format (or "Mixed"), and every play of its songs', () => {
  const details = [song({}, { duration: 48 }), song({}, { duration: 232 }), null];
  assert.deepStrictEqual(albumSummary({ details, plays: [3, 0, 2], discs: 1 }), [
    ['TRACKS', '3'], ['LENGTH', '4:40'], ['FORMAT', 'AAC · 256 KBPS'], ['PLAYED', '5 times'],
  ]);
  const mixed = [song({}, { quality: 'FLAC · 16-BIT · 44.1 KHZ' }), song({}, { quality: 'MP3 · 320 KBPS' })];
  assert.deepStrictEqual(albumSummary({ details: mixed, plays: [1, 0], discs: 2 }), [
    ['TRACKS', '2'], ['DISCS', '2'], ['LENGTH', '6:40'], ['FORMAT', 'Mixed'], ['PLAYED', '1 time'],
  ]);
  assert.deepStrictEqual(albumSummary({ details: [song({}, { duration: 3725 })], plays: [0], discs: 1 })[1], ['LENGTH', '62:05']);
});

test('the back cover\'s small print comes from whichever song has it', () => {
  assert.deepStrictEqual(albumSmallPrint([song({}), song({ copyright: '1997 Flip/Interscope', barcode: '606949012421', label: 'Flip', catalog: 'INTD-90124' })]),
    { copyright: '1997 Flip/Interscope', barcode: '606949012421', label: 'Flip', catalog: 'INTD-90124' });
  assert.deepStrictEqual(albumSmallPrint([song({}), null]), { copyright: null, barcode: null, label: null, catalog: null });
});

test('one codec at varying bitrates is that codec at their average, not "Mixed"', () => {
  const at = (quality) => song({}, { quality });
  const format = (qs) => albumSummary({ details: qs.map(at), plays: [], discs: 1 }).find(([k]) => k === 'FORMAT')[1];
  assert.strictEqual(format(['AAC · 277 KBPS', 'AAC · 273 KBPS', 'AAC · 262 KBPS']), 'AAC · 271 KBPS');
  assert.strictEqual(format(['FLAC · 24-BIT · 96 KHZ', 'FLAC · 16-BIT · 44.1 KHZ']), 'FLAC');
  assert.strictEqual(format(['FLAC · 16-BIT · 44.1 KHZ', 'FLAC · 16-BIT · 44.1 KHZ']), 'FLAC · 16-BIT · 44.1 KHZ');
  assert.strictEqual(format(['AAC · 256 KBPS', 'MP3 · 320 KBPS']), 'Mixed');
});

test('the same album whatever its punctuation or capitals, as on the shelf', () => {
  assert.ok(sameAlbum("Three Dollar Bill, Yall$", "Three Dollar Bill Y'All$"));
  assert.ok(sameAlbum('OK Computer', 'ok computer'));
  assert.ok(!sameAlbum('OK Computer', 'OK Computer OKNOTOK 1997 2017'));
  assert.ok(!sameAlbum('Kid A', null));
});
