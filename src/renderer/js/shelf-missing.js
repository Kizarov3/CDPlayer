// Missing albums on the shelf (SORT: ARTIST): after the albums of an artist you have two or more of, a box saying how
// many of their official releases you don't have, which opens into see-through places for them, oldest first. Their
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

/** An artist's release groups they don't have (by title, as the shelf compares names) and haven't hidden, oldest first. */
export function missingFor(groups, owned, hidden) {
  const have = new Set(owned.map(sameName));
  return groups.filter((g) => !hidden.has(g.id) && !have.has(sameName(g.title)))
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
    if (box.open) for (const ghost of box.missing) out.push({ ghost, artist: box.artist });
    out.push({ box });
  });
  return out;
}

export const boxLabel = (box) => (box.state !== 'found' ? '…' : box.missing.length ? `+${box.missing.length} MISSING` : 'COMPLETE ★');

const SECONDARY = { Live: 'LIVE', Compilation: 'COMP', Soundtrack: 'OST', Remix: 'REMIX' };
/** What a place's label says it is: LIVE, COMP, OST, REMIX, EP, SINGLE — nothing for a studio album. */
export function typeLabel(group) {
  const secondary = (group.secondary || []).map((s) => SECONDARY[s]).find(Boolean);
  if (secondary) return secondary;
  return group.type === 'EP' ? 'EP' : group.type === 'Single' ? 'SINGLE' : '';
}
/** A single's case is slim, like a CD single's. */
export const isSlim = (group) => group.type === 'Single';
