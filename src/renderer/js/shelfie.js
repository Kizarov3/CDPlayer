// SHELFIE (SHARE on the shelf, or "/"): a picture of your wall of spines to show off — the shelf as it stands (its
// dust, obis, stickers, notes, COMPLETE ★ boxes and missing places, as the SHOW and SORT have it), taken off the
// screen a band of rows at a time (shelf.js), framed in the theme's colours with a line of what it is — "412 DISCS ·
// 38 COMPLETE ★ · WORTH €3,120 ON DISCOGS" — and the CDPlayer wordmark. Copied or saved as the Now Playing card is.
import { rgb, FONT, isLight } from './theme.js';
import { money } from './shelf-discogs.js';
import { artistsWanting, missingFor, sameName } from './shelf-missing.js';
import { t } from './i18n.js';

// The shelf's rows (styles.css, .shelf-rows): cases 196 px tall, a board under them, one row every 224 px.
export const ROW = 224;
// How far above a row's cases the picture starts (a sticky note's corner, the case in the player standing proud) and
// how much of the gap under its board is kept.
export const ROW_ABOVE = 16, ROW_BELOW = -4;
// The most rows one picture holds (a long shelf: its first rows), so it stays a picture and not a scroll.
export const MAX_ROWS = 12;
const TOP_ROWS = [3, 6];

/**
 * Which part of the shelf can go in the picture: [{ key, label, from, count }] (rows, from the top, 0 first) — the
 * rows in view as the shelf is scrolled, the first few, and the whole shelf (its first MAX_ROWS when it's longer).
 * `rows`: how many rows the shelf has; `first`: the first row in view; `inView`: how many fit in the window.
 */
export function shelfieCrops({ rows, first, inView }) {
  if (rows < 1) return [];
  const from = Math.max(0, Math.min(rows - 1, first));
  const crops = [{ key: 'VIEW', label: t('AS YOU SEE IT'), from, count: Math.max(1, Math.min(inView, rows - from)) }];
  for (const n of TOP_ROWS) if (n < rows && n < MAX_ROWS) crops.push({ key: `TOP${n}`, label: t('FIRST {n} ROWS', { n }), from: 0, count: n });
  crops.push(rows <= MAX_ROWS ? { key: 'ALL', label: t('THE WHOLE SHELF'), from: 0, count: rows }
    : { key: 'ALL', label: t('FIRST {n} ROWS', { n: MAX_ROWS }), from: 0, count: MAX_ROWS });
  // (the same rows twice — the whole shelf is in view — only once, by the first name)
  return crops.filter((c, i) => crops.findIndex((d) => d.from === c.from && d.count === c.count) === i);
}
/** The crop picked to start with: a short shelf whole, a long one as it's seen. */
export const firstCrop = (crops) => Math.max(0, crops.length > 1 && crops[crops.length - 1].count <= 4 ? crops.length - 1 : 0);

/** How many of `shown`'s artists you have everything by (the shelf's COMPLETE ★ boxes, of those MusicBrainz has answered for). */
export function completeCount(shown, albums, discogs, hidden = new Set()) {
  const showing = new Set(shown.map((a) => sameName(a.artist)));
  let n = 0;
  for (const [key, w] of artistsWanting(albums)) {
    const d = discogs.get(key);
    if (showing.has(key) && d && d.state !== 'unknown' && Array.isArray(d.groups) && !missingFor(d.groups, w.owned, hidden).length) n++;
  }
  return n;
}

/**
 * The picture's line: how many discs, how many artists COMPLETE ★, and — when Discogs has prices for them, in the
 * currency set — what they're worth ("+" when only some are priced).
 * `albums`: the albums pictured ({ discs, pressing }); `complete`: completeCount's.
 */
export function shelfieLine(albums, { complete = 0, currency = 'USD' } = {}) {
  const discs = albums.reduce((n, a) => n + Math.max(1, Number(a.discs) || 1), 0);
  let value = 0, priced = 0;
  for (const a of albums) {
    const p = a.pressing && !a.pressing.error && a.pressing.price;
    if (p && p.currency === currency && typeof p.lowest === 'number') { value += p.lowest; priced++; }
  }
  const worth = priced ? `${money(Math.round(value), currency)}${priced < albums.length ? '+' : ''}` : null;
  return [discs === 1 ? t('1 DISC') : t('{n} DISCS', { n: discs }),
    complete ? t('{n} COMPLETE ★', { n: complete }) : null,
    worth ? t('WORTH {value} ON DISCOGS', { value: worth }) : null].filter(Boolean).join(' · ');
}

