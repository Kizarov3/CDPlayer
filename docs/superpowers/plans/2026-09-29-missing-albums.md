# Missing Albums on the Shelf Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under SORT: ARTIST, each artist with two or more albums on the shelf gets a box (`…` / `+N MISSING` / `COMPLETE ★`) that opens into see-through places for their official releases you don't have; a place opens a ghost case with cover, tracklist, PLAY ON SPOTIFY, MUSICBRAINZ and NOT INTERESTED.

**Architecture:** `src/main/discography.js` looks up each artist's official release groups on MusicBrainz (through `online.js`'s shared, rate-limited `mbFetch`), one artist at a time from a queue the renderer fills with the artists whose boxes are on screen, cached 30 days in `discography.json`. `src/renderer/js/shelf-missing.js` (pure) works out what's missing and where boxes and places stand; `shelf.js` draws them and the ghost case. NOT INTERESTED goes in `missing-hidden.txt`.

**Tech Stack:** Electron 44 (main CommonJS, renderer ES modules), music-metadata, MusicBrainz WS/2 JSON, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-29-missing-albums-design.md`

## Global Constraints

- Only under SORT: ARTIST; only an album artist that isn't "Various Artists" with **≥ 2** albums on the shelf.
- Every official release group counts: albums of every kind, EPs **and singles** (`release-group-status=website-default`).
- Box texts exactly: `…`, `+N MISSING`, `COMPLETE ★`. Type labels exactly: `LIVE`, `COMP`, `OST`, `REMIX`, `EP`, `SINGLE`, none for a studio album. Single places 18 px wide, others 30 px.
- Cache: found discographies 30 days, unknown artists 7 days, network errors never cached.
- Every MusicBrainz request through `online.js`'s `mbFetch` (User-Agent + ≤ 1 request a second for the whole app).
- Ghost case buttons: `BACK ON THE SHELF`, `NOT INTERESTED`, `MUSICBRAINZ`, `PLAY ON SPOTIFY` (only while Spotify is connected). Messages: `COULDN'T REACH MUSICBRAINZ` (tracklist), `NOT ON SPOTIFY` (status line).
- Open boxes last only until the shelf closes. PULL ONE never picks a place.
- Commits in the repo's plain style, **no AI attribution lines** (user rule). Tests set `CDPLAYER_HOME` to a temp dir, never a real `~/.cdplayer`.

## Review Focus

1. An artist whose name MusicBrainz matches only by alias (e.g. tags say "Björk", or a transliterated name): must be found, not "unknown". (Task 3 test.)
2. An artist with more than 100 release groups (singles make this common): every page must be read, and a page shorter than 100 must end the loop even if `release-group-count` is off. (Task 3 test.)
3. The same album owned under punctuation/case differences ("OK Computer" vs "Ok Computer!") must not show as missing. (Task 4 test.)
4. Scrolling fast past many artists must not queue them all: artists off screen before their turn are dropped. (Task 3 test.)
5. A group with no year sorts last, not first, and an artist whose every release is hidden or owned shows `COMPLETE ★`. (Task 4 test.)

---

### Task 1: The album artist's MusicBrainz ID on the shelf

**Files:**
- Modify: `src/main/metadata.js:15-26` (`creditsFrom`)
- Create: `src/main/same-name.js` (the shelf's `sameName`, moved out so `discography.js` needn't load the shelf)
- Modify: `src/main/shelf.js` (`CACHE_VERSION`, `trackInfo`, `groupAlbums`, `sameName` from the new module)
- Test: `test/shelf.test.js`

**Interfaces:**
- Produces: every shelf album (from `groupAlbums`) has `artistMbid: string | null`; `require('./same-name').sameName(text) → string`.

- [ ] **Step 1: Write the failing tests** — append to `test/shelf.test.js`:

```js
test('an album knows its album artist\'s MusicBrainz ID when a track\'s tags have it', () => {
  const [a] = groupAlbums([
    t('/m/r/ok/1.mp3', { album: 'OK Computer', artist: 'Radiohead', albumArtist: 'Radiohead' }),
    t('/m/r/ok/2.mp3', { album: 'OK Computer', artist: 'Radiohead', albumArtist: 'Radiohead', artistMbid: 'a74b1b7f' }),
  ]);
  assert.strictEqual(a.artistMbid, 'a74b1b7f');
  assert.strictEqual(groupAlbums([t('/m/x/1.mp3', { album: 'X', artist: 'Y' })])[0].artistMbid, null);
});

test('sameName: how the shelf compares names', () => {
  const { sameName } = require('../src/main/same-name');
  assert.strictEqual(sameName('OK Computer'), sameName('ok computer!'));
  assert.strictEqual(sameName('Three Dollar Bill, Yall$'), sameName("THREE DOLLAR BILL Y'ALL$"));
  assert.strictEqual(sameName('!!!'), '!!!');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/shelf.test.js`
Expected: FAIL — `a.artistMbid` is `undefined`; `Cannot find module '../src/main/same-name'`.

- [ ] **Step 3: Implement**

In `src/main/metadata.js` `creditsFrom`, add to `out` (after `albumArtist`):

```js
    albumArtistMbid: first(c.musicbrainz_albumartistid),
```

(The booklet lists credits by name, so an extra key never shows there.)

In `src/main/shelf.js`:

```js
const CACHE_VERSION = 2; // bump when trackInfo() reads files differently, so old entries are read again
```

In `trackInfo`'s returned object add `artistMbid: c.albumArtistMbid || null,`.
In `groupAlbums`' album object (next to `year`) add:

```js
      artistMbid: g.items.map((t) => t.info.artistMbid).find(Boolean) || null,
```

Move `sameName` (and its comment) out of `shelf.js` into `src/main/same-name.js`:

