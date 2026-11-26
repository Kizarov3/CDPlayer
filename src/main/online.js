'use strict';
/**
 * Everything that talks to the network: cover-art lookup (iTunes → Deezer → Spotify → MusicBrainz), lyrics lookup
 * (word-timed from Unison or NetEase → lrclib.net → Unison). Spotify's own calls live in spotify.js. All optional — the
 * player works offline.
 */
const { httpFetch } = require('./http');
const { nativeImage } = require('electron');
const { bestDiscPhoto } = require('./disc-photo');
const { getSpotifyAppToken } = require('./spotify');
const { searchVariants, nameVariants, bareTitle } = require('./track-names');
const { ttmlToLrc, ttmlDuration } = require('./ttml');

const USER_AGENT = 'CDPlayer/2.0 (open cover lookup)';
const TIMEOUT_MS = 8000;

async function fetchJson(url, { timeout = TIMEOUT_MS, ...init } = {}) {
  const res = await httpFetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...(init.headers || {}) }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; err.retryAfter = Number(res.headers && res.headers.get('retry-after')) || null; throw err; }
  return res.json();
}
async function fetchImageDataUrl(url, timeout = TIMEOUT_MS) {
  const res = await httpFetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) return null;
  const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
  if (img.isEmpty()) return null;
  return `data:image/jpeg;base64,${img.toJPEG(90).toString('base64')}`;
}

function significantWords(text) {
  // Letters and digits of any script, so a Cyrillic or Japanese title is compared too rather than waved through.
  // A Latin letter's accent or slash doesn't make another word: lynch.'s BLØOD is a file's BLOOD, Beyoncé is Beyonce.
  const folded = String(text).toLowerCase().normalize('NFD').replace(/([a-z])\p{M}+/gu, '$1')
    .replace(/[øœæßđłþ]/g, (c) => ({ ø: 'o', œ: 'oe', æ: 'ae', ß: 'ss', đ: 'd', ł: 'l', þ: 'th' })[c]).normalize('NFC');
  return new Set(folded.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3));
}
function wordOverlapRatio(query, result) {
  const q = significantWords(query);
  if (!q.size) return 1;
  const r = significantWords(result);
  let matched = 0;
  for (const w of q) if (r.has(w)) matched++;
  return matched / q.size;
}

// ---- Cover art ------------------------------------------------------------------------------------------------

// Each source's top hit: its cover address and what the hit is (title, artist), so it can be checked against the name.
async function itunesArt(query) {
  const json = await fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`);
  const hit = json.results && json.results[0];
  if (!hit || !hit.artworkUrl100) return null;
  return { url: hit.artworkUrl100.replace('100x100bb', '600x600bb'), title: hit.trackName || '', artist: hit.artistName || '' };
}
async function deezerArt(query) {
  const json = await fetchJson(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1`);
  const hit = json.data && json.data[0];
  const url = hit && ((hit.album && hit.album.cover_xl) || hit.cover_xl);
  if (!url) return null;
  return { url, title: hit.title || '', artist: hit.artist ? hit.artist.name : '' };
}
async function spotifyArt(query) {
  const token = await getSpotifyAppToken();
  if (!token) return null;
  const json = await fetchJson(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`, { headers: { Authorization: `Bearer ${token}` } });
  const item = json.tracks && json.tracks.items && json.tracks.items[0];
  const image = item && item.album && item.album.images && item.album.images[0];
  if (!image) return null;
  return { url: image.url, title: item.name || '', artist: (item.artists || []).map((a) => a.name).join(' ') };
}
const COVER_SOURCES = [['ITUNES', itunesArt], ['DEEZER', deezerArt], ['SPOTIFY', spotifyArt]];
const searchText = (v) => `${v.artist ? `${v.artist} ` : ''}${v.title}`;
const variantsOf = (name) => (typeof name === 'string' ? searchVariants(name).map((title) => ({ artist: null, title })) : nameVariants(name));

// A hit is this song when its title matches the title and its artist the artist (when there is one).
function sameSong(hit, artist, title) {
  return wordOverlapRatio(bareTitle(title), hit.title) >= 0.5 && (!artist || wordOverlapRatio(artist, hit.artist) >= 0.5);
}
// For lyrics, the other way round too: most of the hit's own title is in the song's. Else "BLOOD" by lynch. took
// Brotha Lynch Hung's "Blood on da Rug" (blood, and Lynch, in both).
function sameLyricsSong(hit, artist, title) {
  return sameSong(hit, artist, title) && wordOverlapRatio(bareTitle(hit.title), title) > 0.5;
}

// MusicBrainz + Cover Art Archive: the open, community-run catalogue, for the indie, local and older releases the
// stores don't carry. MusicBrainz asks for a User-Agent that says who is calling and at most one request a second.
const MB_USER_AGENT = 'CDPlayer/2 ( https://github.com/Kizarov3/CDPlayer )';
let mbNextSlot = 0;
// A 503 is MusicBrainz saying "slow down" (other requests from the same address count too) or that it's busy with
// everyone's, not "no": asked again before giving up — when it says to (Retry-After, a second as a rule), else after a
// longer pause each time. Not to the second: what it lets in is counted in spells of two seconds, and asking again 2, 4
// and 8 s on came at the same moment of each, when it had let in all it would.
const MB_TRIES = 4, MB_TRIES_SOON = 8;
async function mbFetch(pathAndQuery, tried = 0) {
  const wait = mbNextSlot - Date.now();
  mbNextSlot = Math.max(Date.now(), mbNextSlot) + 1100;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  try {
    return await fetchJson(`https://musicbrainz.org/ws/2/${pathAndQuery}`, { headers: { 'User-Agent': MB_USER_AGENT } });
  } catch (e) {
    if (e.status !== 503 || tried + 1 >= (e.retryAfter ? MB_TRIES_SOON : MB_TRIES)) throw e;
    const pause = e.retryAfter ? Math.min(e.retryAfter, 10) * 1000 + 100 + Math.random() * 500 : 1000 * 2 ** (tried + 1);
    mbNextSlot = Math.max(mbNextSlot, Date.now() + pause);
    return mbFetch(pathAndQuery, tried + 1);
  }
}
// The same question asked by several at once (a disc going in: its photo, its booklet's scans and its story each want
// the album found) goes out once, and its answer's kept a while.
const ONCE_MS = 10 * 60 * 1000;
function onceFor(ask) {
  const kept = new Map();
  return (what) => {
    const had = kept.get(what);
    if (had && had.until > Date.now()) return had.answer;
    const answer = ask(what);
    for (const [k, v] of kept) if (v.until <= Date.now()) kept.delete(k);
    kept.set(what, { answer, until: Date.now() + ONCE_MS });
    answer.catch(() => kept.delete(what));
    return answer;
  };
}
const mbOnce = onceFor((pathAndQuery) => mbFetch(pathAndQuery));
/** What the Cover Art Archive has of a release. */
const caaIndex = onceFor((id) => fetchJson(`https://coverartarchive.org/release/${id}`, { timeout: 20000 }));
const musicBrainz = (entity, query) => mbFetch(`${entity}?query=${encodeURIComponent(query)}&fmt=json&limit=25`);
const musicBrainzGet = (what, inc) => mbFetch(`${what}?inc=${inc}&fmt=json`);
const phrase = (text) => `"${String(text).replace(/[\\"]/g, '\\$&')}"`;
const credited = (entry) => (entry['artist-credit'] || []).map((c) => c.name).join(' ');
const MB_TYPE_RANK = { Album: 0, EP: 1, Single: 2 };