/**
 * The picture as PNG bytes: `shot` (a canvas or bitmap of the shelf's rows, `scale` pixels to a point) in a frame of
 * the theme's `colors`, `heading` over it (THE SHELF, and what SHOW picks), `line` under it beside the wordmark.
 */
export async function drawShelfie(shot, { colors, heading, line, scale = 1 }) {
  const s = scale, pad = Math.round(44 * s), top = Math.round(64 * s), foot = Math.round(78 * s);
  const W = shot.width + pad * 2, H = top + shot.height + foot;
  const canvas = new OffscreenCanvas(W, H), g = canvas.getContext('2d');
  // (a light theme's, as WHITE's: soft grey where a dark one has black — the shade, the shelf's shadow, its backing, its edge)
  const light = isLight(colors.bg);
  // The theme's background, lit from the top left in its accent, darker to the foot.
  g.fillStyle = rgb(colors.bg); g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W * 0.15, 0, 0, W * 0.15, 0, Math.max(W, H) * 0.8);
  glow.addColorStop(0, rgb(colors.accent, 0.22)); glow.addColorStop(1, rgb(colors.accent, 0));
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  const shade = g.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0.5, 'rgba(0,0,0,0)'); shade.addColorStop(1, light ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.35)');
  g.fillStyle = shade; g.fillRect(0, 0, W, H);
  // What it is, over the shelf.
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.font = `bold ${Math.round(20 * s)}px ${FONT}`; g.fillStyle = rgb(colors.accent);
  fitText(g, heading, pad, top - Math.round(22 * s), W - pad * 2);
  // The shelf: its corners rounded, standing off the background.
  const r = Math.round(12 * s), x = pad, y = top;
  g.save(); g.shadowColor = light ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.6)'; g.shadowBlur = 36 * s; g.shadowOffsetY = 12 * s;
  g.fillStyle = light ? rgb(colors.bg) : 'rgb(18,16,16)'; roundRect(g, x, y, shot.width, shot.height, r); g.fill(); g.restore();
  g.save(); roundRect(g, x, y, shot.width, shot.height, r); g.clip(); g.drawImage(shot, x, y); g.restore();
  g.strokeStyle = light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)'; g.lineWidth = Math.max(1, s); roundRect(g, x + 0.5, y + 0.5, shot.width - 1, shot.height - 1, r); g.stroke();
  // Under it: the line, and the wordmark — a little disc and "CDPlayer".
  const base = y + shot.height + Math.round(48 * s);
  g.font = `bold ${Math.round(22 * s)}px ${FONT}`;
  const mark = 'CDPlayer', markW = g.measureText(mark).width, disc = Math.round(11 * s);
  g.textAlign = 'right'; g.fillStyle = rgb(colors.text);
  g.fillText(mark, W - pad, base);
  drawDisc(g, W - pad - markW - disc - Math.round(10 * s), base - Math.round(8 * s), disc, colors);
  g.textAlign = 'left'; g.fillStyle = rgb(colors.text);
  const room = W - pad * 2 - markW - disc * 2 - Math.round(40 * s);
  for (let size = 20; size >= 11; size--) { g.font = `bold ${Math.round(size * s)}px ${FONT}`; if (g.measureText(line).width <= room) break; }
  fitText(g, line, pad, base, room);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
// (cut short with "…" when it still doesn't fit)
function fitText(g, text, x, y, max) {
  let s = String(text || '');
  while (s.length > 1 && g.measureText(s).width > max) s = `${s.slice(0, -2)}…`;
  g.fillText(s, x, y);
}
// A CD seen from the front: silver, a rainbow sheen, its hole.
function drawDisc(g, cx, cy, r, colors) {
  const sheen = g.createConicGradient(-0.6, cx, cy);
  [[0, '#c9ccd2'], [0.15, rgb(colors.accent2)], [0.3, '#e8eaee'], [0.55, '#b9bcc4'], [0.7, rgb(colors.accent)], [0.85, '#e8eaee'], [1, '#c9ccd2']].forEach(([o, c]) => sheen.addColorStop(o, c));
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.arc(cx, cy, r * 0.28, 0, Math.PI * 2, true);
  g.fillStyle = sheen; g.fill('evenodd');
}

/** The rows `crop` asks for, cut out of `band` (a capture of rows `band.from`… at `band.scale`): a canvas. */
export function cutRows(band, crop) {
  const s = band.scale, y = Math.round((crop.from - band.from) * ROW * s);
  const h = Math.min(band.canvas.height - y, Math.round((crop.count * ROW + ROW_ABOVE + ROW_BELOW) * s));
  const out = new OffscreenCanvas(band.canvas.width, h);
  out.getContext('2d').drawImage(band.canvas, 0, y, band.canvas.width, h, 0, 0, band.canvas.width, h);
  return out;
}