```js
'use strict';
// A name as the shelf compares it: "Three Dollar Bill, Yall$" and "THREE DOLLAR BILL Y'ALL$" are the same album.
const sameName = (s) => { const low = String(s || '').toLowerCase(); return low.replace(/[^\p{L}\p{N}]+/gu, '') || low.trim(); };
module.exports = { sameName };
```

and in `shelf.js` replace the definition with `const { sameName } = require('./same-name');`.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all pass (if a metadata test compares `credits` with `deepStrictEqual`, it now also sees `albumArtistMbid` only when the file has one — none of the fixtures do).

- [ ] **Step 5: Commit**

```bash
git add src/main/metadata.js src/main/same-name.js src/main/shelf.js test/shelf.test.js
git commit -m "Shelf: an album knows its artist's MusicBrainz ID from the tags"
```

---

### Task 2: NOT INTERESTED, remembered

**Files:**
- Modify: `src/main/store.js` (`FILES`, new functions, exports)
- Test: `test/state.test.js`

**Interfaces:**
- Produces: `store.readHiddenMissing() → Set<string>`, `store.writeHiddenMissing(set)`.

- [ ] **Step 1: Write the failing test** — append to `test/state.test.js`:

```js
test('missing-hidden.txt: the release groups said NOT INTERESTED to, one per line', () => {
  store.writeHiddenMissing(new Set(['rg-1', 'rg-2']));
  assert.strictEqual(fs.readFileSync(path.join(home, 'missing-hidden.txt'), 'utf8'), 'rg-1\nrg-2\n');
  assert.deepStrictEqual(store.readHiddenMissing(), new Set(['rg-1', 'rg-2']));
  fs.writeFileSync(path.join(home, 'missing-hidden.txt'), '\n  rg-3  \n\n');
  assert.deepStrictEqual(store.readHiddenMissing(), new Set(['rg-3']));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/state.test.js`
Expected: FAIL — `store.writeHiddenMissing is not a function`.

- [ ] **Step 3: Implement** in `src/main/store.js`: add `hiddenMissing: 'missing-hidden.txt'` to `FILES`, then before `const HISTORY_LIMIT`:

```js
// missing-hidden.txt — a MusicBrainz release-group ID per line: missing albums the user said NOT INTERESTED to, so
// they don't stand on the shelf again. CDPlayer 2 only.
function readHiddenMissing() {
  return new Set(lines(readText(FILES.hiddenMissing)).map((l) => l.trim()).filter(Boolean));
}
function writeHiddenMissing(ids) {
  const body = [...ids].filter(Boolean);
  return writeText(FILES.hiddenMissing, body.join('\n') + (body.length ? '\n' : ''));
}
```

Export both.

- [ ] **Step 4: Run the tests** — `npm test`, all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/store.js test/state.test.js
git commit -m "Remember the missing albums said NOT INTERESTED to"
```

---

### Task 3: Discographies from MusicBrainz

**Files:**
- Create: `src/main/discography.js`
- Test: `test/discography.test.js`

**Interfaces:**
- Consumes: `online.mbFetch(pathAndQuery) → Promise<json>` (already exported), `store.readText/writeText`.
- Produces: `createDiscography({ mbFetch, read, write, now, onAnswer }) → { discographyFor({ artist, mbid }), want(artists), tracklist(groupId) }`; `onAnswer({ key, state: 'found' | 'unknown', groups })`; group `{ id, title, type, secondary: string[], year: string | null }`; track `{ title, length }` (seconds). Also the module's default instance: `module.exports = { createDiscography, artistKey }` where `artistKey = sameName`.

- [ ] **Step 1: Write the failing tests** — `test/discography.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const { createDiscography, artistKey } = require('../src/main/discography');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const DAY = 86400e3;
const group = (id, title, extra = {}) => ({ id, title, 'primary-type': 'Album', 'secondary-types': [], 'first-release-date': '1997-05-21', ...extra });
// MusicBrainz answered per request: [regex, json | Error] pairs; every request is recorded.
function mb(routes) {
  const asked = [];
  const fetch = async (q) => {
    asked.push(q);
    const route = routes.find(([re]) => re.test(q));
    if (!route) throw new Error(`unexpected ${q}`);
    if (route[1] instanceof Error) throw route[1];
    return typeof route[1] === 'function' ? route[1](q) : route[1];
  };
  return { fetch, asked };
}
function make(routes, { cache = '', now = 1000 * DAY } = {}) {
  const net = mb(routes);
  let saved = cache;
  const answers = [];
  const d = createDiscography({ mbFetch: net.fetch, read: () => saved, write: (t) => { saved = t; }, now: () => now, onAnswer: (a) => answers.push(a) });
  return { d, net, answers, saved: () => saved };
}

test('by the MusicBrainz ID from the tags: no search, every official release group', async () => {
  const { d, net } = make([[/^release-group\?artist=a74b/, { 'release-group-count': 2, 'release-groups': [group('rg1', 'OK Computer'), group('rg2', 'Creep', { 'primary-type': 'Single', 'first-release-date': '' })] }]]);
  const r = await d.discographyFor({ artist: 'Radiohead', mbid: 'a74b' });
  assert.strictEqual(r.state, 'found');
  assert.deepStrictEqual(r.groups, [
    { id: 'rg1', title: 'OK Computer', type: 'Album', secondary: [], year: '1997' },
    { id: 'rg2', title: 'Creep', type: 'Single', secondary: [], year: null },
  ]);
  assert.strictEqual(net.asked.length, 1);
  assert.match(net.asked[0], /release-group-status=website-default/);
});

test('by name: the result whose name, or one of its aliases, is the same', async () => {
  const { d } = make([
    [/^artist\?query=/, { artists: [{ id: 'dj', name: 'DJ Radiohead' }, { id: 'b1', name: 'Bjork Tribute' }, { id: 'bj', name: 'Björk Guðmundsdóttir', aliases: [{ name: 'Björk' }] }] }],
    [/^release-group\?artist=bj/, { 'release-group-count': 1, 'release-groups': [group('h', 'Homogenic')] }],
  ]);
  const r = await d.discographyFor({ artist: 'björk', mbid: null });
  assert.deepStrictEqual(r.groups.map((g) => g.id), ['h']);
});

