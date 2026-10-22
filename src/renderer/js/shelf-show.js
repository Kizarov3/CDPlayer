// SHOW on the shelf: which albums stand on it — all of them, or only the dusty ones, the ones still in shrink-wrap, the
// ones left part-way through (a bookmark), with a sticky note, never played; or one decade, or one genre. Kept only
// while CDPlayer is open, so the shelf never opens looking half empty.

import { dustLevel } from './shelf-dust.js';

export const SHOWS = ['ALL', 'DUSTY', 'WRAPPED', 'LEFT', 'NOTE', 'UNPLAYED'];
const MAX_GENRES = 12;

const fold = (s) => String(s || '').trim().toLowerCase();
const decadeOf = (a) => { const y = parseInt(a.year, 10); return y > 1000 ? Math.floor(y / 10) * 10 : null; };

/** Whether album `a` stands on the shelf with SHOW at `show` ('ALL', one of SHOWS, 'Y1990' or 'G<genre>'). */
export function showsAlbum(a, show, now = Date.now()) {
  switch (show) {
    case 'ALL': return true;
    case 'DUSTY': return !a.wrapped && dustLevel(a.touched, now) > 0;
    case 'WRAPPED': return !!a.wrapped;
    case 'LEFT': return !!a.bookmark;
    case 'NOTE': return !!a.note;
    case 'UNPLAYED': return !a.plays;
    default:
      if (show.startsWith('Y')) return decadeOf(a) === Number(show.slice(1));
      if (show.startsWith('G')) return fold(a.genre) === show.slice(1);
      return true;
  }
}

/** What SHOW can pick for these albums: [{ show, count }] for each kind there is, then decades, then genres (most first). */
export function showChoices(albums, now = Date.now()) {
  const kinds = SHOWS.slice(1).map((show) => ({ show, count: albums.filter((a) => showsAlbum(a, show, now)).length })).filter((c) => c.count);
  const decades = new Map(), genres = new Map();
  for (const a of albums) {
    const d = decadeOf(a);
    if (d) decades.set(d, (decades.get(d) || 0) + 1);
    const g = fold(a.genre);
    if (g) genres.set(g, { name: genres.get(g)?.name || String(a.genre).trim(), count: (genres.get(g)?.count || 0) + 1 });
  }
  return {
    kinds,
    decades: [...decades].sort((x, y) => x[0] - y[0]).map(([d, count]) => ({ show: `Y${d}`, decade: d, count })),
    genres: [...genres].sort((x, y) => y[1].count - x[1].count).slice(0, MAX_GENRES).map(([g, { name, count }]) => ({ show: `G${g}`, label: name, count })),
  };
}