// The album a song is on, as a MusicBrainz release group: the one named by the album tag when there is one, otherwise
// the earliest official studio release (albums before EPs before singles) with a recording of this song by this
// artist — so a song gets its album's cover, not a compilation's or a live bootleg's. → { id, title } or null.
/** The artist's release group of this name (the album itself, not a remix, live or fan-made one) → { id, title } | null. */
async function releaseGroupNamed(artist, album) {
  const json = await mbOnce(`release-group?query=${encodeURIComponent(`releasegroup:${phrase(album)} AND artist:${phrase(artist)}`)}&fmt=json&limit=25`);
  // (the search may put one of those first: no secondary type before one, an album before an EP, then the most releases)
  const groups = (json['release-groups'] || []).filter((g) => g.score >= 90 && sameSong({ title: g.title, artist: credited(g) }, artist, album));
  const rank = (g) => [(g['secondary-types'] || []).length ? 1 : 0, MB_TYPE_RANK[g['primary-type']] ?? 3, -(g.count || 0)];
  const group = groups.sort((a, b) => (rankBefore(rank(a), rank(b)) ? -1 : rankBefore(rank(b), rank(a)) ? 1 : 0))[0];
  return group ? { id: group.id, title: group.title } : null;
}
async function musicBrainzAlbum({ artist, title, album }) {
  if (album) {
    const group = await releaseGroupNamed(artist, album);
    if (group) return group;
  }
  const json = await musicBrainz('recording', `recording:${phrase(bareTitle(title))} AND artist:${phrase(artist)}`);
  let best = null;
  for (const rec of json.recordings || []) {
    if (rec.score < 90 || !sameSong({ title: rec.title, artist: credited(rec) }, artist, title)) continue;
    for (const release of rec.releases || []) {
      const group = release['release-group'] || {};
      if (release.status !== 'Official' || (group['secondary-types'] || []).length || !(group['primary-type'] in MB_TYPE_RANK)) continue;
      const rank = [MB_TYPE_RANK[group['primary-type']], release.date || '9999'];
      if (!best || rank[0] < best.rank[0] || (rank[0] === best.rank[0] && rank[1] < best.rank[1])) best = { rank, id: group.id, title: group.title };
    }
  }
  return best;
}
// The album's front cover from the Cover Art Archive (a 404 when nobody has uploaded one). → data URL + address, or null.
async function musicBrainzArt(v) {
  const group = await musicBrainzAlbum(v);
  if (!group) return null;
  const url = `https://coverartarchive.org/release-group/${group.id}/front-500`;
  const cover = await fetchImageDataUrl(url);
  return cover ? { cover, url } : null;
}