test('nobody by that name: unknown, and asked again only after a week', async () => {
  const { d, net } = make([[/^artist\?query=/, { artists: [{ id: 'x', name: 'Someone Else' }] }]]);
  assert.deepStrictEqual(await d.discographyFor({ artist: 'Nova Drift', mbid: null }), { state: 'unknown', groups: [] });
  await d.discographyFor({ artist: 'Nova Drift', mbid: null });
  assert.strictEqual(net.asked.length, 1);
  const cached = make([[/^artist\?query=/, { artists: [] }]], { cache: JSON.stringify({ version: 1, artists: { [artistKey('Nova Drift')]: { mbid: null, fetched: 1000 * DAY - 8 * DAY, state: 'unknown', groups: [] } } }) });
  await cached.d.discographyFor({ artist: 'Nova Drift', mbid: null });
  assert.strictEqual(cached.net.asked.length, 1, 'more than a week old: asked again');
});

test('a found discography is kept 30 days', async () => {
  const entry = (age) => JSON.stringify({ version: 1, artists: { [artistKey('Tool')]: { mbid: 't', fetched: 1000 * DAY - age * DAY, state: 'found', groups: [{ id: 'l', title: 'Lateralus', type: 'Album', secondary: [], year: '2001' }] } } });
  const fresh = make([], { cache: entry(29) });
  assert.strictEqual((await fresh.d.discographyFor({ artist: 'Tool', mbid: 't' })).groups[0].id, 'l');
  const stale = make([[/^release-group\?artist=t/, { 'release-group-count': 0, 'release-groups': [] }]], { cache: entry(31) });
  assert.deepStrictEqual((await stale.d.discographyFor({ artist: 'Tool', mbid: 't' })).groups, []);
  assert.strictEqual(stale.net.asked.length, 1);
});

test('every page is read, and a short page ends it even if the count says more', async () => {
  const many = Array.from({ length: 250 }, (_, i) => group(`g${i}`, `Single ${i}`, { 'primary-type': 'Single' }));
  const { d, net } = make([[/^release-group\?artist=a/, (q) => {
    const offset = Number(/offset=(\d+)/.exec(q)[1]);
    return { 'release-group-count': 400, 'release-groups': many.slice(offset, offset + 100) };
  }]]);
  const r = await d.discographyFor({ artist: 'A', mbid: 'a' });
  assert.strictEqual(r.groups.length, 250);
  assert.deepStrictEqual(net.asked.map((q) => /offset=(\d+)/.exec(q)[1]), ['0', '100', '200']);
});

test('offline: nothing cached, so it is asked again next time', async () => {
  const { d, saved } = make([[/^artist\?query=/, new Error('ENOTFOUND')]]);
  await assert.rejects(d.discographyFor({ artist: 'Korn', mbid: null }));
  assert.strictEqual(saved(), '');
});

test('the queue: one at a time, answers told; an artist scrolled away before its turn is dropped', async () => {
  const { d, net, answers } = make([[/^release-group\?artist=/, { 'release-group-count': 0, 'release-groups': [] }]]);
  d.want([{ artist: 'A', mbid: 'a' }, { artist: 'B', mbid: 'b' }, { artist: 'C', mbid: 'c' }]);
  d.want([{ artist: 'A', mbid: 'a' }, { artist: 'D', mbid: 'd' }]); // B and C went off screen
  await new Promise((r) => setTimeout(r, 20));
  assert.deepStrictEqual(net.asked.map((q) => /artist=(\w)/.exec(q)[1]), ['a', 'd']);
  assert.deepStrictEqual(answers.map((a) => a.key), [artistKey('A'), artistKey('D')]);
});

test('a release group\'s tracklist, from its first official release', async () => {
  const { d, net } = make([[/^release\?release-group=rg1/, { releases: [{ media: [{ tracks: [{ title: 'Airbag', length: 284400 }] }, { tracks: [{ title: 'Lucky', length: null }] }] }] }]]);
  assert.deepStrictEqual(await d.tracklist('rg1'), [{ title: 'Airbag', length: 284.4 }, { title: 'Lucky', length: 0 }]);
  await d.tracklist('rg1');
  assert.strictEqual(net.asked.length, 1, 'kept for the session');
  assert.match(net.asked[0], /status=official&inc=recordings/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/discography.test.js`
Expected: FAIL — `Cannot find module '../src/main/discography'`.

- [ ] **Step 3: Implement** — `src/main/discography.js`:

```js
'use strict';
/**
 * Artists' discographies from MusicBrainz, for the shelf's missing albums: every official release group of an album
 * artist (albums of all kinds, EPs and singles), found by the MusicBrainz ID in the tags or else by name. Looked up
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
    if (mbid) return mbid;
    const json = await mbFetch(`artist?query=${encodeURIComponent(`artist:${phrase(artist)}`)}&fmt=json&limit=25`);
    const want = sameName(artist);
    const same = (a) => sameName(a.name) === want || (a.aliases || []).some((al) => sameName(al.name) === want);
    const hit = (json.artists || []).find(same);
    return hit ? hit.id : null;
  }
  async function releaseGroups(id) {
    const groups = [];
    for (let offset = 0; ; offset += PAGE) {
      const json = await mbFetch(`release-group?artist=${id}&release-group-status=website-default&limit=${PAGE}&offset=${offset}&fmt=json`);
      const page = json['release-groups'] || [];
      groups.push(...page.map(toGroup));
      if (page.length < PAGE || groups.length >= (json['release-group-count'] || 0)) return groups;
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
  let wanted = new Map(), running = false;
  function want(list) {
    wanted = new Map(list.map((a) => [artistKey(a.artist), a]));
    if (!running) run();
  }
  async function run() {
    running = true;
    while (wanted.size) {
      const [key, a] = wanted.entries().next().value;
      wanted.delete(key);
      try { onAnswer({ key, ...(await discographyFor(a)) }); } catch { /* offline or busy: asked again when next on screen */ }
    }
    running = false;
  }

  const tracklists = new Map();
  /** A release group's tracks, from its first official release: [{ title, length (s) }]. Kept for the session. */
  function tracklist(groupId) {
    if (!tracklists.has(groupId)) {
      const asked = mbFetch(`release?release-group=${encodeURIComponent(groupId)}&status=official&inc=recordings&limit=1&fmt=json`).then((json) => {
        const release = (json.releases || [])[0];
        return release ? (release.media || []).flatMap((m) => (m.tracks || []).map((t) => ({ title: t.title, length: t.length ? t.length / 1000 : 0 }))) : [];
      });
      tracklists.set(groupId, asked);
      asked.catch(() => tracklists.delete(groupId));
    }
    return tracklists.get(groupId);
  }

  return { discographyFor, want, tracklist };
}

