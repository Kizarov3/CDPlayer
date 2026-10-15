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
    if (q.startsWith('release-group?')) return { 'release-groups': [{ id: GROUP, title: 'Issues', score: 100, 'primary-type': 'Album', 'secondary-types': [], 'artist-credit': [{ name: 'Korn' }] }] };
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
    url: 'https://ru.wikipedia.org/wiki/Issues_(%D0%B0%D0%BB%D1%8C%D0%B1%D0%BE%D0%BC)', kind: 'Album',
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

// ---- Finding the album by its name (the shelf's albums mostly have no MusicBrainz ID in their tags) ----
const { searchTitle, pickGroup } = require('../src/main/album-story');
const rg = (id, title, type, extra = {}) => ({ id, title, score: 100, 'primary-type': type, 'secondary-types': [], 'artist-credit': [{ name: 'System Of A Down' }], ...extra });

test('an edition\'s words are left out of the name searched for', () => {
  assert.strictEqual(searchTitle('Countdown To Extinction (Deluxe Edition - Remastered)'), 'Countdown To Extinction');
  assert.strictEqual(searchTitle('Nevermind (Remastered)'), 'Nevermind');
  assert.strictEqual(searchTitle('In Utero (Super Deluxe Edition)'), 'In Utero');
  assert.strictEqual(searchTitle('In Rainbows (Disk 2)'), 'In Rainbows');
  assert.strictEqual(searchTitle('Kill \'Em All [Remastered 2016]'), 'Kill \'Em All');
  assert.strictEqual(searchTitle('High & Dry / Planet Telex'), 'High & Dry / Planet Telex');
  assert.strictEqual(searchTitle('Street Spirit (Fade Out)'), 'Street Spirit (Fade Out)', 'brackets that are part of the name stay');
});

test('the album, not the single of the same name; an EP when that\'s what it is', () => {
  const single = rg('s', 'Toxicity', 'Single'), album = rg('a', 'Toxicity', 'Album'), live = rg('l', 'Toxicity', 'Album', { 'secondary-types': ['Live'] });
  assert.strictEqual(pickGroup([single, live, album], { artist: 'System Of A Down', album: 'Toxicity' }).id, 'a');
  const ep = rg('e', 'My Iron Lung', 'EP', { 'artist-credit': [{ name: 'Radiohead' }] }), song = rg('x', 'My Iron Lung', 'Single', { 'artist-credit': [{ name: 'Radiohead' }] });
  assert.strictEqual(pickGroup([song, ep], { artist: 'Radiohead', album: 'My Iron Lung' }).id, 'e');
  assert.strictEqual(pickGroup([rg('o', 'Toxicity', 'Album', { 'artist-credit': [{ name: 'Someone Else' }] })], { artist: 'System Of A Down', album: 'Toxicity' }), null, 'another artist\'s');
  assert.strictEqual(pickGroup([rg('b', 'Toxicity Live in Berlin', 'Album')], { artist: 'System Of A Down', album: 'Toxicity' }), null, 'another title');
});

test('an album named in the tags is never looked for by a song instead', async () => {
  const asked = [];
  const mbFetch = async (q) => { asked.push(q); if (q.startsWith('release-group?')) return { 'release-groups': [] }; throw Object.assign(new Error('HTTP 404'), { status: 404 }); };
  const story = createAlbumStory({ mbFetch, fetchJson: async () => ({}), findGroup: async () => { throw new Error('the song search must not run'); }, read: () => null, write: () => {} });
  assert.strictEqual(await story.storyFor({ artist: 'Megadeth', album: 'Countdown To Extinction (Deluxe Edition - Remastered)', lang: 'en' }), null);
  assert.ok(asked.some((q) => decodeURIComponent(q).includes('"Countdown To Extinction"')), 'searched without the edition');
});

test('a single or an EP says what it is (its article is the song\'s too); an article about something else isn\'t taken', async () => {
  const run = async (groupBody, sitelinks) => {
    const mbFetch = async (q) => { if (q.startsWith(`release-group/${GROUP}`)) return { id: GROUP, 'first-release-date': '1995', relations: [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q1' } }], ...groupBody }; throw new Error('?'); };
    const fetchJson = async (url) => (url.includes('wikidata') ? { entities: { Q1: { sitelinks } } } : { query: { pages: [{ title: decodeURIComponent(/titles=([^&]+)/.exec(url)[1]), extract: 'Some text.' }] } });
    return createAlbumStory({ mbFetch, fetchJson, findGroup: async () => null, read: () => null, write: () => {} }).storyFor({ groupId: GROUP, lang: 'ru' });
  };
  const single = await run({ title: 'Fake Plastic Trees', 'primary-type': 'Single' }, { enwiki: { title: 'Fake Plastic Trees' }, ruwiki: { title: 'Fake Plastic Trees' } });
  assert.strictEqual(single.kind, 'Single');
  assert.strictEqual((await run({ title: 'My Iron Lung', 'primary-type': 'EP' }, { enwiki: { title: 'My Iron Lung' } })).kind, 'EP');
  assert.strictEqual(await run({ title: 'The Essential Korn', 'primary-type': 'Album' }, { enwiki: { title: 'Korn discography' } }), null, 'a discography is not the album');
  const ru = await run({ title: 'Hybrid Theory', 'primary-type': 'Album' }, { enwiki: { title: 'Hybrid Theory' }, ruwiki: { title: 'Гибридная теория' } });
  assert.strictEqual(ru.title, 'Гибридная теория', 'a Russian title is checked through the English one');
  assert.ok(await run({ title: 'OK Computer OKNOTOK 1997 2017', 'primary-type': 'Album' }, { enwiki: { title: 'OK Computer' } }), 'a reissue may have the original\'s article');
});