// ---- Tags from MusicBrainz ------------------------------------------------------------------------------------------

const creditText = (credit) => (credit || []).map((c) => `${c.name}${c.joinphrase || ''}`).join('').trim();
// [a, b, …] sorts before [c, d, …]: compared item by item, the first difference decides.
function rankBefore(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}
const VERSION_WORDS = /\b(live|demo|remix|mix|instrumental|acoustic|karaoke|a cappella|acapella|edit|version|session|rehearsal)\b/i;
// "Album version" and the like name the song itself, not another take of it.
const SAME_TAKE = /\b(album|original|studio|lp) version\b/gi;

// A CD or a download is what a file is usually ripped from; a vinyl side's track numbers are A1, B2…
const formatRank = (medium) => (/\b(CD|Digital Media)\b/i.test((medium && medium.format) || '') ? 0 : 1);

/**
 * The recording and release a file most likely is, from a MusicBrainz recording search: the same song by the same
 * artist, as long as the file (when its length is known), and not a live or demo take unless the title says it is —
 * or, for a search by the file's ISRC (`byIsrc`), any recording as long as the file, whatever its tags say.
 * Its release is the album the file's tag names, when one matches; otherwise the earliest official studio release,
 * albums before EPs before singles, not a box set; and of that album's pressings, a CD or download before a vinyl or
 * cassette one. → { recording, release, medium, track } or null.
 */
function pickRecording(recordings, { artist, title, album, duration, byIsrc = false }) {
  const candidates = [];
  for (const rec of recordings || []) {
    if (duration > 0 && rec.length && Math.abs(rec.length / 1000 - duration) > 5) continue;
    if (!byIsrc) {
      if (rec.score < 85 || !sameSong({ title: rec.title, artist: creditText(rec['artist-credit']) }, artist, title)) continue;
      // …and the other way round for the first artist credited, so "Tool Tribute Band" isn't taken for "Tool".
      const first = ((rec['artist-credit'] || [])[0] || {}).name || '';
      if (artist && wordOverlapRatio(first, artist) < 0.5) continue;
      if (VERSION_WORDS.test((rec.disambiguation || '').replace(SAME_TAKE, '')) && !VERSION_WORDS.test(title)) continue;
    }
    for (const release of rec.releases || []) {
      const group = release['release-group'] || {};
      const albumMatch = !!album && wordOverlapRatio(bareTitle(album), release.title) >= 0.75 && wordOverlapRatio(release.title, album) >= 0.75;
      if (!albumMatch && (release.status !== 'Official' || (group['secondary-types'] || []).length || !(group['primary-type'] in MB_TYPE_RANK))) continue;
      const medium = (release.media || [])[0], track = medium && (medium.track || [])[0];
      // A release dated only by its year sorts after the dated ones of that year (it's usually an obscure pressing), and
      // a box set after an album on one or two discs.
      const date = /^\d{4}$/.test(release.date || '') ? `${release.date}-99` : release.date || '9999';
      const rank = [albumMatch ? 0 : 1, MB_TYPE_RANK[group['primary-type']] ?? 3, (release.count || 1) > 2 ? 1 : 0, date, -(rec.score || 0)];
      candidates.push({ rank, group: group.id, recording: rec, release, medium, track });
    }
  }
  let best = null;
  for (const c of candidates) if (!best || rankBefore(c.rank, best.rank)) best = c;
  if (!best) return null;
  // The album is decided; now its pressing.
  const pressingRank = (c) => [c.rank[1], c.rank[2], formatRank(c.medium), c.rank[3], c.rank[4]];
  let pressing = best;
  for (const c of candidates) {
    if (c.group === best.group && c.rank[0] === best.rank[0] && rankBefore(pressingRank(c), pressingRank(pressing))) pressing = c;
  }
  return pressing;
}

// A hidden track's name: MusicBrainz names a last track with a song hidden in it "A / B" ("Something in the Way /
// Endless, Nameless"). Its recording as long as the file (within 5 s), whose A is the file's title → B; else null.
function hiddenNameFrom(recordings, { title, duration }) {
  const same = (a, b) => bareTitle(a).trim().toLowerCase() === bareTitle(b).trim().toLowerCase();
  for (const r of recordings || []) {
    const m = /^(.+?) \/ (.+)$/.exec(String(r.title || ''));
    if (m && r.length > 0 && Math.abs(r.length / 1000 - duration) <= 5 && same(m[1], title)) return m[2].trim();
  }
  return null;
}
/** The hidden song of a file of `duration` seconds titled `title` → { name } (null: none known), or { networkError }. */
async function findHiddenName({ artist, title, duration }) {
  if (!artist || !title || !(duration > 0)) return { name: null };
  const query = `recording:${phrase(bareTitle(title))} AND artist:${phrase(artist)} AND dur:[${Math.round(duration - 5) * 1000} TO ${Math.round(duration + 5) * 1000}]`;
  try {
    const json = await mbFetch(`recording?query=${encodeURIComponent(query)}&fmt=json&limit=25`);
    return { name: hiddenNameFrom(json.recordings, { title, duration }) };
  } catch { return { networkError: true }; }
}

