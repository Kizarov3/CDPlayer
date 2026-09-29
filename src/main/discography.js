'use strict';
/**
 * Artists' discographies from MusicBrainz, for the shelf's missing albums: every official album of an album artist
 * (studio albums, plus live and other albums, which the shelf leaves out), found by the MusicBrainz ID in the tags or else by name. Looked up
 * one artist at a time, only for the artists the shelf has on screen, and kept in discography.json — for 30 days,
 * or a week for an artist MusicBrainz doesn't know. All through online.js's mbFetch, which keeps CDPlayer to
 * MusicBrainz's one request a second.
 */
const store = require('./store');
const { sameName } = require('./same-name');

const CACHE_FILE = 'discography.json';
const DAY = 86400e3, FOUND_DAYS = 30, UNKNOWN_DAYS = 7, PAGE = 100;
const artistKey = sameName;
const phrase = (text) => `"${String(text).replace(/[\\"]/g, '\\$&')}"`;
const MBID = /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i;

const toGroup = (g) => ({
  id: g.id, title: g.title, type: g['primary-type'] || null, secondary: g['secondary-types'] || [],
  year: (/^\d{4}/.exec(g['first-release-date'] || '') || [null])[0],
});

function createDiscography({ mbFetch, read = () => store.readText(CACHE_FILE), write = (text) => store.writeText(CACHE_FILE, text), now = Date.now, onAnswer = () => {} }) {
  let cache = null;
  const artists = () => {
    if (!cache) { try { const c = JSON.parse(read() || ''); cache = c && c.version === 1 && c.artists ? c.artists : {}; } catch { cache = {}; } }
    return cache;
  };

  async function findArtist({ artist, mbid }) {
    // The tag's ID, when it holds one (a collaboration's tag holds several, "id1, id2": the first); anything else
    // isn't trusted into a request, and the artist is looked for by name. Aliases too: "Kino" is Кино's.
    const id = MBID.exec(String(mbid || ''));
    if (id) return id[0].toLowerCase();
    const json = await mbFetch(`artist?query=${encodeURIComponent(`artist:${phrase(artist)} OR alias:${phrase(artist)}`)}&fmt=json&limit=25`);
    const want = sameName(artist);
    const same = (a) => sameName(a.name) === want || (a.aliases || []).some((al) => sameName(al.name) === want);
    const hit = (json.artists || []).find(same);
    return hit ? hit.id : null;
  }
  async function releaseGroups(id) {
    const groups = [];
    for (let offset = 0; ; offset += PAGE) {
      const json = await mbFetch(`release-group?artist=${id}&release-group-status=website-default&type=album&limit=${PAGE}&offset=${offset}&fmt=json`);
      const page = json['release-groups'] || [];
      groups.push(...page.map(toGroup));
      // A short page is the last; a full one may not be, whatever the count says (and 3000 is plenty for anyone).
      if (page.length < PAGE || offset >= 3000) return groups;
    }
  }

  /** { artist, mbid } → { state: 'found' | 'unknown', groups }. Throws when MusicBrainz can't be reached (not cached). */
  async function discographyFor({ artist, mbid }) {
    const key = artistKey(artist), known = artists()[key];
    if (known && now() - known.fetched < (known.state === 'found' ? FOUND_DAYS : UNKNOWN_DAYS) * DAY) return { state: known.state, groups: known.groups || [] };
    const id = await findArtist({ artist, mbid });
    const result = id ? { state: 'found', groups: await releaseGroups(id) } : { state: 'unknown', groups: [] };
    artists()[key] = { mbid: id, fetched: now(), ...result };
    write(JSON.stringify({ version: 1, artists: cache }));
    return result;
  }

  // The queue: the artists on screen now, looked up one at a time. Told again as the shelf scrolls; an artist no
  // longer on screen before its turn is dropped.
  let wanted = new Map(), running = false, current = null;
  function want(list) {
    wanted = new Map(list.map((a) => [artistKey(a.artist), a]).filter(([key]) => key !== current)); // not the one on its way
    if (!running) run();
  }
  async function run() {
    running = true;
    while (wanted.size) {
      const [key, a] = wanted.entries().next().value;
      wanted.delete(key);
      current = key;
      try { onAnswer({ key, ...(await discographyFor(a)) }); } catch { /* offline or busy: asked again when next on screen */ }
      current = null;
    }
    running = false;
  }

  const tracklists = new Map();
  /**
   * A release group's editions — up to five of its official releases, each as its tracks [{ title, length (s) }] —
   * for the shelf to list the one that fits (a ghost case: the first). Kept for the session.
   */
  function tracklist(groupId) {
    if (!tracklists.has(groupId)) {
      const asked = mbFetch(`release?release-group=${encodeURIComponent(groupId)}&status=official&inc=recordings&limit=5&fmt=json`).then((json) =>
        (json.releases || []).map((release) => (release.media || []).flatMap((m) => (m.tracks || []).map((t) => ({ title: t.title, length: t.length ? t.length / 1000 : 0 }))))
          .filter((tracks) => tracks.length));
      tracklists.set(groupId, asked);
      asked.catch(() => tracklists.delete(groupId));
    }
    return tracklists.get(groupId);
  }

  return { discographyFor, want, tracklist };
}

module.exports = { createDiscography, artistKey };