module.exports = { createDiscography, artistKey };
```

- [ ] **Step 4: Run the tests** — `node --test test/discography.test.js`, then `npm test`; all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/discography.js test/discography.test.js
git commit -m "Discographies from MusicBrainz: every official release group, one artist at a time, kept 30 days"
```

---

### Task 4: What's missing, and where it stands

**Files:**
- Create: `src/renderer/js/shelf-missing.js`
- Test: `test/shelf-missing.test.mjs`

**Interfaces:**
- Consumes: shelf albums `{ id, artist, title, year, artistMbid }`; arranged items from `shelf-order.js` `arrange()` (albums and `{ divider }`); groups from Task 3.
- Produces: `sameName(text)`, `artistsWanting(albums) → Map<key, { key, artist, mbid, owned: string[] }>`, `missingFor(groups, owned, hidden) → group[]`, `withMissing(items, boxes) → items` with `{ box }` and `{ ghost, artist }` entries, `boxLabel(box) → string`, `typeLabel(group) → string`, `isSlim(group) → boolean`. A box: `{ key, artist, state: 'loading' | 'found', missing: group[], open: boolean }`.

- [ ] **Step 1: Write the failing tests** — `test/shelf-missing.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { sameName, artistsWanting, missingFor, withMissing, boxLabel, typeLabel, isSlim } from '../src/renderer/js/shelf-missing.js';

const require = createRequire(import.meta.url);
const main = require('../src/main/same-name');

const album = (artist, title, extra = {}) => ({ id: `${artist}/${title}`, artist, title, year: null, artistMbid: null, ...extra });
const g = (id, title, extra = {}) => ({ id, title, type: 'Album', secondary: [], year: '2000', ...extra });

test('names are compared as the shelf does in main', () => {
  for (const s of ['OK Computer', 'ok computer!', "Three Dollar Bill, Y'all$", 'Björk', '!!!', '  ', 'Сплин', 'シングル']) {
    assert.strictEqual(sameName(s), main.sameName(s), s);
  }
});

test('a box for an album artist with two albums or more, not Various Artists', () => {
  const wanting = artistsWanting([
    album('Radiohead', 'OK Computer', { artistMbid: 'a74b' }), album('Radiohead', 'Kid A'),
    album('Korn', 'Issues'),
    album('Various Artists', 'Now 1'), album('Various Artists', 'Now 2'),
    album(null, 'Untitled'), album(null, 'Untitled 2'),
  ]);
  assert.deepStrictEqual([...wanting.keys()], [sameName('Radiohead')]);
  assert.deepStrictEqual(wanting.get(sameName('Radiohead')), { key: sameName('Radiohead'), artist: 'Radiohead', mbid: 'a74b', owned: ['OK Computer', 'Kid A'] });
});

test('missing: not owned under any spelling, not hidden, oldest first, no year last', () => {
  const groups = [g('3', 'Kid A', { year: '2000' }), g('1', 'Pablo Honey', { year: '1993' }), g('x', 'Unknown Promo', { year: null }), g('2', 'Ok Computer!', { year: '1997' }), g('h', 'Hidden', { year: '1995' })];
  assert.deepStrictEqual(missingFor(groups, ['OK Computer'], new Set(['h'])).map((x) => x.id), ['1', '3', 'x']);
  assert.deepStrictEqual(missingFor(groups, ['Kid A', 'OK Computer', 'Pablo Honey', 'Unknown Promo'], new Set(['h'])), []);
});

test('the box stands after the artist\'s last album; open, their places before it', () => {
  const items = [{ divider: 'K' }, album('Korn', 'Issues'), album('Korn', 'Untouchables'), { divider: 'R' }, album('Radiohead', 'Kid A')];
  const shut = { key: sameName('Korn'), artist: 'Korn', state: 'found', missing: [g('f', 'Follow the Leader')], open: false };
  const show = (list) => list.map((x) => (x.divider ? `[${x.divider}]` : x.box ? `<${x.box.artist}>` : x.ghost ? `~${x.ghost.title}` : x.title));
  assert.deepStrictEqual(show(withMissing(items, new Map([[shut.key, shut]]))), ['[K]', 'Issues', 'Untouchables', '<Korn>', '[R]', 'Kid A']);
  const open = { ...shut, open: true };
  assert.deepStrictEqual(show(withMissing(items, new Map([[open.key, open]]))), ['[K]', 'Issues', 'Untouchables', '~Follow the Leader', '<Korn>', '[R]', 'Kid A']);
  assert.deepStrictEqual(show(withMissing(items, new Map())), ['[K]', 'Issues', 'Untouchables', '[R]', 'Kid A']);
});

test('what a box says', () => {
  assert.strictEqual(boxLabel({ state: 'loading', missing: [] }), '…');
  assert.strictEqual(boxLabel({ state: 'found', missing: [g('a', 'A'), g('b', 'B')] }), '+2 MISSING');
  assert.strictEqual(boxLabel({ state: 'found', missing: [] }), 'COMPLETE ★');
});

test('a place is labelled with what it is; a single\'s case is slim', () => {
  assert.strictEqual(typeLabel(g('a', 'A')), '');
  assert.strictEqual(typeLabel(g('a', 'A', { secondary: ['Live'] })), 'LIVE');
  assert.strictEqual(typeLabel(g('a', 'A', { secondary: ['Compilation'] })), 'COMP');
  assert.strictEqual(typeLabel(g('a', 'A', { secondary: ['Soundtrack'] })), 'OST');
  assert.strictEqual(typeLabel(g('a', 'A', { secondary: ['Remix'] })), 'REMIX');
  assert.strictEqual(typeLabel(g('a', 'A', { type: 'EP' })), 'EP');
  assert.strictEqual(typeLabel(g('a', 'A', { type: 'Single' })), 'SINGLE');
  assert.strictEqual(typeLabel(g('a', 'A', { type: 'Single', secondary: ['Live'] })), 'LIVE');
  assert.strictEqual(isSlim(g('a', 'A', { type: 'Single' })), true);
  assert.strictEqual(isSlim(g('a', 'A', { type: 'EP' })), false);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/shelf-missing.test.mjs`
