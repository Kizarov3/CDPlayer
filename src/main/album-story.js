'use strict';
/**
 * The booklet's "About the album" pages: the introduction of the album's Wikipedia article, in the interface's language
 * (else English), and the date the album first came out. Found through MusicBrainz — the album's release group links
 * to its Wikidata item, which names its article in each language — not by searching Wikipedia for the title, which
 * for "Issues" or "Ten" would find anything. Kept in album-stories.json for 30 days, "no article" for 7.
 */
const store = require('./store');
const { sameName } = require('./same-name');

const CACHE_FILE = 'album-stories.json';
const DAY = 86400e3, KEEP_DAYS = 30, NONE_DAYS = 7, MAX_PARAGRAPHS = 8;
// 2: albums found by their own name (not by a song), and an article checked to be about the release.
const CACHE_VERSION = 2;
const MBID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const WIKI_USER_AGENT = 'CDPlayer/2 ( https://github.com/Kizarov3/CDPlayer )';

/** Wikipedia's plain-text introduction → its paragraphs, without pronunciations, empty brackets or what follows a heading. */
function cleanExtract(text) {
  const out = [];
  for (const line of String(text || '').split(/\n+/)) {
    if (/^\s*==/.test(line)) break;
    const p = line
      .replace(/\(\s*\/[^/)]+\/\s*[;,]?\s*/g, '(') // "(/kɔːrn/; stylized as KoЯn)" → "(stylized as KoЯn)"
      .replace(/\s*\(\s+[^()]*\)/g, '')            // "( AH-ni-mə)": a pronunciation whose IPA was stripped
      .replace(/\s*\(\s*[;,]?\s*\)/g, '')          // "()" left behind
      .replace(/\s+([.,;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
    if (p) out.push(p);
    if (out.length >= MAX_PARAGRAPHS) break;
  }
  return out;
}

// ---- Finding the album by name: a shelf album's tags rarely hold its MusicBrainz ID ----

// An edition's words in brackets, or after " - ": "(Deluxe Edition - Remastered)", "[Remastered 2016]", "(Disk 2)".
const EDITION = /\s*[([][^)\]]*\b(deluxe|remaster(ed)?|edition|expanded|anniversary|bonus|disc|disk|cd\s*\d|super|reissue|mono|stereo)\b[^)\]]*[)\]]/gi;
const EDITION_TAIL = /\s+-\s+[^-]*\b(remaster(ed)?|deluxe|edition|anniversary)\b.*$/i;
/** The album's name as MusicBrainz knows it: without the edition it came in. */
function searchTitle(album) {
  const s = String(album || '').replace(EDITION, ' ').replace(EDITION_TAIL, '').replace(/\s+/g, ' ').trim();
  return s || String(album || '').trim();
}
const TYPE_RANK = { Album: 0, EP: 1, Single: 2 };
const creditNames = (g) => { const c = g['artist-credit'] || []; return [...c.map((x) => x.name), c.map((x) => `${x.name}${x.joinphrase || ''}`).join('')]; };
/**
 * Of MusicBrainz's release groups found by name, the album itself: the same title (editions aside) by the same
 * artist; a studio release before a live one or a compilation, an album before an EP before a single — so "Toxicity"
 * is the album, not the single, and an EP is the EP. null when none is it.
 */