/**
 * What MusicBrainz says a song's tags should be, for the Tags panel: { title, artist, album, albumArtist, year, track,
 * trackCount, disc, discCount, genre, label, musicBrainzTrackId, musicBrainzReleaseId, coverUrl } — or null when it
 * doesn't know the song. { networkError: true } when it couldn't be asked.
 */
async function lookupTags({ artist, title, album, duration, guessed, isrc }) {
  let networkError = false;
  // The file's ISRC (put there by the label or the store it came from) names the recording itself: asked first, it
  // finds the song even when the file's artist or title is wrong.
  const searches = [];
  if (/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/i.test(String(isrc || '').replace(/-/g, ''))) {
    searches.push({ v: { artist, title }, byIsrc: true, queries: [`isrc:${String(isrc).replace(/-/g, '').toUpperCase()}`] });
  }
  for (const v of nameVariants({ artist, title, guessed }).filter((x) => x.artist)) {
    // A famous song has hundreds of recordings (mostly live), in no useful order: when the file's length is known, ask
    // only for official releases of a recording that long first — that's every candidate on one page.
    const base = `recording:${phrase(bareTitle(v.title))} AND artist:${phrase(v.artist)}`;
    searches.push({ v, queries: duration > 0 ? [`${base} AND status:official AND dur:[${Math.round(duration - 5) * 1000} TO ${Math.round(duration + 5) * 1000}]`, base] : [base] });
  }
  for (const { v, queries, byIsrc } of searches) {
    let found = null;
    for (const query of queries) {
      try {
        const json = await mbFetch(`recording?query=${encodeURIComponent(query)}&fmt=json&limit=100`);
        found = pickRecording(json.recordings, { ...v, album: v.artist === artist ? album : null, duration, byIsrc });
      } catch { networkError = true; }
      if (found) break;
    }
    if (!found) continue;
    let release = found.release;
    try {
      release = await musicBrainzGet(`release/${found.release.id}`, 'artist-credits+labels+release-groups+genres');
    } catch { /* the search's own summary of the release will do */ }
    const genres = [...(release.genres || []), ...((release['release-group'] || {}).genres || [])].sort((a, b) => b.count - a.count);
    const label = (release['label-info'] || []).map((l) => l.label && l.label.name).find(Boolean);
    // The year the album first came out, not this pressing's (a 2006 reissue of a 1996 album is still 1996's).
    const year = /\d{4}/.exec((release['release-group'] || {})['first-release-date'] || release.date || found.release.date || '');
    const genre = genres[0] ? genres[0].name.replace(/\b\w/g, (ch) => ch.toUpperCase()) : null;
    return {
      title: found.recording.title,
      artist: creditText(found.recording['artist-credit']),
      album: release.title,
      albumArtist: creditText(release['artist-credit'] || found.release['artist-credit']) || null,
      year: year ? parseInt(year[0], 10) : null,
      track: found.track ? parseInt(found.track.number, 10) || found.medium['track-offset'] + 1 : null,
      trackCount: found.medium ? found.medium['track-count'] : null,
      disc: found.medium ? found.medium.position : null,
      discCount: (release.media || []).length || found.release.count || null,
      genre, label: label || null,
      musicBrainzTrackId: found.recording.id, musicBrainzReleaseId: release.id,
      coverUrl: `https://coverartarchive.org/release/${release.id}/front-500`,
      name: v,
    };
  }
  return networkError ? { networkError: true } : null;
}
// An album's name without its edition: "Vol. 3 (Special Edition)" → "Vol. 3".
const EDITION_WORDS = /edition|deluxe|remaster|expanded|anniversary|bonus|version|reissue|special|collector|limited|mono|stereo|explicit/i;
function bareAlbum(album) {
  let a = String(album || '').trim(), m;
  while ((m = /\s*[([]([^()[\]]*)[)\]]\s*$/.exec(a)) && EDITION_WORDS.test(m[1])) a = a.slice(0, m.index).trim();
  return a.replace(/\s+-\s+[^-]*(edition|remaster(ed)?|deluxe)[^-]*$/i, '').trim() || String(album);
}
/**
 * The disc itself, as it's printed: a photo of the CD (an image of the "Medium") from the Cover Art Archive — the
 * album's own picture on the disc, not its cover's. `releaseId` first, then the album's other releases (CDs first).
 * → data URL, or null when nobody has uploaded one.
 */