Expected: FAIL — cannot find `shelf-missing.js`.

- [ ] **Step 3: Implement** — `src/renderer/js/shelf-missing.js`:

```js
// Missing albums on the shelf (SORT: ARTIST): after the albums of an artist you have two or more of, a box saying how
// many of their official releases you don't have, which opens into see-through places for them, oldest first. Their
// discographies come from MusicBrainz (main/discography.js); this works out what's missing and where it all stands.

const VARIOUS = 'various artists';

/** How the shelf compares names ("OK Computer" = "ok computer!") — the same as main/shelf.js's sameName. */
export const sameName = (s) => { const low = String(s || '').toLowerCase(); return low.replace(/[^\p{L}\p{N}]+/gu, '') || low.trim(); };

/** Shelf albums → the artists who get a box: Map(key → { key, artist, mbid, owned: their album titles }). */
export function artistsWanting(albums) {
  const by = new Map();
  for (const a of albums) {
    if (!a.artist || a.artist.toLowerCase() === VARIOUS) continue;
    const key = sameName(a.artist);
    if (!by.has(key)) by.set(key, { key, artist: a.artist, mbid: null, owned: [] });
    const entry = by.get(key);
    entry.owned.push(a.title);
    entry.mbid = entry.mbid || a.artistMbid || null;
  }
  for (const [key, entry] of by) if (entry.owned.length < 2) by.delete(key);
  return by;
}

/** An artist's release groups they don't have (by title, as the shelf compares names) and haven't hidden, oldest first. */
export function missingFor(groups, owned, hidden) {
  const have = new Set(owned.map(sameName));
  return groups.filter((g) => !hidden.has(g.id) && !have.has(sameName(g.title)))
    .sort((a, b) => (!a.year - !b.year) || String(a.year || '').localeCompare(String(b.year || '')) || a.title.localeCompare(b.title));
}

/** The shelf's items (ARTIST order) with each artist's box after their last album, and their places before it when open. */
export function withMissing(items, boxes) {
  const last = new Map();
  items.forEach((x, i) => { if (!x.divider && x.artist && boxes.has(sameName(x.artist))) last.set(sameName(x.artist), i); });
  const after = new Map([...last].map(([key, i]) => [i, boxes.get(key)]));
  const out = [];
  items.forEach((x, i) => {
    out.push(x);
    const box = after.get(i);
    if (!box) return;
    if (box.open) for (const ghost of box.missing) out.push({ ghost, artist: box.artist });
    out.push({ box });
  });
  return out;
}

export const boxLabel = (box) => (box.state !== 'found' ? '…' : box.missing.length ? `+${box.missing.length} MISSING` : 'COMPLETE ★');

const SECONDARY = { Live: 'LIVE', Compilation: 'COMP', Soundtrack: 'OST', Remix: 'REMIX' };
/** What a place's label says it is: LIVE, COMP, OST, REMIX, EP, SINGLE — nothing for a studio album. */
export function typeLabel(group) {
  const secondary = (group.secondary || []).map((s) => SECONDARY[s]).find(Boolean);
  if (secondary) return secondary;
  return group.type === 'EP' ? 'EP' : group.type === 'Single' ? 'SINGLE' : '';
}
/** A single's case is slim, like a CD single's. */
export const isSlim = (group) => group.type === 'Single';
```

