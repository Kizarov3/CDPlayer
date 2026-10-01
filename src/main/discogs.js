'use strict';
/**
 * Discogs for collectors: each shelf album's exact pressing (label, catalogue number, country, year, format, how many
 * have it and want it) and the lowest price it's for sale at on Discogs' marketplace, found from the MusicBrainz
 * release in the tags or by Discogs' own search, and kept in discogs.json. Only asked for when a case is opened or
 * the shelf is appraised; one request at a time, as slowly as Discogs asks.
 */
const store = require('./store');
const { sameName } = require('./same-name');

const CACHE_FILE = 'discogs.json', SETTINGS_FILE = 'discogs.txt';
const DAY = 86400e3, INFO_DAYS = 180, PRICE_DAYS = 30, MISSING_DAYS = 7;
const API = 'https://api.discogs.com';
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'SEK', 'NZD', 'MXN', 'BRL', 'ZAR'];
const MBID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const digits = (s) => String(s || '').replace(/\D/g, '');
const loose = (s) => String(s || '').replace(/[\s\-–.]/g, '').toLowerCase();
// Discogs tells same-named artists and labels apart with "(2)", and marks a name as credited with "*".
const bare = (name) => String(name || '').replace(/\s*\(\d+\)$/, '').replace(/\*$/, '').trim();

/** A MusicBrainz release's link to Discogs: { kind: 'release' | 'master', id }, the release when it has both; or null. */
function discogsLink(mbRelease) {
  const links = ((mbRelease && mbRelease.relations) || []).map((r) => /discogs\.com\/(?:[^/]+\/)?(release|master)\/(\d+)/.exec((r.url && r.url.resource) || '')).filter(Boolean);
  const pick = links.find((m) => m[1] === 'release') || links[0];
  return pick ? { kind: pick[1], id: Number(pick[2]) } : null;
}

/**
 * Discogs search results → the one that's this album, or null. Its title and artist must be the album's (Discogs
 * writes "Artist - Title"; a compilation's artist is "Various"); then the same barcode counts most, then the same
 * catalogue number, then the year and the label; between equals, the pressing most people have (the likeliest to be
 * this one), then Discogs' order.
 */
function pickRelease(results, album) {
  const various = !album.artist || album.artist === 'Various Artists';
  let best = null, bestScore = -1, bestHave = -1;
  for (const r of results || []) {
    const [artist, ...rest] = String(r.title || '').split(' - ');
    if (sameName(rest.join(' - ')) !== sameName(album.title)) continue;
    if (!various && sameName(bare(artist)) !== sameName(album.artist)) continue;
    let score = 0;
    if (album.barcode && (r.barcode || []).some((b) => digits(b) && digits(b) === digits(album.barcode))) score += 4;
    if (album.catalog && r.catno && loose(r.catno) === loose(album.catalog)) score += 3;
    if (album.year && String(r.year) === String(album.year)) score += 1;
    if (album.label && (r.label || []).some((l) => sameName(bare(l)) === sameName(album.label))) score += 1;
    const have = (r.community && r.community.have) || 0;
    if (score > bestScore || (score === bestScore && have > bestHave)) { best = r; bestScore = score; bestHave = have; }
  }
  return best;
}

/** A Discogs release → what the case shows of it. */
function summarize(r) {
  const label = (r.labels || [])[0] || {};
  const barcode = (r.identifiers || []).find((i) => i.type === 'Barcode');
  const year = r.year || (/^\d{4}/.exec(r.released || '') || [null])[0];
  const formats = (r.formats || []).flatMap((f) => [f.name, ...(f.descriptions || [])]).filter(Boolean);
  return {
    id: r.id, masterId: r.master_id || null,
    label: label.name ? bare(label.name) : null, catno: label.catno && label.catno.toLowerCase() !== 'none' ? label.catno : null,
    country: r.country || null, year: year ? String(year) : null, formats: formats.length ? formats.slice(0, 4).join(', ') : null,
    barcode: barcode ? barcode.value : null,
    have: (r.community && r.community.have) || 0, want: (r.community && r.community.want) || 0,
    uri: r.uri || `https://www.discogs.com/release/${r.id}`,
  };
}

