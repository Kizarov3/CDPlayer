// The receipt tucked in behind a case's cover: the shop the album was "bought" at, on the day it turned up in the
// music folder, for the price on its sticker. The shops are made up; which one, the time, the way it was paid and the
// numbers all come from the album's name, so a receipt reads the same every time.
import { hash, random } from './disc-wear.js';

const SHOPS = [
  { shop: 'SPINDLE RECORDS', address: '214 4TH ST · EAST VILLAGE' },
  { shop: 'B-SIDE MUSIC', address: '88 MARKET SQ · UNIT 3' },
  { shop: 'DISC DEPOT', address: '1450 RIVERSIDE MALL · LEVEL 2' },
  { shop: 'NEEDLE & LASER', address: '9 CANAL WAY' },
  { shop: 'THE LISTENING BOOTH', address: '31 HIGH STREET' },
  { shop: 'SECOND SPIN', address: '702 ELM AVE · OPEN LATE' },
];
const SHOPS_JP = [
  { shop: 'OTOYA RECORDS 音屋', address: 'KOENJI 3-12-5 · TOKYO' },
  { shop: 'NAMIKI DISC', address: 'SHIMOKITAZAWA 2-8 · TOKYO' },
  { shop: 'SORA SOUND ソラ', address: 'NAMBA 1-4 · OSAKA' },
];
const YEN = [2300, 2427, 2548, 2621, 2800, 3000, 3146];
const pad = (n, w = 2) => String(n).padStart(w, '0');

/**
 * An album ({ artist, title, added }) and its stickers (shelf-stickers.js) → its receipt: { shop, address, date, time,
 * item, price, total, paid, number, barcode } — or null when the day it turned up isn't known.
 */
export function receiptFor(album, stickers) {
  if (!album.added) return null;
  const rnd = random(hash(`receipt\n${album.artist || ''}\n${album.title || ''}`));
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const japanese = !!stickers.obi;
  const { shop, address } = pick(japanese ? SHOPS_JP : SHOPS);
  const d = new Date(album.added);
  const date = japanese ? `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}` : `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
  const time = `${pad(10 + Math.floor(rnd() * 12))}:${pad(Math.floor(rnd() * 60))}`;
  let price = stickers.price;
  if (!price) {
    const yen = pick(YEN);
    price = japanese ? `¥${Math.floor(yen / 1000)},${pad(yen % 1000, 3)}` : `$${9 + Math.floor(rnd() * 10)}.99`;
  }
  const paid = rnd() < 0.45 ? 'CASH' : `CARD ****${pad(Math.floor(rnd() * 10000), 4)}`;
  const number = `${pad(Math.floor(rnd() * 10000), 4)}-${pad(Math.floor(rnd() * 1e6), 6)}`;
  const barcode = Array.from({ length: 12 }, () => Math.floor(rnd() * 10)).join('');
  return { shop, address, date, time, item: `${album.artist || 'Unknown Artist'} — ${album.title}`, price, total: price, paid, number, barcode };
}