- [ ] **Step 4: Run the tests** — `node --test test/shelf-missing.test.mjs`, then `npm test`; all pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/js/shelf-missing.js test/shelf-missing.test.mjs
git commit -m "What's missing from an artist's shelf, and where the box and places stand"
```

---

### Task 5: Boxes and places on the shelf

**Files:**
- Modify: `src/main/main.js` (discography instance, IPC, `shelf:albums`)
- Modify: `src/preload.js`
- Modify: `src/renderer/js/shelf.js` (render, observer, box/place elements)
- Modify: `src/renderer/styles.css`

**Interfaces:**
- Consumes: Task 2 store functions, Task 3 `createDiscography`, Task 4 module.
- Produces (preload): `cdp.wantDiscography(artists: [{ artist, mbid }])`, `cdp.onDiscography(cb({ key, state, groups }))`, `cdp.missingTracklist(groupId) → [{ title, length }]`, `cdp.hideMissing(groupId)`, `cdp.openMusicBrainz(groupId)`; `shelf:albums` result gets `hiddenMissing: string[]`.

This task is UI glue; it's checked in the app (Task 7), with `npm test` staying green.

- [ ] **Step 1: main.js** — after the `shelf:albums` handler:

```js
// Missing albums (discography.js): each artist's official releases from MusicBrainz, for the artists on screen.
const discography = require('./discography').createDiscography({
  mbFetch: (q) => require('./online').mbFetch(q),
  onAnswer: (answer) => { if (win) win.webContents.send('discography', answer); },
});
handle('discography:want', (artists) => discography.want(Array.isArray(artists) ? artists.slice(0, 200) : []));
handle('discography:tracklist', (groupId) => discography.tracklist(groupId));
handle('discography:hide', (groupId) => { const hidden = store.readHiddenMissing(); hidden.add(String(groupId)); store.writeHiddenMissing(hidden); });
handle('discography:open', (groupId) => { if (/^[0-9a-f-]{36}$/.test(groupId)) shell.openExternal(`https://musicbrainz.org/release-group/${groupId}`); });
```

and in the `shelf:albums` handler, before `return result;`: `result.hiddenMissing = [...store.readHiddenMissing()];`

- [ ] **Step 2: preload.js** — next to `setNote`:

```js
  wantDiscography: invoke('discography:want'),
  missingTracklist: invoke('discography:tracklist'),
  hideMissing: invoke('discography:hide'),
  openMusicBrainz: invoke('discography:open'),
  onDiscography: on('discography'),
```

- [ ] **Step 3: shelf.js** — state, event, and render.

Add to the imports: `import { artistsWanting, missingFor, withMissing, boxLabel, typeLabel, isSlim, sameName } from './shelf-missing.js';`

Add to `shelf`: `discogs: new Map(), openBoxes: new Set(), hidden: new Set(), boxObserver: null, wantTimer: null, onScreen: new Set()`.

In `setupShelf`, after `onShelfProgress`:

```js
  app.cdp.onDiscography(({ key, state, groups }) => {
    shelf.discogs.set(key, { state, groups });
    if (shelf.open && shelf.app.state.shelfSort === 'ARTIST') render();
  });
