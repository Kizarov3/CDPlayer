import test from 'node:test';
import assert from 'node:assert';
import { receiptFor } from '../src/renderer/js/shelf-receipt.js';
import { stickersFor } from '../src/renderer/js/shelf-stickers.js';

const added = new Date(2024, 2, 12, 9, 30).getTime(); // 12 March 2024, local time
const albums = Array.from({ length: 200 }, (_, i) => ({ artist: `Artist ${i}`, title: `Album ${i}`, added }));

test('the same album always has the same receipt', () => {
  for (const a of albums.slice(0, 20)) assert.deepStrictEqual(receiptFor({ ...a }, stickersFor(a)), receiptFor(a, stickersFor(a)));
});

test('bought the day the album turned up in the music folder, in shop hours', () => {
  for (const a of albums.slice(0, 50)) {
    const r = receiptFor(a, stickersFor(a));
    assert.ok(r.date.includes('2024') && r.date.includes('03') && r.date.includes('12'), r.date);
    const [h] = r.time.split(':').map(Number);
    assert.ok(h >= 10 && h <= 21, r.time);
  }
});

test('the price is the one on the case, or else a likely one — yen for a Japanese edition', () => {
  let fallbacks = 0;
  for (const a of albums) {
    const st = stickersFor(a), r = receiptFor(a, st);
    if (st.price) assert.strictEqual(r.price, st.price);
    else {
      fallbacks++;
      assert.match(r.price, st.obi ? /^¥\d,\d{3}$/ : /^\$\d{1,2}\.99$/);
    }
    assert.strictEqual(r.total, r.price);
    assert.match(r.item, new RegExp(`^${a.artist} — ${a.title}$`));
  }
  assert.ok(fallbacks > 0, 'some cases have no price sticker');
});

test('a shop, a way of paying, a receipt number and a barcode; the shops vary', () => {
  const shops = new Set();
  for (const a of albums) {
    const r = receiptFor(a, stickersFor(a));
    shops.add(r.shop);
    assert.ok(r.address);
    assert.match(r.paid, /^(CASH|CARD \*{4}\d{4})$/);
    assert.match(r.number, /^\d{4}-\d{6}$/);
    assert.match(r.barcode, /^\d{12}$/);
  }
  assert.ok(shops.size >= 4, `${shops.size} shops`);
});

test('no date it turned up, no receipt', () => {
  assert.strictEqual(receiptFor({ ...albums[0], added: null }, stickersFor(albums[0])), null);
});