function pickGroup(groups, { artist, album }) {
  const title = sameName(searchTitle(album)), who = sameName(artist);
  const fits = (groups || []).filter((g) => (g.score == null || g.score >= 85) && sameName(searchTitle(g.title)) === title
    && (!who || creditNames(g).some((n) => sameName(n) === who)));
  const rank = (g) => [(g['secondary-types'] || []).length ? 1 : 0, TYPE_RANK[g['primary-type']] ?? 3, -(g.score || 0)];
  fits.sort((a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
  return fits[0] || null;
}
const phrase = (text) => `"${String(text).replace(/[\\"]/g, '\\$&')}"`;

// An article's name and a release's are the same thing: "Ten (Pearl Jam album)" is Ten; a reissue may have the original's.
function namesMatch(article, release) {
  const a = sameName(String(article).replace(/\s*\([^)]*\)\s*$/, '')), b = sameName(searchTitle(release));
  return a === b || (a.length >= 3 && b.includes(a)) || (b.length >= 3 && a.includes(b));
}

const articleUrl = (lang, title) => `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

function createAlbumStory({ mbFetch, fetchJson, findGroup, read = () => store.readText(CACHE_FILE), write = (text) => store.writeText(CACHE_FILE, text), now = Date.now }) {
  let cache = null;
  const entries = () => {
    if (!cache) { try { const c = JSON.parse(read() || ''); cache = c && c.version === CACHE_VERSION && c.entries ? c.entries : {}; } catch { cache = {}; } }
    return cache;
  };
  const wikiJson = (url) => fetchJson(url, { headers: { 'User-Agent': WIKI_USER_AGENT } });

  async function groupIdFor({ groupId, releaseId, artist, album, title }) {
    if (MBID.test(groupId || '')) return groupId.toLowerCase();
    if (MBID.test(releaseId || '')) {
      const release = await mbFetch(`release/${releaseId}?inc=release-groups&fmt=json`);
      return (release['release-group'] || {}).id || null;
    }
    if (!artist || !(album || title)) return null;
    if (album) {
      // By the album's own name only: a search by one of its songs could land on that song's single.
      const json = await mbFetch(`release-group?query=${encodeURIComponent(`releasegroup:${phrase(searchTitle(album))} AND artist:${phrase(artist)}`)}&fmt=json&limit=25`);
      const group = pickGroup(json['release-groups'], { artist, album });
      return group ? group.id : null;
    }
    const group = await findGroup({ artist, title }); // no album in the tags: the album its song is on
    return group ? group.id : null;
  }

  // The article's language and title, from the release group's own links: Wikidata (every language), or Wikipedia.
  async function articleFor(group, lang) {
    const rels = group.relations || [];
    const wikidata = rels.map((r) => /wikidata\.org\/wiki\/(Q\d+)/.exec((r.url && r.url.resource) || '')).find(Boolean);
    if (wikidata) {
      const json = await wikiJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidata[1]}&props=sitelinks&format=json`);
      const links = ((json.entities || {})[wikidata[1]] || {}).sitelinks || {};
      const english = links.enwiki ? links.enwiki.title : null; // to tell what the article is about, whatever language it's read in
      for (const l of [lang, 'en']) if (links[`${l}wiki`]) return { lang: l, title: links[`${l}wiki`].title, english };
      return null;
    }
    const wikipedia = rels.map((r) => /^https?:\/\/(\w+)\.wikipedia\.org\/wiki\/(.+)$/.exec((r.url && r.url.resource) || '')).find(Boolean);
    if (!wikipedia) return null;
    const title = decodeURIComponent(wikipedia[2]).replace(/_/g, ' ');
    return { lang: wikipedia[1], title, english: wikipedia[1] === 'en' ? title : null };
  }

  async function lookUp(query, lang) {
    const id = await groupIdFor(query);
    if (!id) return null;
    const group = await mbFetch(`release-group/${id}?inc=url-rels&fmt=json`);
    const article = await articleFor(group, lang);
    if (!article) return null;
    // The article has to be about this release (a compilation's link can lead to the band's discography).
    const named = article.english || (article.lang === 'en' ? article.title : null);
    if (named && group.title && !namesMatch(named, group.title)) return null;
    const json = await wikiJson(`https://${article.lang}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(article.title)}`);
    const page = ((json.query || {}).pages || [])[0] || {};
    const paragraphs = cleanExtract(page.extract);
    if (!paragraphs.length) return null;
    const title = page.title || article.title;
    // kind: what the release is (Album, EP, Single) — a single's article is its song's, and the booklet says so.
    return { title, paragraphs, released: group['first-release-date'] || null, lang: article.lang, url: articleUrl(article.lang, title), kind: group['primary-type'] || 'Album' };
  }

  /**
   * { groupId | releaseId | artist + album (or title), lang } → { title, paragraphs, released, lang, url } or null
   * when the album has no article. Throws when it couldn't be asked (and nothing is remembered).
   */
  async function storyFor(query) {
    const lang = String(query.lang || 'en').split('-')[0].toLowerCase();
    const which = MBID.test(query.groupId || '') ? `g:${query.groupId}` : MBID.test(query.releaseId || '') ? `r:${query.releaseId}`
      : `n:${sameName(query.artist || '')}|${sameName(query.album || query.title || '')}`;
    const key = `${lang}|${which}`;
    const known = entries()[key];
    if (known && now() - known.fetched < (known.story ? KEEP_DAYS : NONE_DAYS) * DAY) return known.story;
    const story = await lookUp(query, lang);
    entries()[key] = { fetched: now(), story };
    write(JSON.stringify({ version: CACHE_VERSION, entries: cache }));
    return story;
  }

  return { storyFor };
}

module.exports = { createAlbumStory, cleanExtract, searchTitle, pickGroup };
