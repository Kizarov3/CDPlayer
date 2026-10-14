'use strict';
// The booklet's "About the album" pages: MusicBrainz → Wikidata → Wikipedia, against canned answers (no network).
const test = require('node:test');
const assert = require('node:assert');
const { createAlbumStory, cleanExtract } = require('../src/main/album-story');

const GROUP = 'c7497ce4-c746-3a75-946e-daa8ab117c47';
const EXTRACT = 'Issues is the fourth studio album by American nu metal band Korn (/kɔːrn/; stylized as KoЯn), released on November 16, 1999.\n\n\nIt was produced by Brendan O\'Brien.\n== Background ==\nIgnored.';

function world({ groupRels = [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q1145781' } }], sitelinks = { enwiki: { title: 'Issues (Korn album)' }, ruwiki: { title: 'Issues (альбом)' } }, extract = EXTRACT } = {}) {
  const asked = [];
  const mbFetch = async (q) => {
    asked.push(`mb:${q}`);
    if (q.startsWith(`release-group/${GROUP}`)) return { id: GROUP, title: 'Issues', 'first-release-date': '1999-11-16', relations: groupRels };
    if (q.startsWith('release/11111111-2222-3333-4444-555555555555')) return { id: '11111111-2222-3333-4444-555555555555', 'release-group': { id: GROUP } };
    throw Object.assign(new Error('HTTP 404'), { status: 404 });
  };
  const fetchJson = async (url) => {
    asked.push(url);
    if (url.includes('wikidata.org')) return { entities: { Q1145781: { sitelinks } } };
    const m = /^https:\/\/(\w+)\.wikipedia\.org\/.*titles=([^&]+)/.exec(url);
    if (m) return { query: { pages: [{ title: decodeURIComponent(m[2]), extract: m[1] === 'ru' ? 'Issues — четвёртый студийный альбом группы Korn.' : extract }] } };
    throw new Error('unexpected ' + url);
  };
  let saved = null;
  const story = createAlbumStory({ mbFetch, fetchJson, findGroup: async () => ({ id: GROUP }), read: () => saved, write: (text) => { saved = text; }, now: () => 1000 });
  return { story, asked, saved: () => saved };
}

test('Wikipedia\'s introduction to the album, in the interface\'s language, with the date it came out', async () => {
  const { story } = world();
  const got = await story.storyFor({ groupId: GROUP, lang: 'ru' });
  assert.deepStrictEqual(got, {
    title: 'Issues (альбом)', paragraphs: ['Issues — четвёртый студийный альбом группы Korn.'], released: '1999-11-16', lang: 'ru',
    url: 'https://ru.wikipedia.org/wiki/Issues_(%D0%B0%D0%BB%D1%8C%D0%B1%D0%BE%D0%BC)',
  });
});

test('no article in that language: the English one', async () => {
  const { story } = world({ sitelinks: { enwiki: { title: 'Issues (Korn album)' } } });
  const got = await story.storyFor({ groupId: GROUP, lang: 'ru' });
  assert.strictEqual(got.lang, 'en');
  assert.deepStrictEqual(got.paragraphs, [
    'Issues is the fourth studio album by American nu metal band Korn (stylized as KoЯn), released on November 16, 1999.',
    'It was produced by Brendan O\'Brien.']);
});

test('found from a release ID or by name too; the album known to have no article is remembered', async () => {
  const { story, asked } = world({ groupRels: [] });
  assert.strictEqual(await story.storyFor({ releaseId: '11111111-2222-3333-4444-555555555555', lang: 'en' }), null);
  assert.ok(asked.some((u) => u.startsWith('mb:release/11111111-2222-3333-4444-555555555555')));
  const before = asked.length;
  assert.strictEqual(await story.storyFor({ releaseId: '11111111-2222-3333-4444-555555555555', lang: 'en' }), null);
  assert.strictEqual(asked.length, before, 'not asked again');
  assert.strictEqual(await story.storyFor({ artist: 'Korn', album: 'Issues', lang: 'en' }), null);
});

test('a found story is kept on disk; MusicBrainz unreachable is not remembered as "none"', async () => {
  const w = world();
  await w.story.storyFor({ groupId: GROUP, lang: 'en' });
  assert.match(w.saved(), /Brendan/);
  const offline = createAlbumStory({ mbFetch: async () => { throw new TypeError('fetch failed'); }, fetchJson: async () => ({}), findGroup: async () => null, read: () => null, write: () => { throw new Error('nothing to keep'); } });
  await assert.rejects(offline.storyFor({ groupId: GROUP, lang: 'en' }));
});

test('a Wikipedia link straight on the release group does without Wikidata', async () => {
  const { story, asked } = world({ groupRels: [{ type: 'wikipedia', url: { resource: 'https://en.wikipedia.org/wiki/Issues_(Korn_album)' } }] });
  const got = await story.storyFor({ groupId: GROUP, lang: 'en' });
  assert.strictEqual(got.title, 'Issues (Korn album)');
  assert.ok(!asked.some((u) => u.includes('wikidata')));
});

test('the introduction is cleaned: no pronunciations, empty brackets or section headings', () => {
  assert.deepStrictEqual(cleanExtract('A (/eɪ/; born 1990) b.\n\nC ().\n== Notes ==\nD'), ['A (born 1990) b.', 'C.']);
  assert.deepStrictEqual(cleanExtract('Ænima ( AH-ni-mə) is the second album (with Tool).'), ['Ænima is the second album (with Tool).']);
  assert.deepStrictEqual(cleanExtract(''), []);
});
