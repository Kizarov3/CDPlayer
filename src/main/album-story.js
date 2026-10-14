'use strict';
/**
 * The booklet's "About the album" pages: the introduction of the album's Wikipedia article, in the interface's language
 * (else English), and the date the album first came out. Found through MusicBrainz — the album's release group links
 * to its Wikidata item, which names its article in each language — not by searching Wikipedia for the title, which
 * for "Issues" or "Ten" would find anything. Kept in album-stories.json for 30 days, "no article" too.
 */
const store = require('./store');
const { sameName } = require('./same-name');

const CACHE_FILE = 'album-stories.json';
const DAY = 86400e3, KEEP_DAYS = 30, MAX_PARAGRAPHS = 8;
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

const articleUrl = (lang, title) => `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

function createAlbumStory({ mbFetch, fetchJson, findGroup, read = () => store.readText(CACHE_FILE), write = (text) => store.writeText(CACHE_FILE, text), now = Date.now }) {
  let cache = null;
  const entries = () => {
    if (!cache) { try { const c = JSON.parse(read() || ''); cache = c && c.version === 1 && c.entries ? c.entries : {}; } catch { cache = {}; } }
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
    const group = await findGroup({ artist, album, title });
    return group ? group.id : null;
  }

  // The article's language and title, from the release group's own links: Wikidata (every language), or Wikipedia.
  async function articleFor(group, lang) {
    const rels = group.relations || [];
    const wikidata = rels.map((r) => /wikidata\.org\/wiki\/(Q\d+)/.exec((r.url && r.url.resource) || '')).find(Boolean);
    if (wikidata) {
      const json = await wikiJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wikidata[1]}&props=sitelinks&format=json`);
      const links = ((json.entities || {})[wikidata[1]] || {}).sitelinks || {};
      for (const l of [lang, 'en']) if (links[`${l}wiki`]) return { lang: l, title: links[`${l}wiki`].title };
      return null;
    }
    const wikipedia = rels.map((r) => /^https?:\/\/(\w+)\.wikipedia\.org\/wiki\/(.+)$/.exec((r.url && r.url.resource) || '')).find(Boolean);
    return wikipedia ? { lang: wikipedia[1], title: decodeURIComponent(wikipedia[2]).replace(/_/g, ' ') } : null;
  }

  async function lookUp(query, lang) {
    const id = await groupIdFor(query);
    if (!id) return null;
    const group = await mbFetch(`release-group/${id}?inc=url-rels&fmt=json`);
    const article = await articleFor(group, lang);
    if (!article) return null;
    const json = await wikiJson(`https://${article.lang}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&formatversion=2&titles=${encodeURIComponent(article.title)}`);
    const page = ((json.query || {}).pages || [])[0] || {};
    const paragraphs = cleanExtract(page.extract);
    if (!paragraphs.length) return null;
    const title = page.title || article.title;
    return { title, paragraphs, released: group['first-release-date'] || null, lang: article.lang, url: articleUrl(article.lang, title) };
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
    if (known && now() - known.fetched < KEEP_DAYS * DAY) return known.story;
    const story = await lookUp(query, lang);
    entries()[key] = { fetched: now(), story };
    write(JSON.stringify({ version: 1, entries: cache }));
    return story;
  }

  return { storyFor };
}

module.exports = { createAlbumStory, cleanExtract };
