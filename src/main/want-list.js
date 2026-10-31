'use strict';
/**
 * The WANT LIST: albums you don't have that you'd like to, put on it with ★ WANT from a missing album's ghost case on
 * the shelf, kept in want-list.json. Each is an index card with its lowest Discogs price (discogs.js, asked again a
 * week on at most). When one turns up in the music folder it's crossed off by itself — same artist, same title without
 * its edition's words — and its case wears a FOUND IT sticker until it's first played; then the card goes.
 */
const store = require('./store');
const { sameName } = require('./same-name');

const FILE = store.FILES.wantList;
const MAX = 500, MAX_TEXT = 300;

// An album's title without its edition's words, compared as sameName compares: the same as the shelf's albumKey
// (renderer/js/shelf-missing.js) — "Nevermind (Remastered)" and "Toxicity - 2011 Remaster" are Nevermind and Toxicity.
const EDITION = /\s*[([][^)\]]*\b(deluxe|remaster(ed)?|edition|expanded|anniversary|bonus|disc|disk|cd\s*\d|super|reissue|mono|stereo|version)\b[^)\]]*[)\]]/gi;
const EDITION_TAIL = /\s+[-–—]\s+[^-–—]*\b(remaster(ed)?|deluxe|edition|anniversary|version)\b.*$/i;
const albumKey = (title) => sameName(String(title || '').replace(EDITION, ' ').replace(EDITION_TAIL, '').trim() || title);
/** What a wanted album is known by: its artist and its title, as the shelf compares them. */
const wantKey = (artist, title) => `${sameName(artist)}\n${albumKey(title)}`;

const text = (s) => (typeof s === 'string' ? s.trim().slice(0, MAX_TEXT) : '');
/** One card as it's kept, or null when it isn't one. */
function clean(x) {
  if (!x || typeof x !== 'object') return null;
  const artist = text(x.artist), title = text(x.title);
  if (!artist || !title) return null;
  const year = /^\d{4}$/.test(String(x.year || '')) ? String(x.year) : null;
  const groupId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(x.groupId || '')) ? String(x.groupId) : null;
  const found = x.found && typeof x.found.id === 'string' ? { id: x.found.id, at: Number(x.found.at) || 0 } : null;
  return { key: wantKey(artist, title), artist, title, year, groupId, added: Number(x.added) || 0, found };
}

/** want-list.json's text → the cards, oldest first (a broken file, or none: none). */
function parse(json) {
  let data;
  try { data = JSON.parse(json || ''); } catch { return []; }
  const items = data && data.version === 1 && Array.isArray(data.items) ? data.items : [];
  const seen = new Set();
  return items.map(clean).filter((x) => x && !seen.has(x.key) && seen.add(x.key)).slice(0, MAX);
}
const serialize = (items) => JSON.stringify({ version: 1, items });

/** `items` with the album `x` ({ artist, title, year, groupId }) on it — unchanged when it's there already. */
function add(items, x, now = Date.now()) {
  const card = clean({ ...x, added: now, found: null });
  if (!card || items.some((i) => i.key === card.key) || items.length >= MAX) return items;
  return [...items, card];
}
const remove = (items, key) => items.filter((i) => i.key !== key);

/**
 * The shelf's albums ({ id, artist, title }) against the list: each card not yet crossed off whose album is there now
 * is, by that album. → { items, found: the cards crossed off just now }.
 */
function crossOff(items, albums, now = Date.now()) {
  const byKey = new Map();
  for (const a of albums || []) if (a && a.artist && a.title && typeof a.id === 'string') byKey.set(wantKey(a.artist, a.title), a);
  const found = [];
  const next = items.map((i) => {
    const a = !i.found && byKey.get(i.key);
    if (!a) return i;
    const card = { ...i, found: { id: a.id, at: now } };
    found.push(card);
    return card;
  });
  return { items: found.length ? next : items, found };
}
/** The album `albumId` played: its card (crossed off for it) comes off the list. */
const played = (items, albumId) => items.filter((i) => !(i.found && i.found.id === albumId));
/** The ids of the albums wearing FOUND IT. */
const foundIds = (items) => new Set(items.filter((i) => i.found).map((i) => i.found.id));

function createWantList({ read = (f) => store.readText(f), write = (f, s) => store.writeText(f, s), now = Date.now } = {}) {
  let items = null;
  const all = () => (items = items || parse(read(FILE)));
  const save = (next) => { if (next !== all()) { items = next; write(FILE, serialize(items)); } return items; };
  return {
    list: () => all(),
    add: (x) => save(add(all(), x, now())),
    remove: (key) => { const next = remove(all(), String(key)); return next.length === all().length ? all() : save(next); },
    /** → the cards crossed off just now. */
    crossOff: (albums) => { const r = crossOff(all(), albums, now()); save(r.items); return r.found; },
    played: (albumId) => { const next = played(all(), albumId); return next.length === all().length ? all() : save(next); },
    foundIds: () => foundIds(all()),
    waiting: () => all().some((i) => !i.found),
  };
}

module.exports = { FILE, albumKey, wantKey, parse, serialize, add, remove, crossOff, played, foundIds, createWantList };
