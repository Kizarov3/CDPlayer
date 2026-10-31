// FROM YOUR SHELF: albums you have by the artists Last.fm finds like an album's (main/similar-artists.js) — the case's
// IF YOU LIKE THIS row, the changer's KEEP IT FULL WITH SIMILAR ALBUMS and the search's PLAY SIMILAR TO. Only albums on
// the shelf, never anyone else's; the artist's own other albums don't count (the shelf stands them together already),
// nor compilations; an album's editions (shelf-editions.js) count once.
import { albumKey, sameName } from './shelf-missing.js';

const VARIOUS = 'variousartists';
// A collaboration's album ("Jay-Z & Kanye West", "Calvin Harris feat. Rihanna") is each of theirs too.
// ("and", "with" and "x" stay: Florence and the Machine, Malcolm X)
const PARTS = /\s*(?:,|&|\+|\/|\bvs\.?(?=\s)|\bfeat\.?(?=\s)|\bft\.?(?=\s)|\bfeaturing\b)\s*/i;

/** The names an artist goes by on the shelf, as it compares them: the whole, and each of a collaboration's. */
export function artistKeys(artist) {
  const whole = sameName(artist);
  if (!whole || whole === VARIOUS) return [];
  return [...new Set([whole, ...String(artist).split(PARTS).map(sameName).filter((k) => k && k !== VARIOUS)])];
}
const plays = (a) => [a.plays || 0, a.lastPlayed || 0];
const better = (a, b) => { const [pa, la] = plays(a), [pb, lb] = plays(b); return pa - pb || la - lb; };

/**
 * The shelf's albums by artists `similar` ([{ name, match }], the likest first) to `artist` → [{ album, rank }], one for
 * each album (of its editions, the most played), rank the place of the likest of its artists in `similar`, the likest
 * first. Not the artist's own, not Various Artists'.
 */
export function similarPool(artist, albums, similar) {
  const own = new Set(artistKeys(artist));
  const rankOf = new Map();
  (similar || []).forEach((s, i) => { const k = sameName(s && s.name); if (k && !own.has(k) && !rankOf.has(k)) rankOf.set(k, i); });
  if (!rankOf.size) return [];
  const byAlbum = new Map();
  for (const a of albums || []) {
    if (!a || !a.tracks || !a.tracks.length) continue;
    const keys = artistKeys(a.artist);
    if (!keys.length || keys.some((k) => own.has(k))) continue;
    const ranks = keys.map((k) => rankOf.get(k)).filter((r) => r !== undefined);
    if (!ranks.length) continue;
    const key = `${keys[0]}\n${albumKey(a.title)}`, rank = Math.min(...ranks), there = byAlbum.get(key);
    if (!there || better(a, there.album) > 0) byAlbum.set(key, { album: a, rank, artist: keys[0] });
  }
  return [...byAlbum.values()].sort((x, y) => x.rank - y.rank || better(y.album, x.album));
}

/**
 * IF YOU LIKE THIS: up to `limit` albums for `album`'s case — one by each of the likest artists first, then their
 * others; [] when the shelf has none.
 */
export function similarOnShelf(album, albums, similar, { limit = 5 } = {}) {
  const pool = similarPool(album && album.artist, albums, similar);
  const seen = new Set(), first = [], rest = [];
  for (const p of pool) {
    (seen.has(p.artist) ? rest : first).push(p);
    seen.add(p.artist);
  }
  return [...first, ...rest].slice(0, limit).map((p) => p.album);
}

/**
 * Last.fm's answers as the renderer keeps them: `get(artist)` → Promise of [{ name, match }] (asked once each;
 * `ask` is cdp.similarArtists), `known(artist)` → the answer if it has come, else null.
 */
export function createSimilarLookup(ask) {
  const asked = new Map(), answers = new Map();
  const get = (artist) => {
    const k = sameName(artist);
    if (!k) return Promise.resolve([]);
    if (!asked.has(k)) {
      asked.set(k, Promise.resolve().then(() => ask(String(artist))).then((list) => (Array.isArray(list) ? list : []), () => [])
        .then((list) => { answers.set(k, list); if (!list.length) asked.delete(k); return list; })); // nothing: asked again later (it may have been offline)
    }
    return asked.get(k);
  };
  const known = (artist) => answers.get(sameName(artist)) || null;
  return { get, known };
}
