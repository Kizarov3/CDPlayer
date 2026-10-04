// The order the shelf stands in, and the cardboard divider cards between its sections, like a record shop's:
// by artist (a card for each letter), newest in the music folder first (a card for each month), most played (a card
// before the albums not played yet), by year (a card for each decade), or by colour, round the rainbow (a card for each).
import { t } from './i18n.js';
import { priceBand } from './shelf-discogs.js';

export const SORTS = ['ARTIST', 'NEW', 'PLAYED', 'YEAR', 'COLOR', 'PRICE'];

/** Whether an album shows for what's typed in the shelf's filter: every word somewhere in its artist, title, year or note. */
export function matchesFilter(album, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${album.artist || ''} ${album.title} ${album.year || ''} ${album.note || ''}`.toLowerCase();
  return words.every((w) => text.includes(w));
}
/** What the shelf shows, as one string: each album's id, title, artist, year and its songs' paths and titles — so a
 * change in the music folder that doesn't change any of that redraws nothing. */
export function shelfSignature(albums) {
  return albums.map((a) => JSON.stringify([a.id, a.title, a.artist || null, a.year || null, a.tracks.map((t) => [t.path, t.title])])).sort().join('\n');
}
const MONTHS = [t('JAN'), t('FEB'), t('MAR'), t('APR'), t('MAY'), t('JUN'), t('JUL'), t('AUG'), t('SEP'), t('OCT'), t('NOV'), t('DEC')];

// The letter an artist is filed under: "The Beatles" under B, "Björk" under B, "311" under #, no artist under ?.
function letterOf(artist) {
  if (!artist) return '?';
  const name = artist.replace(/^the\s+/i, '').normalize('NFD').replace(/\p{M}/gu, '');
  const first = [...name.trim()][0] || '';
  return /\p{L}/u.test(first) ? first.toUpperCase() : '#';
}
function monthOf(ms) {
  if (!ms) return '?';
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
// ---- Colour -----------------------------------------------------------------------------------------------------

function hsv([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max / 255 };
}

/**
 * The colour an album is filed under, from its cover's pixels (RGBA): the average of its most common vivid hue —
 * weighted by how vivid — rather than of everything, which comes out a muddy brown for a busy cover. A cover with
 * hardly any colour in it is its plain average.
 */
export function dominantColor(pixels) {
  const buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let all = [0, 0, 0], n = 0, vivid = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const px = [pixels[i], pixels[i + 1], pixels[i + 2]];
    all = all.map((x, k) => x + px[k]); n++;
    const { h, s, v } = hsv(px);
    if (s < 0.35 || v < 0.25) continue;
    vivid++;
    const bk = buckets[Math.floor(h / 30) % 12], w = s * v;
    bk.w += w; bk.r += px[0] * w; bk.g += px[1] * w; bk.b += px[2] * w;
  }
  if (!n) return null;
  if (vivid < n * 0.12) return all.map((x) => Math.round(x / n));
  const top = buckets.reduce((a, b) => (b.w > a.w ? b : a));
  return [top.r, top.g, top.b].map((x) => Math.round(x / top.w));
}

export const BANDS = ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE', 'PURPLE', 'B&W'];
/** Where a colour stands on a colour-sorted shelf: { band, order } — its rainbow band (or B&W), and its place in it. */
export function colorBand(rgb) {
  if (!rgb) return { band: 'B&W', order: -0.5 };
  const { h, s, v } = hsv(rgb);
  if (s < 0.22 || v < 0.18) return { band: 'B&W', order: -v }; // light to dark
  const band = h >= 345 || h < 15 ? 'RED' : h < 45 ? 'ORANGE' : h < 70 ? 'YELLOW' : h < 165 ? 'GREEN' : h < 260 ? 'BLUE' : 'PURPLE';
  return { band, order: h >= 345 ? h - 360 : h }; // crimson comes before red
}

const decadeOf = (year) => (year ? t('{decade}s', { decade: Math.floor(Number(year) / 10) * 10 }) : t('NO YEAR'));

/**
 * Albums (in the scanner's by-artist order, each with `added` and `plays`) → the shelf as it stands under `sort`: the
 * albums, with { divider: 'label' } before each section.
 */
export function arrange(albums, sort, { currency = null } = {}) {
  let list = albums.slice(), section;
  if (sort === 'NEW') {
    list.sort((a, b) => (b.added || 0) - (a.added || 0));
    section = (a) => monthOf(a.added);
  } else if (sort === 'PLAYED') {
    list.sort((a, b) => (b.plays || 0) - (a.plays || 0));
    section = (a) => (a.plays ? null : t('NOT PLAYED YET'));
  } else if (sort === 'COLOR') {
    const at = new Map(list.map((a) => [a, colorBand(a.color)]));
    list.sort((a, b) => (BANDS.indexOf(at.get(a).band) - BANDS.indexOf(at.get(b).band)) || (at.get(a).order - at.get(b).order));
    section = (a) => at.get(a).band;
  } else if (sort === 'YEAR') {
    list.sort((a, b) => (!a.year - !b.year) || (Number(a.year) || 0) - (Number(b.year) || 0));
    section = (a) => decadeOf(a.year);
  } else if (sort === 'PRICE') {
    // Only prices in the currency chosen now: one still in the old one (until it's asked again) counts as no price.
    const price = (a) => { const p = a.pressing && a.pressing.price; return p && typeof p.lowest === 'number' && (!currency || p.currency === currency) ? p.lowest : null; };
    list.sort((a, b) => (price(b) ?? -1) - (price(a) ?? -1));
    section = (a) => priceBand(price(a), currency || (a.pressing && a.pressing.price ? a.pressing.price.currency : 'USD'));
  } else {
    section = (a) => letterOf(a.artist);
  }
  const out = [];
  let last;
  for (const a of list) {
    const s = section(a);
    if (s && s !== last) out.push({ divider: s });
    last = s;
    out.push(a);
  }
  return out;
}

/**
 * The sections of a shelf as arranged (its divider cards, in order), for the index down its side: { label, short } —
 * short enough for a narrow strip: '1990s' → '90s', 'MAR 2024' → "MAR'24", 'NOT PLAYED YET' → 'NOT', 'ORANGE' → 'ORA'.
 */
export function jumpTargets(items) {
  return items.filter((x) => x.divider).map(({ divider: label }) => {
    const month = /^([A-Z]{3}) \d{2}(\d{2})$/.exec(label);
    const word = label.split(' ')[0];
    const short = /^\d{4}s$/.test(label) ? label.slice(2) : month ? `${month[1]}'${month[2]}` : word.length > 5 ? word.slice(0, 3) : word;
    return { label, short };
  });
}
