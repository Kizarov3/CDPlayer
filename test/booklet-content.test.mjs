import test from 'node:test';
import assert from 'node:assert';
import { albumCredits, albumSummary, albumSmallPrint, sameAlbum, ownerMarks } from '../src/renderer/js/booklet-content.js';

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

const DAY = 86400000, NOW = new Date(2026, 8, 29, 18, 0).getTime();

test('tally marks in the margin: bundles of five, then just ×N past twenty', () => {
  const m = (n) => ownerMarks({ plays: [n], first: [null], last: [null], now: NOW }).tallies[0];
  assert.strictEqual(m(0), null);
  assert.deepStrictEqual(m(1), { fives: 0, ones: 1 });
  assert.deepStrictEqual(m(5), { fives: 1, ones: 0 });
  assert.deepStrictEqual(m(20), { fives: 4, ones: 0 });
  assert.deepStrictEqual(m(47), { times: '×47' });
});

test('the favourite: the most played song, three plays or more, the first of a tie', () => {
  const fav = (plays) => ownerMarks({ plays, first: plays.map(() => null), last: plays.map(() => null), now: NOW }).favorite;
  assert.strictEqual(fav([1, 2, 2]), -1);
  assert.strictEqual(fav([3, 9, 4]), 1);
  assert.strictEqual(fav([5, 2, 5]), 0);
  assert.strictEqual(fav([]), -1);
});

test('the first spin and the last, in words', () => {
  const notes = (first, last) => ownerMarks({ plays: first.map(() => 1), first, last, now: NOW }).notes;
  const march = new Date(2024, 2, 12, 20, 0).getTime();
  assert.deepStrictEqual(notes([march, march + 5 * DAY], [NOW - 2 * 3600000, NOW - 3 * DAY]), ['1st spin: 12 Mar 2024', 'last: today']);
  assert.deepStrictEqual(notes([null], [NOW - 30 * 3600000]), ['last: yesterday']);
  assert.deepStrictEqual(notes([null], [NOW - 3 * DAY]), ['last: 3 days ago']);
  assert.deepStrictEqual(notes([null], [NOW - 70 * DAY]), ['last: 2 months ago']);
  assert.deepStrictEqual(notes([null], [NOW - 800 * DAY]), ['last: 2 years ago']);
  assert.deepStrictEqual(notes([null], [null]), []);
});