/** "OK Computer OKNOTOK 1997 2017" → "OK Computer OKNOTOK 1997", "OK Computer OKNOTOK", "OK Computer", "OK": its title cut back a word at a time. */
function shorterTitles(album) {
  const words = String(album || '').trim().split(/\s+/).filter(Boolean);
  return words.slice(1).map((_, i) => words.slice(0, words.length - 1 - i).join(' '));
}
async function findDiscArt({ artist, album, releaseId, found = null }) {
  const ids = releaseId ? [releaseId] : [], cds = new Set(releaseId ? [releaseId] : []), sets = new Set();
  // (offline: it throws — not "none"). An edition's name ("… (Special Edition)", "[Remastered 2011]") found as the album.
  const bare = bareAlbum(album);
  // (the album searched for as an album only: as a song of its name too, it was one more request that could fail)
  let group = found || (artist && album ? await releaseGroupNamed(artist, album) : null);
  if (!group && artist && bare !== album) group = await releaseGroupNamed(artist, bare);
  let failed = false; // (a lookup that went wrong, not one that found nothing: tried again another time, not "none")
  const lost = (e) => { if (!e || e.status !== 404) failed = true; return null; };
  if (group) {
    const json = await mbOnce(`release?release-group=${group.id}&inc=media&fmt=json&limit=100`).catch(lost);
    const isCd = (r) => (r.media || []).some((m) => /\bCD\b/.test(m.format || '') && m.format !== 'CD-R');
    const rank = (r) => [isCd(r) ? 0 : 1, (r.media || []).length > 1 ? 1 : 0, -((r['cover-art-archive'] || {}).count || 0)]; // (a one-disc edition's photo shows one disc, not a CD and its DVD side by side)
    ((json && json.releases) || []).filter((r) => ((r['cover-art-archive'] || {}).count || 0) > 1)
      .sort((a, b) => (rankBefore(rank(a), rank(b)) ? -1 : rankBefore(rank(b), rank(a)) ? 1 : 0)).forEach((r) => { ids.push(r.id); if (isCd(r)) cds.add(r.id); if ((r.media || []).length > 1) sets.add(r.id); });
  }
  // The archive takes seconds to answer for each release (and now and then fails): all of them asked at once, the
  // biggest photo of the disc taken (disc-photo.js).
  const discOf = async (id) => {
    const index = await caaIndex(id).catch(lost);
    const images = (index && index.images) || [];
    const disc = images.find((i) => (i.types || []).length === 1 && i.types[0] === 'Medium') || images.find((i) => (i.types || []).includes('Medium'));
    if (!disc) throw new Error('no disc');
    const art = await fetchImageDataUrl((disc.thumbnails && (disc.thumbnails['1200'] || disc.thumbnails['500'] || disc.thumbnails.large)) || disc.image, 20000).catch(() => null);
    if (!art) { failed = true; throw new Error('no picture'); }
    return { art, width: nativeImage.createFromDataURL(art).getSize().width };
  };
  // The CDs' first — a vinyl's label (or a cassette's) only when no CD of it has its disc photographed.
  const unique = [...new Set(ids)], asked = (list) => list.map((id) => ({ ask: () => discOf(id), multi: sets.has(id) }));
  const photo = await bestDiscPhoto(asked(unique.filter((id) => cds.has(id)).slice(0, 12)))
    || await bestDiscPhoto(asked(unique.filter((id) => !cds.has(id)).slice(0, 6)));
  if (photo) return photo.art;
  // An edition named past the album's own title ("OK Computer OKNOTOK 1997 2017") with no photo of its own discs:
  // the album's — its title cut back a word at a time, to the first that's an album of the artist's (not this one).
  // (looked for even when one of the edition's releases didn't answer: a reissue has dozens, and one often doesn't)
  if (!releaseId && !found && artist) {
    for (const title of shorterTitles(bare).slice(0, 4)) {
      let other = null;
      try { other = await releaseGroupNamed(artist, title); } catch { failed = true; continue; } // (MusicBrainz fails some searches outright — any with "OKNOTOK" in it: the next, shorter title is tried)
      if (other && (!group || other.id !== group.id)) {
        const art = await findDiscArt({ artist, album: other.title, found: other }).catch(() => { failed = true; return null; });
        if (art) return art;
        break;
      }
    }
  }
  if (failed) throw new Error('disc art: lookup failed');
  return null;
}
/**
 * The real booklet's pages, the back of the case and what's under the disc, as scanned for the Cover Art Archive
 * (booklet-scans.js picks the release and the scans). → [{ art (data URL), kind, width, height }], [] when nobody has
 * scanned them; throws when a lookup failed (offline), so it's looked for another time.
 */
