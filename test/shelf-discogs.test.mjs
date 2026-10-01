import test from 'node:test';
import assert from 'node:assert';
import { pressingLine, marketLine, money, priceBand, isRare, shelfTotal } from '../src/renderer/js/shelf-discogs.js';
import { arrange, SORTS } from '../src/renderer/js/shelf-order.js';

const entry = (lowest, extra = {}) => ({ releaseId: 1, info: { label: 'Parlophone', catno: '7243 5 27753 2 4', country: 'UK', year: '2000', formats: 'CD, Album', have: 21304, want: 3112 }, price: { lowest, currency: 'USD', forSale: 34 }, ...extra });

test('the pressing and its market, in a line each', () => {
  assert.strictEqual(pressingLine(entry(12).info), 'Parlophone · 7243 5 27753 2 4 · UK · 2000 · CD, Album');
  assert.strictEqual(pressingLine({ label: null, catno: null, country: 'UK', year: null, formats: null }), 'UK');
  assert.strictEqual(marketLine(entry(12)), 'from $12 · 34 for sale · 21,304 have · 3,112 want');
  assert.strictEqual(marketLine(entry(null, { price: { lowest: null, currency: 'USD', forSale: 0 } })), 'not for sale · 21,304 have · 3,112 want');
});

test('money: whole amounts from 10 up, cents below', () => {
  assert.deepStrictEqual([money(12.5, 'USD'), money(4.5, 'USD'), money(1240, 'USD'), money(25.86, 'EUR'), money(3000, 'JPY')], ['$13', '$4.50', '$1,240', '€26', '¥3,000']);
});

test('price bands, scaled for yen', () => {
  assert.deepStrictEqual([60, 30, 12, 4, null].map((v) => priceBand(v, 'USD')), ['$50+', '$20–$50', '$10–$20', 'UNDER $10', 'NO PRICE']);
  assert.strictEqual(priceBand(9000, 'JPY'), '¥7,500+');
});

test('rare: dear, or wanted by more than have it', () => {
  assert.strictEqual(isRare(entry(40)), true);
  assert.strictEqual(isRare(entry(12)), false);
  assert.strictEqual(isRare(entry(12, { info: { have: 20, want: 30 } })), true);
  assert.strictEqual(isRare(entry(12, { info: { have: 5, want: 30 } })), false);
  assert.strictEqual(isRare(entry(5000, { price: { lowest: 5000, currency: 'JPY', forSale: 1 } })), false);
  assert.strictEqual(isRare(null), false);
});

test('the shelf\'s total, only in one currency', () => {
  assert.deepStrictEqual(shelfTotal([entry(10), entry(2.5), entry(null), { releaseId: null }, entry(5, { price: { lowest: 5, currency: 'EUR', forSale: 1 } })], 'USD'), { value: 12.5, count: 2 });
});

test('SORT: PRICE — dearest first, in bands', () => {
  assert.ok(SORTS.includes('PRICE'));
  const a = (title, lowest) => ({ title, artist: 'X', pressing: lowest === undefined ? undefined : entry(lowest) });
  const out = arrange([a('A', 5), a('B', 60), a('C'), a('D', 25)], 'PRICE');
  assert.deepStrictEqual(out.map((x) => x.divider || x.title), ['$50+', 'B', '$20–$50', 'D', 'UNDER $10', 'A', 'NO PRICE', 'C']);
});
