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
 * catalogue number, then the year and the label. A tie keeps Discogs' order.
 */
function pickRelease(results, album) {
  const various = !album.artist || album.artist === 'Various Artists';
  let best = null, bestScore = -1;
  for (const r of results || []) {
    const [artist, ...rest] = String(r.title || '').split(' - ');
    if (sameName(rest.join(' - ')) !== sameName(album.title)) continue;
    if (!various && sameName(bare(artist)) !== sameName(album.artist)) continue;
    let score = 0;
    if (album.barcode && (r.barcode || []).some((b) => digits(b) && digits(b) === digits(album.barcode))) score += 4;
    if (album.catalog && r.catno && loose(r.catno) === loose(album.catalog)) score += 3;
    if (album.year && String(r.year) === String(album.year)) score += 1;
    if (album.label && (r.label || []).some((l) => sameName(bare(l)) === sameName(album.label))) score += 1;
    if (score > bestScore) { best = r; bestScore = score; }
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

module.exports = { CURRENCIES, discogsLink, pickRelease, summarize, staleness };