async function findBookletScans({ artist, album, releaseId }) {
  const scans = require('./booklet-scans');
  let group = artist && album ? await releaseGroupNamed(artist, album) : null;
  const bare = bareAlbum(album);
  if (!group && artist && bare !== album) group = await releaseGroupNamed(artist, bare);
  let failed = false;
  const lost = (e) => { if (!e || e.status !== 404) failed = true; return null; };
  const json = group ? await mbOnce(`release?release-group=${group.id}&inc=media&fmt=json&limit=100`).catch(lost) : null;
  const ids = scans.scanReleases((json && json.releases) || [], releaseId || null);
  const found = await Promise.all(ids.map(async (id) => {
    const index = await caaIndex(id).catch(lost);
    return { id, picks: scans.scanPicks(index && index.images) };
  }));
  const picks = scans.bestScans(found, releaseId || null);
  if (!picks.length && failed) throw new Error('booklet scans: lookup failed');
  const got = await Promise.all(picks.map(async (p) => {
    let art = await fetchImageDataUrl(p.url, 60000).catch(() => null);
    if (!art) { failed = true; return null; }
    let img = nativeImage.createFromDataURL(art);
    const LONG = 1600; // (an original can be 5000 px: past this a page looks no sharper)
    if (Math.max(img.getSize().width, img.getSize().height) > LONG) {
      img = img.getSize().width >= img.getSize().height ? img.resize({ width: LONG, quality: 'best' }) : img.resize({ height: LONG, quality: 'best' });
      art = `data:image/jpeg;base64,${img.toJPEG(88).toString('base64')}`;
    }
    const { width, height } = img.getSize();
    return { art, kind: p.kind, width, height };
  }));
  if (failed && got.some((g) => !g)) throw new Error('booklet scans: a page did not come');
  return got.filter(Boolean);
}
/** A cover for the Tags panel, by address (the Cover Art Archive's, from lookupTags). → data URL or null. */
async function coverFromUrl(url) {
  if (!/^https:\/\/coverartarchive\.org\//.test(url)) return null;
  return fetchImageDataUrl(url).catch(() => null);
}

/**
 * The cover for { artist, title, album, guessed } (or a plain name string). A song whose tags name its album gets
 * that album's cover first — searching for the song finds it on remix albums and best-ofs too, and those can come
 * first. Otherwise every guess from nameVariants() on iTunes, Deezer and Spotify, trusting a hit whose title and
 * artist match that guess — and reporting the guess (`name`), so a file named "Title - Artist" can be shown the right
 * way round. Then MusicBrainz, for every guess that has an artist. If nothing matches, the first iTunes/Deezer hit for
 * the name as given is used, as before (no `name` then).
 */
async function findCover(name) {
  let networkError = false, fallback = null;
  if (name && typeof name === 'object' && name.artist && name.album && !name.guessed) {
    const album = await findAlbumCoverUrl({ artist: name.artist, album: name.album }).catch(() => ({ networkError: true }));
    if (album && album.url) {
      const cover = await fetchImageDataUrl(album.url).catch(() => null);
      if (cover) return { cover, url: album.url, source: album.source, name: { artist: name.artist, title: name.title } };
    }
    if (album && album.networkError) networkError = true;
  }
  const variants = variantsOf(name);
  for (const v of variants) {
    for (const [label, art] of COVER_SOURCES) {
      let hit = null;
      try { hit = await art(searchText(v)); } catch { networkError = true; }
      if (!hit) continue;
      if (sameSong(hit, v.artist, v.title)) {
        const cover = await fetchImageDataUrl(hit.url).catch(() => null);
        if (cover) return { cover, url: hit.url, source: label, name: v };
      // (the last resort: a hit that isn't the song — but never another artist's, when the artist is known: for
      // MEGATERA･ZERO's オノガミ iTunes has only a karaoke studio's single of it)
      } else if (!fallback && label !== 'SPOTIFY' && (!v.artist || wordOverlapRatio(v.artist, hit.artist) >= 0.5)) fallback = { hit, label };
    }
  }
  const album = typeof name === 'object' && name ? name.album : null;
  for (const v of variants.filter((x) => x.artist)) {
    try {
      const found = await musicBrainzArt({ ...v, album: v.artist === name.artist ? album : null });
      if (found) return { ...found, source: 'MUSICBRAINZ', name: v };
    } catch { networkError = true; }
  }
  if (fallback) {
    const cover = await fetchImageDataUrl(fallback.hit.url).catch(() => null);
    if (cover) return { cover, url: fallback.hit.url, source: fallback.label };
  }
  return { cover: null, source: null, networkError };
}

// ---- Album covers, for the shelf ------------------------------------------------------------------------------------

// A hit is this album when its title and this one share most of their words both ways (an edition in brackets
// aside), and it's by this artist — so a song's other album, or another band's album of the same name, never is.
function sameAlbum(hit, artist, album) {
  const a = bareTitle(album), b = bareTitle(hit.title);
  return wordOverlapRatio(a, b) >= 0.5 && wordOverlapRatio(b, a) >= 0.5 && wordOverlapRatio(artist, hit.artist) >= 0.5;
}
async function itunesAlbums(query) {
  const json = await fetchJson(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=10`);
  return (json.results || []).filter((r) => r.artworkUrl100)
    .map((r) => ({ url: r.artworkUrl100.replace('100x100bb', '600x600bb'), title: r.collectionName || '', artist: r.artistName || '' }));
}
async function deezerAlbums(query) {
  const json = await fetchJson(`https://api.deezer.com/search/album?q=${encodeURIComponent(query)}&limit=10`);
  return (json.data || []).filter((r) => r.cover_xl).map((r) => ({ url: r.cover_xl, title: r.title || '', artist: r.artist ? r.artist.name : '' }));
}
async function musicBrainzAlbums({ artist, album }) {
  const json = await musicBrainz('release-group', `releasegroup:${phrase(album)} AND artist:${phrase(artist)}`);
  return (json['release-groups'] || []).filter((g) => g.score >= 90)
    .map((g) => ({ url: `https://coverartarchive.org/release-group/${g.id}/front-500`, title: g.title || '', artist: credited(g) }));
}
const ALBUM_SOURCES = [['ITUNES', (q) => itunesAlbums(`${q.artist} ${q.album}`)], ['DEEZER', (q) => deezerAlbums(`${q.artist} ${q.album}`)], ['MUSICBRAINZ', musicBrainzAlbums]];

/**
 * Where the cover of the album { artist, album } is: the first hit on iTunes, Deezer, then MusicBrainz that is this
 * album. → { url, source }, null when none of them has it, or { networkError: true } when one couldn't be asked.
 */
async function findAlbumCoverUrl({ artist, album }) {
  let networkError = false;
  for (const [source, search] of ALBUM_SOURCES) {
    let hits = [];
    try { hits = await search({ artist, album }); } catch { networkError = true; }
    const hit = hits.find((h) => sameAlbum(h, artist, album));
    if (hit) return { url: hit.url, source };
  }
  return networkError ? { networkError: true } : null;
}
/** The album's cover itself, for the shelf. → { cover (data URL) } / { cover: null, networkError? }. */
async function findAlbumCover(query) {
  const found = await findAlbumCoverUrl(query);
  if (!found || found.networkError) return { cover: null, networkError: !!(found && found.networkError) };
  try { return { cover: await fetchImageDataUrl(found.url), source: found.source }; } catch { return { cover: null, networkError: true }; }
}

// Just the web address of a song's cover, for Discord (which only shows pictures by address) when the cover is inside
// the file. Stricter than findCover: only a hit matching a guess that has an artist, never a fallback — iTunes happily
// answers "Nova Drift – Solar Flare" with another band's Solar Flare, and that must not show on someone's profile.
// Answers are remembered for the session, but not after a network error. → url or null.
const coverUrls = new Map();
async function findCoverUrl(name) {
  const key = `${name.artist || ''}\n${name.title || ''}\n${!!name.guessed}`;
  if (!name.title) return null;
  if (coverUrls.has(key)) return coverUrls.get(key);
  let url = null, networkError = false;
  search: for (const v of nameVariants(name).filter((x) => x.artist)) {
    for (const [, art] of COVER_SOURCES.slice(0, 2)) {
      try {
        const hit = await art(searchText(v));
        if (hit && sameSong(hit, v.artist, v.title)) { url = hit.url; break search; }
      } catch { networkError = true; }
    }
  }
  if (url || !networkError) {
    if (coverUrls.size >= 500) coverUrls.delete(coverUrls.keys().next().value);
    coverUrls.set(key, url);
  }
  return url;
}

// ---- Lyrics ---------------------------------------------------------------------------------------------------

// The entry with lyrics whose length is closest to the file's (a radio edit and an extended mix have different
// timings), among those that are this song. → { lyrics, entry } or null.
function pickLrclib(json, { artist, title, duration }) {
  const entries = (Array.isArray(json) ? json : [json]).filter((e) => e && (e.syncedLyrics || e.plainLyrics)
    && sameLyricsSong({ title: e.trackName || e.name || '', artist: e.artistName || '' }, artist, title));
  if (!entries.length) return null;
  if (duration > 0) entries.sort((x, y) => Math.abs((x.duration || 0) - duration) - Math.abs((y.duration || 0) - duration));
  return entries[0].syncedLyrics || entries[0].plainLyrics;
}

// Unison (the lyrics Better Lyrics users time by hand, as TTML): only when its song is this one and, when both lengths
// are known, its recording is within a few seconds of the file — so the lines land on the right beat. → LRC or null.
const UNREACHABLE = Symbol('unreachable'); // Unison didn't answer at all (offline, a timeout): don't ask it again
async function unisonLyrics({ artist, title, album, duration }) {
  if (!artist) return null;
  let url = `https://unison.boidu.dev/lyrics?song=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`;
  if (album) url += `&album=${encodeURIComponent(album)}`;
  if (duration > 0) url += `&duration=${Math.round(duration)}`;
  let json;
  try { json = await fetchJson(url); } catch (e) { return e && e.status ? null : UNREACHABLE; } // 404 = nobody has written them yet
  const data = json && json.data;
  if (!data || typeof data.lyrics !== 'string' || !sameLyricsSong({ title: data.song || '', artist: data.artist || '' }, artist, title)) return null;
  if (data.format === 'lrc') return data.lyrics.trim() || null;
  if (data.format !== 'ttml') return null;
  const length = ttmlDuration(data.lyrics) || data.duration;
  if (duration > 0 && length > 0 && Math.abs(length - duration) > 4) return null;
  return ttmlToLrc(data.lyrics) || null;
}

const wordTimed = (lrc) => /<\d{1,3}:\d{2}/.test(lrc);

// lrclib.net lets in some twenty requests at once, then two a second; a 429 is "in a moment" (Retry-After: a second),
// not "no lyrics" — for everyone asking, as they're counted together.
let lrclibFrom = 0;
async function lrclib(pathAndQuery, tries = 5) {
  const wait = lrclibFrom - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait + Math.random() * 400)); // (not all at once again)
  try {
    return await fetchJson(`https://lrclib.net/api/${pathAndQuery}`);
  } catch (e) {
    if (e.status !== 429 || tries <= 1) throw e;
    lrclibFrom = Math.max(lrclibFrom, Date.now() + Math.min(e.retryAfter || 1, 5) * 1000);
    return lrclib(pathAndQuery, tries - 1);
  }
}
// Its exact entry for the name as given (with album and length). → { lyrics, name, source } or null.
async function lrclibExact(first, { album, duration }) {
  if (!first.artist) return null;
  let q = `get?track_name=${encodeURIComponent(first.title)}&artist_name=${encodeURIComponent(first.artist)}`;
  if (album) q += `&album_name=${encodeURIComponent(album)}`;
  if (duration > 0) q += `&duration=${Math.round(duration)}`;
  const lyrics = await lrclib(q).then((json) => pickLrclib(json, { ...first, duration })).catch(() => null); // (404 = no exact match)
  return lyrics ? { lyrics, name: first, source: 'lrclib.net' } : null;
}
// A search of it for every guess. → { lyrics, name, source } or null.
async function lrclibSearch(variants, { duration }) {
  for (const v of variants) {
    const q = `search?track_name=${encodeURIComponent(v.title)}${v.artist ? `&artist_name=${encodeURIComponent(v.artist)}` : ''}`;
    const lyrics = await lrclib(q).then((json) => pickLrclib(json, { ...v, duration })).catch(() => null);
    if (lyrics) return { lyrics, name: v, source: 'lrclib.net' };
  }
  return null;
}
/**
 * A booklet's: lrclib's when it has them — it answers in a tenth of a second, and print has no use for word timing —
 * by one search a song (an album's are asked for all together); else findLyrics'. → { lyrics, source } or null.
 */
