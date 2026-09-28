// What's stuck on a case on the shelf, the way a real collection is bought from different shops: about a third of the
// albums are Japanese editions, with an obi (the paper strip round the spine) and a yen price; some others still wear
// a dollar price sticker; and an album that turned up in the music folder lately has a NEW sticker. Which albums, their
// catalog numbers and prices all come from the album's name, so they're the same every time the shelf opens.

export const NEW_DAYS = 14;
const DAY = 86400000;
const LABELS = ['TOCP', 'SRCS', 'ESCA', 'VICP', 'UICY', 'WPCR', 'POCP', 'AMCY', 'BVCP', 'PCCY'];
const YEN = [2300, 2345, 2427, 2500, 2548, 2621, 2800, 2854, 3000, 3059, 3146, 3300];
const DOLLARS = [9, 10, 11, 12, 12, 13, 13, 14, 15, 16, 17, 18];

// FNV-1a: a spread-out number from a name, the same in every run.
function hash(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

/** An album ({ artist, title, added }) → { obi: { catalog } | null, price: '¥2,548' | '$12.99' | null, isNew }. */
export function stickersFor(album, now = Date.now()) {
  const h = hash(`${album.artist || ''}\n${album.title || ''}`);
  const pick = (list, shift) => list[(h >>> shift) % list.length];
  const isNew = !!album.added && now - album.added < NEW_DAYS * DAY;
  if (h % 3 === 0) {
    const yen = pick(YEN, 4);
    return {
      obi: { catalog: `${pick(LABELS, 8)}-${String(10000 + ((h >>> 12) % 90000))}` },
      price: `¥${Math.floor(yen / 1000)},${String(yen % 1000).padStart(3, '0')}`,
      isNew,
    };
  }
  return { obi: null, price: (h >>> 2) % 5 < 2 ? `$${pick(DOLLARS, 6)}.99` : null, isNew };
}
