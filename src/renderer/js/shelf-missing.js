// Missing albums on the shelf (SORT: ARTIST): after the albums of an artist you have two or more of, a box saying how
// many of their studio albums you don't have, which opens into see-through places for them, oldest first. Their
// discographies come from MusicBrainz (main/discography.js); this works out what's missing and where it all stands.

const VARIOUS = 'various artists';

/** How the shelf compares names ("OK Computer" = "ok computer!") — the same as main/shelf.js's sameName. */
export const sameName = (s) => { const low = String(s || '').toLowerCase(); return low.replace(/[^\p{L}\p{N}]+/gu, '') || low.trim(); };

/** Shelf albums → the artists who get a box: Map(key → { key, artist, mbid, owned: their album titles }). */
export function artistsWanting(albums) {
  const by = new Map();
  for (const a of albums) {
    if (!a.artist || a.artist.toLowerCase() === VARIOUS) continue;
    const key = sameName(a.artist);
    if (!by.has(key)) by.set(key, { key, artist: a.artist, mbid: null, owned: [] });
    const entry = by.get(key);
    entry.owned.push(a.title);
    entry.mbid = entry.mbid || a.artistMbid || null;
  }
  for (const [key, entry] of by) if (entry.owned.length < 2) by.delete(key);
  return by;
}

// A studio album: an album that isn't also live, a compilation, a soundtrack, a remix album…
const isStudioAlbum = (g) => g.type === 'Album' && !(g.secondary || []).length;

/** An artist's studio albums they don't have (by title, as the shelf compares names) and haven't hidden, oldest first. */
export function missingFor(groups, owned, hidden) {
  const have = new Set(owned.map(sameName));
  return groups.filter((g) => isStudioAlbum(g) && !hidden.has(g.id) && !have.has(sameName(g.title)))
    .sort((a, b) => (!a.year - !b.year) || String(a.year || '').localeCompare(String(b.year || '')) || a.title.localeCompare(b.title));
}

/** The shelf's items (ARTIST order) with each artist's box after their last album, and their places before it when open. */
export function withMissing(items, boxes) {
  const last = new Map();
  items.forEach((x, i) => { if (!x.divider && x.artist && boxes.has(sameName(x.artist))) last.set(sameName(x.artist), i); });
  const after = new Map([...last].map(([key, i]) => [i, boxes.get(key)]));
  const out = [];
  items.forEach((x, i) => {
    out.push(x);
    const box = after.get(i);
    if (!box) return;
    if (box.open) for (const ghost of box.places || box.missing) out.push({ ghost, artist: box.artist });
    out.push({ box });
  });
  return out;
}

/**
 * The boxes for the artists among the albums `shown`: Map(key → { key, artist, mbid, state, missing, places, open }).
 * `missing` is everything they don't have (what the box counts); `places` only those the filter `query` lets stand.
 * An artist MusicBrainz doesn't know gets no box; one still being looked up gets a waiting one.
 */
export function boxesFor({ albums, shown, discogs, hidden, open, query }) {
  const boxes = new Map();
  const showing = new Set(shown.map((a) => sameName(a.artist)));
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  for (const [key, w] of artistsWanting(albums)) {
    if (!showing.has(key)) continue;
    const d = discogs.get(key);
    if (d && d.state === 'unknown') continue;
    const missing = d ? missingFor(d.groups, w.owned, hidden) : [];
    const places = missing.filter((g) => { const text = `${w.artist} ${g.title} ${g.year || ''}`.toLowerCase(); return words.every((x) => text.includes(x)); });
    boxes.set(key, { key, artist: w.artist, mbid: w.mbid, state: d ? 'found' : 'loading', missing, places, open: open.has(key) });
  }
  return boxes;
}

/**
 * Redraws of the shelf as discographies come in: one for a burst of answers (`later` runs it a moment on), and none
 * while `busy()` — a case out, a spine being carried — since a redraw would pull the shelf out from under it; it's
 * tried again a moment later.
 */
export function renderGate({ render, busy, later = (fn) => setTimeout(fn, 200) }) {
  let waiting = false;
  const fire = () => {
    if (busy()) { later(fire); return; }
    waiting = false;
    render();
  };
  return { request() { if (!waiting) { waiting = true; later(fire); } } };
}

export const boxLabel =(box) => (box.state !== 'found' ? '…' : box.missing.length ? `+${box.missing.length} MISSING` : 'COMPLETE ★');