async function findBookletLyrics(q) {
  const variants = nameVariants(q);
  const got = (variants.length ? await lrclibSearch(variants, q) : null) || await findLyrics(q);
  return got ? { lyrics: got.lyrics, source: got.source } : null;
}

/**
 * Lyrics for { title, artist, album, duration, guessed }: word-timed first — Karaoke fills them word by word —
 * Unison's (timed by hand, with duets and backing vocals), then NetEase Music's, then Kugou's (checked against
 * lrclib's line timing). Otherwise lrclib.net's exact entry for the name as given (with album and length), then a
 * search for every guess from nameVariants(), then Unison's line-timed lyrics, then a free-text lrclib search. Only entries that are this song count. → { lyrics, name, source } (name = the guess that found
 * them) or null.
 */
async function findLyrics({ title, artist, album, duration, guessed }) {
  const variants = nameVariants({ artist, title, guessed });
  if (!variants.length) return null;
  const first = variants[0];
  let unisonLines = null;
  for (const v of variants.filter((x) => x.artist)) {
    const lyrics = await unisonLyrics({ ...v, album: v.artist === artist ? album : null, duration });
    if (lyrics === UNREACHABLE) break;
    if (lyrics && wordTimed(lyrics)) return { lyrics, name: v, source: 'Unison' };
    if (lyrics && !unisonLines) unisonLines = { lyrics, name: v, source: 'Unison' };
  }
  const { neteaseLyrics } = require('./netease');
  for (const v of variants.filter((x) => x.artist)) {
    const lyrics = await neteaseLyrics({ ...v, duration });
    if (lyrics === neteaseLyrics.UNREACHABLE) break;
    if (lyrics) return { lyrics, name: v, source: 'NetEase' };
  }
  // lrclib's (timed by the line) — which Kugou's word timing is checked against (else Unison's), as Kugou's versions vary.
  const lined = await lrclibExact(first, { album, duration }) || await lrclibSearch(variants, { duration });
  const { kugouLyrics } = require('./kugou');
  for (const v of variants.filter((x) => x.artist)) {
    const lyrics = await kugouLyrics({ ...v, duration, reference: (lined || unisonLines || {}).lyrics });
    if (lyrics === kugouLyrics.UNREACHABLE) break;
    if (lyrics) return { lyrics, name: v, source: 'Kugou' };
  }
  if (lined) return lined;
  if (unisonLines) return unisonLines;
  try {
    const lyrics = pickLrclib(await lrclib(`search?q=${encodeURIComponent(searchText(first))}`), { ...first, duration });
    if (lyrics) return { lyrics, name: first, source: 'lrclib.net' };
  } catch { /* nothing */ }
  return null;
}

module.exports = { bareAlbum, shorterTitles, findDiscArt, findBookletScans, fetchJson, musicBrainzAlbum, sameSong, hiddenNameFrom, findHiddenName, findCover, findCoverUrl, findAlbumCover, findAlbumCoverUrl, findLyrics, findBookletLyrics, lookupTags, pickRecording, coverFromUrl, mbFetch, mbOnce, wordOverlapRatio, sameLyricsSong };
