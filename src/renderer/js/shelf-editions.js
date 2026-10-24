// Editions of one album — "Ten" and "Ten (Deluxe Edition)", "Toxicity - 2011 Remaster" — stand on the shelf as one
// spine, the one played last in front, the others in its case to switch to. Same artist, same title once the edition's
// words are taken off it (as the shelf's missing albums compare them); compilations, untagged music and a set's
// separate discs ("Disc 2") stand on their own.
import { albumKey, sameName } from './shelf-missing.js';

const VARIOUS = 'variousartists';
const DISC_NO = /\b(disc|disk|cd)\s*\d/i;

const keyOf = (a) => {
  const artist = sameName(a.artist);
  if (!a.artist || artist === VARIOUS || DISC_NO.test(a.title || '')) return null;
  return `${artist}\n${albumKey(a.title)}`;
};
// The one in front: the one played last, else the most played, else the first of them (the shelf's own order).
const front = (editions) => editions.reduce((best, a) => (((a.lastPlayed || 0) - (best.lastPlayed || 0)) || ((a.plays || 0) - (best.plays || 0))) > 0 ? a : best);

/**
 * Albums (in the shelf's order) → the albums that stand on it: one for each album with editions, in the place of the
 * first of them, its `editions` set to all of them in the shelf's order (on the others, and on an album with none,
 * `editions` is null).
 */
export function groupEditions(albums) {
  const groups = new Map();
  for (const a of albums) {
    a.editions = null;
    const key = keyOf(a);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  const out = [], placed = new Set();
  for (const a of albums) {
    const key = keyOf(a), editions = key ? groups.get(key) : null;
    if (!editions || editions.length < 2) { out.push(a); continue; }
    if (placed.has(key)) continue;
    placed.add(key);
    const face = front(editions);
    face.editions = editions;
    out.push(face);
  }
  return out;
}

/**
 * What an edition is called among the others: the words its title has beyond theirs ("Deluxe Edition", "2011
 * Remaster"), else its year; '' when that says nothing (the plain one).
 */
export function editionName(a, editions) {
  const base = editions.map((e) => String(e.title || '')).reduce((x, y) => (y.length < x.length ? y : x));
  const title = String(a.title || '');
  let extra = title.toLowerCase().startsWith(base.toLowerCase()) ? title.slice(base.length) : title;
  extra = extra.replace(/^[\s([\-–—:,]+|[\s)\]]+$/g, '').replace(/[)\]]\s*[([]/g, ' · ').trim();
  if (extra) return extra;
  const sameYear = editions.filter((e) => e !== a && e.year && e.year === a.year).length;
  return a.year && !sameYear && editions.some((e) => e !== a && e.year !== a.year) ? String(a.year) : '';
}
