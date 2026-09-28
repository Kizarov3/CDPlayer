// The order the shelf stands in, and the cardboard divider cards between its sections, like a record shop's:
// by artist (a card for each letter), newest in the music folder first (a card for each month), most played (a card
// before the albums not played yet), or by year (a card for each decade).

export const SORTS = ['ARTIST', 'NEW', 'PLAYED', 'YEAR'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

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
const decadeOf = (year) => (year ? `${Math.floor(Number(year) / 10) * 10}s` : 'NO YEAR');

/**
 * Albums (in the scanner's by-artist order, each with `added` and `plays`) → the shelf as it stands under `sort`: the
 * albums, with { divider: 'label' } before each section.
 */
export function arrange(albums, sort) {
  let list = albums.slice(), section;
  if (sort === 'NEW') {
    list.sort((a, b) => (b.added || 0) - (a.added || 0));
    section = (a) => monthOf(a.added);
  } else if (sort === 'PLAYED') {
    list.sort((a, b) => (b.plays || 0) - (a.plays || 0));
    section = (a) => (a.plays ? null : 'NOT PLAYED YET');
  } else if (sort === 'YEAR') {
    list.sort((a, b) => (!a.year - !b.year) || (Number(a.year) || 0) - (Number(b.year) || 0));
    section = (a) => decadeOf(a.year);
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