```

In `load()`, after `shelf.albums = result.albums;`: `shelf.hidden = new Set(result.hiddenMissing || []);`
In `closeShelf()`: `shelf.openBoxes.clear();`

In `render()`, replace `const items = arrange(shown, sort).map((a) => {` with:

```js
  if (shelf.boxObserver) shelf.boxObserver.disconnect();
  shelf.onScreen.clear();
  const boxes = sort === 'ARTIST' ? missingBoxes(shown, query) : new Map();
  const items = withMissing(arrange(shown, sort), boxes).map((a) => {
    if (a.box) return boxCard(a.box);
    if (a.ghost) return ghostSpine(a.ghost, a.artist);
```

(the existing `if (a.divider) …` and album branch stay as they are). Then add, above `// ---- Dust`:

```js
// ---- Missing albums (shelf-missing.js) -------------------------------------------------------------------------

// The boxes for the artists shown: their discography when it's known, or waiting for it.
function missingBoxes(shown, query) {
  const boxes = new Map();
  const wanting = artistsWanting(shelf.albums);
  const showing = new Set(shown.map((a) => sameName(a.artist)));
  for (const [key, w] of wanting) {
    if (!showing.has(key)) continue;
    const d = shelf.discogs.get(key);
    if (d && d.state === 'unknown') continue;
    const missing = d ? missingFor(d.groups, w.owned, shelf.hidden).filter((g) => matchesFilter({ artist: w.artist, title: g.title, year: g.year }, query)) : [];
    boxes.set(key, { key, artist: w.artist, mbid: w.mbid, state: d ? 'found' : 'loading', missing, open: shelf.openBoxes.has(key) });
  }
  return boxes;
}
function boxCard(box) {
  const card = el('button', { class: `missing-box${box.state === 'found' && !box.missing.length ? ' complete' : ''}${box.open ? ' open' : ''}`,
    title: box.state !== 'found' ? `Looking up ${box.artist} on MusicBrainz…` : box.missing.length ? `${box.artist}: releases you don't have — click to ${box.open ? 'close' : 'show them'}` : `You have everything ${box.artist} has released`,
    onClick: () => {
      if (box.state !== 'found' || !box.missing.length) return;
      if (shelf.openBoxes.has(box.key)) shelf.openBoxes.delete(box.key); else shelf.openBoxes.add(box.key);
      render();
    } }, el('span', {}, boxLabel(box)));
  card.box = box;
  if (box.state === 'loading') watchBox(card);
  return card;
}
// A box that's waiting: once it's on screen, MusicBrainz is asked about its artist (a moment after scrolling stops).
function watchBox(card) {
  if (!shelf.boxObserver) {
    shelf.boxObserver = new IntersectionObserver((entries) => {
      for (const e of entries) { if (e.isIntersecting) shelf.onScreen.add(e.target.box); else shelf.onScreen.delete(e.target.box); }
      clearTimeout(shelf.wantTimer);
      shelf.wantTimer = setTimeout(() => {
        shelf.app.cdp.wantDiscography([...shelf.onScreen].map((b) => ({ artist: b.artist, mbid: b.mbid }))).catch(() => {});
      }, 250);
    }, { root: $('shelf-body'), rootMargin: '200px' });
  }
  shelf.boxObserver.observe(card);
}
function ghostSpine(group, artist) {
  const type = typeLabel(group);
  const spine = el('button', { class: `spine ghost${isSlim(group) ? ' slim' : ''}`, title: [artist, group.title, group.year, type].filter(Boolean).join(' · '),
    onClick: () => openGhostCase(group, artist, spine) },
    el('span', { class: 'spine-text' }, group.title, group.year ? ` · ${group.year}` : ''),
    type ? el('span', { class: 'ghost-type' }, type) : null);
  spine.ghost = group;
  return spine;
}
```

`openGhostCase` comes in Task 6; until then add a stub that does nothing so this task runs: `function openGhostCase() {}` (Task 6 replaces it).

`pullOne` already only looks at `shelf.shown` (real albums), and `showInPlayer`/`rubSpine` look at `.spine` elements' `album` — make both skip ghosts: in `showInPlayer`'s loop add `if (!spine.album) continue;`, and in `pullOne`'s `find` it already compares `s.album === a` (a ghost has no `album`, fine).

- [ ] **Step 4: styles.css** — after the `.shelf-divider.short span` rule:

```css
/* Missing albums (shelf-missing.js): after an artist's albums, a see-through box saying how many of their releases
   you don't have; open, their places stand before it — dashed, see-through cases with the title and what it is. */
.missing-box {
  position: relative; align-self: flex-end; width: 26px; height: 176px; margin: 0 3px; padding: 0; cursor: pointer;
  border: 1.5px dashed rgba(214, 200, 172, .55); border-radius: 3px; background: rgba(214, 200, 172, .08); color: rgb(214, 200, 172);
}
.missing-box span {
  position: absolute; top: 8px; left: 0; right: 0; bottom: 8px; writing-mode: vertical-rl; line-height: 23px;
  font-size: 9px; font-weight: bold; letter-spacing: .08em; white-space: nowrap; overflow: hidden;
}
.missing-box:hover, .missing-box.open { background: rgba(214, 200, 172, .18); }
.missing-box.complete { cursor: default; border-color: rgba(230, 190, 90, .6); color: rgb(230, 190, 90); }
.spine.ghost {
  background: rgba(255, 255, 255, .04); box-shadow: none; opacity: .38; color: rgb(var(--ink, 230, 230, 230));
  outline: 1.5px dashed rgba(255, 255, 255, .6); outline-offset: -2px;
}
.spine.ghost:hover { opacity: .7; }
.spine.ghost.slim { width: 18px; }
.spine.ghost.slim .spine-text { line-height: 18px; font-size: 8px; }
.ghost-type {
  position: absolute; left: 0; right: 0; bottom: 6px; writing-mode: vertical-rl; line-height: inherit;
  font-size: 7px; font-weight: bold; letter-spacing: .08em;
}
.spine.ghost .spine-text { bottom: 44px; }
```

- [ ] **Step 5: Run the tests** — `npm test`, all pass. (`shelf.js` needs a DOM, so it's exercised in the app in Task 7.)

- [ ] **Step 6: Commit**

```bash
git add src/main/main.js src/preload.js src/renderer/js/shelf.js src/renderer/styles.css
git commit -m "Missing albums: a box after each artist's albums, opening into see-through places"
```

---

### Task 6: The ghost case

**Files:**
- Modify: `src/renderer/js/shelf.js` (extract `showCase`, add `openGhostCase`)
- Modify: `src/renderer/styles.css`

**Interfaces:**
- Consumes: Task 5's preload functions; `app.cdp.spotifyStatus() → { connected }`, `app.cdp.spotifySearch(q) → { items: [{ kind, id, name, owner }] } | { error }`, `app.cdp.spotifyDiscTracks({ kind, id }) → { tracks } | { error }`, `app.playSpotifyDisc(tracks, name)`, `app.setStatus(text)`, `app.formatTime(s)` (all already on `app`).

- [ ] **Step 1: Extract `showCase`** — in `openCase`, replace everything from `const layer = el('div', { class: 'case-layer', …` to the end of the function with `showCase(card, spine, from, shelf.colors.get(a.id) || hashColor(a.title + a.artist));`, and add:

```js
// A case pulled out of the shelf: slides up off it, then turns towards you from its spine to its front.
function showCase(card, spine, from, color) {
  const layer = el('div', { class: 'case-layer', onClick: (e) => { if (e.target === layer) closeCase(); } }, card);
  card.style.setProperty('--spine', `${color[0]}, ${color[1]}, ${color[2]}`);
  $('shelf').append(layer);
  shelf.caseOpen = { layer, card, spine };
  spine.classList.add('out');
  if (!anim.enabled) return;
  const to = card.getBoundingClientRect();
  const sx = from.width / to.width, sy = from.height / to.height;
  card.animate([
    { transform: `translate(${from.left - to.left}px, ${from.top - to.top - 30}px) scale(${sx}, ${sy}) rotateY(75deg)`, opacity: 0.2, transformOrigin: 'left top' },
    { transform: 'none', opacity: 1, transformOrigin: 'left top' },
  ], { duration: 420, easing: 'cubic-bezier(.2,.8,.25,1)' });
  layer.animate([{ background: 'rgba(0,0,0,0)' }, { background: 'rgba(0,0,0,.6)' }], { duration: 300 });
}
```

Run `npm test` and open a real case in the app once (Task 7 does it again) — nothing should look different.

- [ ] **Step 2: `openGhostCase`** — replace Task 5's stub with:

```js
// A missing album's ghost case: see-through, its cover from the Cover Art Archive and its tracklist from MusicBrainz,
// to play on Spotify (when connected), look up on MusicBrainz, or never see again.
async function openGhostCase(group, artist, spine) {
  if (shelf.caseOpen) return;
  const { app } = shelf;
  const from = spine.getBoundingClientRect();
  const blank = el('div', { class: 'case-cover cdr ghost-cover' }, el('div', { class: 'marker' }, group.title), el('div', { class: 'marker small' }, artist));
  const front = el('div', { class: 'case-front' }, blank);
  const cover = new Image();
  cover.className = 'case-cover';
  cover.alt = '';
  cover.onload = () => blank.replaceWith(cover);
  cover.src = `https://coverartarchive.org/release-group/${group.id}/front-250`;
  const tracks = el('div', { class: 'case-tracks scroll' }, el('div', { class: 'case-track' }, el('span', { class: 'name' }, '…')));
  app.cdp.missingTracklist(group.id).then((list) => {
    tracks.replaceChildren(...list.map((t, i) => el('div', { class: 'case-track' },
      el('span', { class: 'no' }, String(i + 1).padStart(2, '0')), el('span', { class: 'name' }, t.title),
      el('span', { class: 'time' }, t.length ? app.formatTime(t.length) : ''))));
  }).catch(() => tracks.replaceChildren(el('div', { class: 'case-track' }, el('span', { class: 'name' }, "COULDN'T REACH MUSICBRAINZ"))));
  const spotifyButton = pill('PLAY ON SPOTIFY', () => playMissingOnSpotify(group, artist), 'Find it on Spotify and play it as a disc');
  spotifyButton.hidden = true;
  app.cdp.spotifyStatus().then((s) => { spotifyButton.hidden = !(s && s.connected); }).catch(() => {});
  const type = typeLabel(group) || (group.type || 'ALBUM').toUpperCase();
  const card = el('div', { class: 'case-card ghost' }, front,
    el('div', { class: 'case-info' },
      el('div', { class: 'case-title' }, group.title),
      el('div', { class: 'case-artist' }, [artist, group.year, type].filter(Boolean).join(' · ')),
      el('div', { class: 'case-meta' }, 'NOT IN YOUR COLLECTION'),
      tracks,
      el('div', { class: 'case-actions' },
        pill('BACK ON THE SHELF', () => closeCase()),
        pill('NOT INTERESTED', () => hideMissing(group), 'Never show this one on the shelf again'),
        el('span', { class: 'grow' }),
        pill('MUSICBRAINZ', () => app.cdp.openMusicBrainz(group.id), 'Open its page on MusicBrainz'),
        spotifyButton)));
  showCase(card, spine, from, hashColor(group.title + artist));
}
function hideMissing(group) {
  shelf.hidden.add(group.id);
  shelf.app.cdp.hideMissing(group.id).catch(() => {});
  closeCase(true);
  render();
}
// Spotify's copy of a missing album: the first album found whose title is the same, put in as a disc.
async function playMissingOnSpotify(group, artist) {
  const { app } = shelf;
  const found = await app.cdp.spotifySearch(`album:${group.title} artist:${artist}`).catch(() => ({ error: 'OFFLINE' }));
  const hit = (found.items || []).find((i) => i.kind === 'album' && sameName(i.name) === sameName(group.title));
  if (!hit) { app.setStatus('NOT ON SPOTIFY'); return; }
  const disc = await app.cdp.spotifyDiscTracks({ kind: 'album', id: hit.id }).catch(() => ({ error: 'OFFLINE' }));
  if (!disc.tracks) { app.setStatus('NOT ON SPOTIFY'); return; }
  closeCase(true);
  app.playSpotifyDisc(disc.tracks, hit.name);
}
```

- [ ] **Step 3: styles.css** — after `.case-front .sticker-new`:

```css
/* A missing album's ghost case: see-through, with a dashed edge. */
.case-card.ghost { background: rgba(var(--card), .82); border: 1.5px dashed rgba(255, 255, 255, .35); }
.case-card.ghost .case-cover { opacity: .75; }
.ghost-cover { border: 1.5px dashed rgba(255, 255, 255, .35); background: rgba(255, 255, 255, .03); }
```

- [ ] **Step 4: Run the tests** — `npm test`, all pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/js/shelf.js src/renderer/styles.css
git commit -m "Missing albums: a ghost case with its cover and tracklist, PLAY ON SPOTIFY, MUSICBRAINZ and NOT INTERESTED"
```

---

### Task 7: Checked in the app, and the README

**Files:**
- Modify: `README.md` (The CD shelf section)

- [ ] **Step 1: Test profile** — a temp `CDPLAYER_HOME` with `onboarded`, `lastversion.txt`, and `lastpath.txt` pointing at a folder of short generated MP3s (ffmpeg `sine` sources) tagged as real albums: two by Radiohead ("OK Computer", "Kid A"), two by Portishead ("Dummy", "Portishead"), one by Korn ("Issues"). Launch with `CDPLAYER_HOME=<dir> ./node_modules/.bin/electron . --remote-debugging-port=9333` and drive it over the DevTools protocol (open the shelf with `#shelf-button`, click elements, screenshot with `Page.captureScreenshot`).

- [ ] **Step 2: Check, with real requests to MusicBrainz:**
  - Radiohead and Portishead get a box that turns from `…` into `+N MISSING` within a few seconds; Korn (one album) has none.
  - Clicking a box opens thin SINGLE places and 30 px album places, oldest first, with type labels; clicking again closes it.
  - A place's ghost case shows the Cover Art Archive cover and a tracklist; MUSICBRAINZ opens `musicbrainz.org/release-group/<id>` (check the `shell.openExternal` call by logging, don't leave a browser tab open); NOT INTERESTED removes the place, the count drops by one, and after a restart it's still gone (`missing-hidden.txt`).
  - Sorting by NEW/PLAYED/YEAR shows no boxes; PULL ONE still only takes real albums.
  - A second launch shows the counts straight away (from `discography.json`), without asking MusicBrainz.

- [ ] **Step 3: README** — in **The CD shelf**, after the Sticky notes bullet:

```markdown
- **Missing albums**: sorted by artist, an artist you have two or more albums of gets a box after them — **+47 MISSING** — counting their official releases (albums, live records, compilations, EPs and singles) you don't have, from [MusicBrainz](https://musicbrainz.org). Click it and they stand on the shelf as see-through places, oldest first; click one for its cover and tracklist, **PLAY ON SPOTIFY**, **MUSICBRAINZ**, or **NOT INTERESTED** to never see it again. Looked up as artists scroll into view, and kept for a month
```

- [ ] **Step 4: Run the tests** — `npm test`, all pass.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "README: missing albums on the shelf"
```
