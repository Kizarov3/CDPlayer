'use strict';
/**
 * The albums saved in the Spotify library, on the shelf beside the music folder's (spotify.libraryAlbums): kept on
 * disk, so the shelf opens with them at once, and asked for again a while after they were (the shelf told when they
 * changed). An album that's in the music folder too is the folder's: shown once, as files.
 */
const { sameName } = require('./same-name');

const FRESH_MS = 10 * 60e3;
const keyOf = (a) => `${sameName(a.artist)}\n${sameName(a.title)}`;

function createSpotifyShelf({ fetchAlbums, read, write, now = Date.now, connected }) {
  let kept = null; // { at, albums, seen: { [id]: when it first came on the shelf } }
  const load = () => {
    if (kept) return kept;
    try { const j = JSON.parse(read() || 'null'); kept = j && Array.isArray(j.albums) ? j : { at: 0, albums: [] }; } catch { kept = { at: 0, albums: [] }; }
    return kept;
  };
  const signature = (albums) => albums.map((a) => `${a.id}:${a.tracks.length}`).join('|');
  return {
    /** Those to put on the shelf beside `files` (the folder's albums). */
    albumsBeside(files) {
      if (!connected()) return [];
      const have = new Set(files.map(keyOf));
      return load().albums.filter((a) => a.tracks.length && !have.has(keyOf(a))).map((a) => ({ ...a, tracks: a.tracks.map((t) => ({ ...t })) }));
    },
    /** Time to ask Spotify again (or never asked). */
    stale: () => connected() && now() - load().at > FRESH_MS,
    /** Asks Spotify for them. → whether what the shelf shows changed. */
    async refresh() {
      if (!connected()) return false;
      const r = await fetchAlbums();
      if (!r || r.error || !Array.isArray(r.albums)) return false;
      const before = signature(load().albums), seen = { ...(load().seen || {}) };
      for (const a of r.albums) if (!seen[a.id]) seen[a.id] = now();
      kept = { at: now(), albums: r.albums, seen };
      try { write(JSON.stringify(kept)); } catch { /* kept for this run */ }
      return signature(r.albums) !== before;
    },
    /** One taken out of the library (♥ off): gone at once; and the library read again next time. */
    forget(id) {
      const k = load();
      kept = { at: 0, albums: k.albums.filter((a) => a.id !== id), seen: k.seen };
      try { write(JSON.stringify(kept)); } catch { /* kept for this run */ }
    },
    markStale() { load().at = 0; },
    /** When a saved album first came on the shelf (its dust gathers from then: Spotify's own plays aren't known). */
    onShelfSince: (id) => (load().seen || {})[id] || null,
    /** The cover of the saved album a song (its first, as a rule) is on. */
    coverOf(uri) { const a = load().albums.find((x) => x.tracks.some((t) => t.path === uri)); return (a && a.spotify && a.spotify.cover) || null; },
  };
}

module.exports = { createSpotifyShelf };