/** What of a cached entry needs asking again: 'all', just its 'price', or nothing (null). */
function staleness(entry, now, currency) {
  if (!entry) return 'all';
  if (entry.releaseId === null) return now - entry.checkedAt > MISSING_DAYS * DAY ? 'all' : null;
  if (now - entry.checkedAt > INFO_DAYS * DAY) return 'all';
  if (!entry.price || entry.price.currency !== currency || now - (entry.pricedAt || 0) > PRICE_DAYS * DAY) return 'price';
  return null;
}

function createDiscogs({ fetchJson, mbFetch, read = (f) => store.readText(f), write = (f, text) => store.writeText(f, text), now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), userAgent = 'CDPlayer' }) {
  let cache = null, prefs = null, tokenDropped = false;
  const albums = () => {
    if (!cache) { try { const c = JSON.parse(read(CACHE_FILE) || ''); cache = c && c.version === 1 && c.albums ? c.albums : {}; } catch { cache = {}; } }
    return cache;
  };
  const saveCache = () => write(CACHE_FILE, JSON.stringify({ version: 1, albums: albums() }));
  const settingsOf = () => {
    if (!prefs) {
      const [token = '', currency = ''] = String(read(SETTINGS_FILE) || '').split('\n').map((s) => s.trim());
      prefs = { token: token || null, currency: CURRENCIES.includes(currency) ? currency : 'USD' };
    }
    return prefs;
  };
  const savePrefs = () => write(SETTINGS_FILE, `${settingsOf().token || ''}\n${settingsOf().currency}\n`);

  // One request at a time, as far apart as Discogs asks: 25 a minute, or 60 with a token.
  let chain = Promise.resolve(), nextAt = 0;
  function request(pathAndQuery) {
    const run = async () => {
      for (;;) {
        const wait = nextAt - now();
        if (wait > 0) await sleep(wait);
        const token = settingsOf().token;
        nextAt = now() + (token ? 1100 : 2500);
        const headers = { 'User-Agent': userAgent, ...(token ? { Authorization: `Discogs token=${token}` } : {}) };
        try { return await fetchJson(`${API}/${pathAndQuery}`, { headers }); } catch (e) {
          if (e.status === 429) { await sleep(60000); continue; }
          if (e.status === 401 && token) { settingsOf().token = null; tokenDropped = true; savePrefs(); continue; }
          throw e;
        }
      }
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }

  async function findRelease(album) {
    if (album.mbReleaseId && MBID.test(album.mbReleaseId)) {
      const link = discogsLink(await mbFetch(`release/${album.mbReleaseId}?inc=url-rels&fmt=json`).catch(() => null));
      if (link && link.kind === 'release') return link.id;
      if (link) { const master = await request(`masters/${link.id}`); if (master.main_release) return master.main_release; }
    }
    const barcode = digits(album.barcode);
    if (barcode.length >= 8 && barcode.length <= 14) {
      const hit = pickRelease((await request(`database/search?barcode=${barcode}&type=release&per_page=10`)).results, album);
      if (hit) return hit.id;
    }
    if (!album.title) return null;
    const hit = pickRelease((await request(`database/search?${searchQuery(album, 25)}`)).results, album);
    return hit ? hit.id : null;
  }
  const searchQuery = (album, n) => [album.artist && album.artist !== 'Various Artists' ? `artist=${encodeURIComponent(album.artist)}` : null,
    `release_title=${encodeURIComponent(album.title)}`, 'format=CD', 'type=release', `per_page=${n}`].filter(Boolean).join('&');

  async function priced(entry) {
    const currency = settingsOf().currency;
    const s = await request(`marketplace/stats/${entry.releaseId}?curr_abbr=${currency}`);
    return { ...entry, price: { lowest: s.lowest_price ? s.lowest_price.value : null, currency, forSale: s.num_for_sale || 0 }, pricedAt: now() };
  }
  const keep = (album, entry) => { const e = { ...entry, title: album.title || null, artist: album.artist || null }; albums()[album.id] = e; saveCache(); return e; };

  const inFlight = new Map();
  function lookup(album) {
    if (inFlight.has(album.id)) return inFlight.get(album.id);
    const p = (async () => {
      const old = albums()[album.id], stale = staleness(old, now(), settingsOf().currency);
      if (!stale) return old;
      if (stale === 'price') return keep(album, await priced(old));
      const id = old && old.by === 'user' ? old.releaseId : await findRelease(album);
      if (!id) return keep(album, { releaseId: null, by: 'auto', checkedAt: now() });
      return keep(album, await priced({ releaseId: id, by: old && old.by === 'user' ? 'user' : 'auto', info: summarize(await request(`releases/${id}`)), checkedAt: now() }));
    })().finally(() => inFlight.delete(album.id));
    inFlight.set(album.id, p);
    return p;
  }

  let appraisal = null;
  function appraise(list, onProgress) {
    if (appraisal) return appraisal.done;
    const run = { stopped: false };
    appraisal = run;
    run.done = (async () => {
      let done = 0;
      try {
        for (const album of list) {
          if (run.stopped) return { stopped: true, done, total: list.length };
          const entry = await lookup(album);
          done++;
          onProgress({ done, total: list.length, albumId: album.id, entry });
        }
        return run.stopped && done < list.length ? { stopped: true, done, total: list.length } : { done, total: list.length };
      } catch (e) {
        return { error: e && e.status ? 'DISCOGS' : 'OFFLINE', done, total: list.length };
      } finally { appraisal = null; }
    })();
    return run.done;
  }
  const stopAppraise = () => { if (appraisal) appraisal.stopped = true; };

  async function versions(masterId) {
    const json = await request(`masters/${Number(masterId)}/versions?format=CD&per_page=50`);
    return (json.versions || []).map((v) => ({ id: v.id, label: v.label || null, catno: v.catno || null, country: v.country || null, year: v.released ? String(v.released).slice(0, 4) : null, format: v.format || null }));
  }
  async function search(album) {
    const json = await request(`database/search?${searchQuery(album, 10)}`);
    return (json.results || []).map((r) => ({ id: r.id, title: r.title, label: (r.label || [])[0] || null, catno: r.catno || null, country: r.country || null, year: r.year ? String(r.year) : null }));
  }
  async function choose(album, releaseId) {
    const id = Number(releaseId);
    return keep(album, await priced({ releaseId: id, by: 'user', info: summarize(await request(`releases/${id}`)), checkedAt: now() }));
  }
  const known = (ids) => Object.fromEntries((ids || []).filter((id) => albums()[id]).map((id) => [id, albums()[id]]));
  const notFound = () => Object.entries(albums()).filter(([, e]) => e.releaseId === null).map(([id, e]) => ({ id, title: e.title, artist: e.artist }));
  const settings = () => ({ token: !!settingsOf().token, tokenDropped, currency: settingsOf().currency, currencies: CURRENCIES });

  async function setToken(token) {
    const value = String(token || '').trim();
    if (!value) { settingsOf().token = null; savePrefs(); return { ok: true }; }
    try {
      const me = await fetchJson(`${API}/oauth/identity`, { headers: { 'User-Agent': userAgent, Authorization: `Discogs token=${value}` } });
      settingsOf().token = value; tokenDropped = false; savePrefs();
      nextAt = 0;
      return { ok: true, username: me.username || null };
    } catch (e) { return { error: e && e.status ? 'BAD_TOKEN' : 'OFFLINE' }; }
  }
  function setCurrency(code) {
    if (!CURRENCIES.includes(code)) return false;
    settingsOf().currency = code; savePrefs();
    return true;
  }

  return { lookup, appraise, stopAppraise, versions, search, choose, known, notFound, settings, setToken, setCurrency };
}

module.exports = { CURRENCIES, discogsLink, pickRelease, summarize, staleness, createDiscogs };
