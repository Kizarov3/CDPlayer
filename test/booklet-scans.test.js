const test = require('node:test');
const assert = require('node:assert');
const { scanPicks, scanReleases, bestScans, MAX_PAGES } = require('../src/main/booklet-scans');

const img = (types, n) => ({ types, image: `full${n}`, thumbnails: { 1200: `big${n}`, 500: `mid${n}` } });

test('booklet pages in order, then the back and the tray; the cover and disc left out', () => {
  const picks = scanPicks([img(['Front'], 0), img(['Back'], 1), img(['Booklet'], 2), img(['Medium'], 3), img(['Booklet'], 4), img(['Tray'], 5), img(['Booklet', 'Front'], 6)]);
  assert.deepStrictEqual(picks, [{ url: 'big2', kind: 'booklet' }, { url: 'big4', kind: 'booklet' }, { url: 'big1', kind: 'back' }, { url: 'big5', kind: 'tray' }]);
});

test('unedited or watermarked scans skipped; the original when there is no 1200 copy', () => {
  const picks = scanPicks([img(['Booklet', 'Raw/Unedited'], 0), img(['Booklet', 'Watermark'], 1), { types: ['Booklet'], image: 'full', thumbnails: { 500: 'mid' } }]);
  assert.deepStrictEqual(picks, [{ url: 'full', kind: 'booklet' }]);
});

test('a long booklet is cut off; one back only', () => {
  const picks = scanPicks([...Array.from({ length: 40 }, (_, i) => img(['Booklet'], i)), img(['Back'], 50), img(['Back'], 51)]);
  assert.strictEqual(picks.filter((p) => p.kind === 'booklet').length, MAX_PAGES);
  assert.deepStrictEqual(picks.filter((p) => p.kind === 'back'), [{ url: 'big50', kind: 'back' }]);
});

test('the files’ own release first, then CDs with the most images; cover-only ones not asked', () => {
  const cd = (id, count) => ({ id, media: [{ format: 'CD' }], 'cover-art-archive': { count } });
  const vinyl = (id, count) => ({ id, media: [{ format: '12" Vinyl' }], 'cover-art-archive': { count } });
  assert.deepStrictEqual(scanReleases([vinyl('v', 30), cd('a', 3), cd('b', 12), cd('c', 1), cd('own', 0)], 'own'), ['own', 'b', 'a', 'v']);
});

test('the files’ own release when it has booklet pages, else the one showing the most', () => {
  const page = { kind: 'booklet', url: 'p' }, back = { kind: 'back', url: 'b' };
  assert.deepStrictEqual(bestScans([{ id: 'own', picks: [page] }, { id: 'x', picks: [page, page, back] }], 'own'), [page]);
  assert.deepStrictEqual(bestScans([{ id: 'own', picks: [back] }, { id: 'x', picks: [page, page] }, { id: 'y', picks: [page, page] }], 'own').length, 2);
  assert.deepStrictEqual(bestScans([{ id: 'x', picks: [] }]), []);
});
