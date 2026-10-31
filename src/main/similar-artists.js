'use strict';
/**
 * FROM YOUR SHELF: the artists Last.fm finds like an artist (artist.getSimilar — CDPlayer's own key from scrobble.js,
 * no sign-in), for the case's IF YOU LIKE THIS and the changer's KEEP IT FULL WITH SIMILAR ALBUMS. Kept in
 * similar-artists.json for 30 days (an artist Last.fm doesn't know: a week); past that it's asked again, and when no
 * answer comes (offline, Last.fm busy) what was kept stands. Asked one at a time, a quarter of a second apart (Last.fm
 * wants no more than five a second), and after its "too many at once" (error 29) not again for a minute.
 */
const store = require('./store');
const { sameName } = require('./same-name');
const { httpFetch } = require('./http');
const { LASTFM, LASTFM_KEY } = require('./scrobble');

const CACHE_FILE = 'similar-artists.json';
const DAY = 86400e3, FOUND_DAYS = 30, UNKNOWN_DAYS = 7, GAP_MS = 250, COOL_MS = 60e3, LIMIT = 100;
const NOT_FOUND = 6, TOO_MANY = 29;

function createSimilarArtists({ fetch = httpFetch, read = () => store.readText(CACHE_FILE), write = (text) => store.writeText(CACHE_FILE, text),
  now = Date.now, wait = (ms) => new Promise((r) => setTimeout(r, ms)), api = LASTFM, key = LASTFM_KEY } = {}) {
  let cache = null, chain = Promise.resolve(), last = -Infinity, coolUntil = 0;
  const asking = new Map();
  const artists = () => {
    if (!cache) { try { const c = JSON.parse(read() || ''); cache = c && c.version === 1 && c.artists ? c.artists : {}; } catch { cache = {}; } }
    return cache;
  };
  const save = () => { try { write(JSON.stringify({ version: 1, artists: cache })); } catch { /* not kept: asked again next time */ } };
  const fresh = (k) => !!k && now() - k.fetched < (k.names.length ? FOUND_DAYS : UNKNOWN_DAYS) * DAY;
  const answer = (k) => (k ? k.names.map(([name, match]) => ({ name, match })) : []);

  // One request → [[name, match]] to keep, or null (no answer: what was kept stands).
  async function ask(artist) {
    if (now() < coolUntil) return null;
    const gap = last + GAP_MS - now();
    if (gap > 0) await wait(gap);
    last = now();
    const url = `${api}?method=artist.getsimilar&artist=${encodeURIComponent(artist)}&autocorrect=1&limit=${LIMIT}&api_key=${key}&format=json`;
    let body;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      body = await r.json().catch(() => ({}));
    } catch { return null; } // offline
    if (body.error === NOT_FOUND) return [];
    if (body.error === TOO_MANY) { coolUntil = now() + COOL_MS; return null; }
    const list = body.similarartists && body.similarartists.artist;
    if (!Array.isArray(list)) return null; // busy, or an answer not understood
    return list.filter((a) => a && typeof a.name === 'string' && a.name.trim())
      .map((a) => [a.name.trim(), Math.round((Number(a.match) || 0) * 1000) / 1000]);
  }

  /** An artist → [{ name, match (0–1) }], the likest first; [] when none are known. Never throws. */
  function similarTo(artist) {
    const name = String(artist || '').trim(), k = sameName(name);
    if (!k) return Promise.resolve([]);
    const kept = artists()[k];
    if (fresh(kept)) return Promise.resolve(answer(kept));
    let p = asking.get(k);
    if (!p) {
      p = chain.then(() => ask(name)).then((names) => {
        if (names) { artists()[k] = { fetched: now(), names }; save(); }
        return answer(artists()[k]);
      }).catch(() => answer(artists()[k])).finally(() => asking.delete(k));
      chain = p.catch(() => {});
      asking.set(k, p);
    }
    // Kept from before, gone stale: that at once, the new answer kept for next time.
    return kept ? Promise.resolve(answer(kept)) : p;
  }
  return { similarTo };
}

module.exports = { createSimilarArtists };
