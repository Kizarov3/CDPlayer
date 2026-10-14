# CD changer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The queue becomes a five-disc carousel changer: music goes in as discs, plays disc by disc with changer shuffle/repeat modes, and a carousel replaces the queue list.

**Architecture:** `state.queue` / `state.index` stay the flat list playback already works from; a pure module `src/renderer/js/changer.js` owns them together with `state.changer = { slots, nextDisc }` (five slots, each a disc = a run `[start, end)` of the queue). Every change goes through the module; `app.js` keeps a tiny adapter (`ch()` to read, `apply()` to write). The carousel is a separate view module, `changer-view.js`.

**Tech Stack:** Electron, plain ES modules in the renderer, `node --test` (`npm test`), CommonJS in main.

**Spec:** `docs/superpowers/specs/2026-10-14-cd-changer-design.md`

## Global Constraints

- Work on a branch `cd-changer` (a worktree via superpowers:using-git-worktrees); merge only after the user has tried it. `worktree-gapless` is unmerged and touches the same transport code — expect a merge there later; don't rebase onto it.
- Five slots (`SLOTS = 5`). SHUFFLE cycles `'OFF' → 'DISC' → 'ALL'`; REPEAT cycles `'OFF' → 'TRACK' → 'DISC' → 'ALL'`.
- Tests never touch the real `~/.cdplayer`: main-process tests set `process.env.CDPLAYER_HOME` to a temp dir before requiring `store` (see `test/state.test.js`).
- Every new interface text goes through `t()` and gets its Russian in `src/locales/ru.json`; `npm run i18n -- ru` must end at 100 %.
- Commit messages: plain sentences in the repo's style ("The changer …"); **no** Co-Authored-By or "Generated with" lines (user rule).
- No platform code: no Windows VM check.

## Review Focus

1. **A file deleted while it sits in a slot** (library watch → `onLibraryChanged` / missing on restore): its disc shrinks, an emptied slot frees, and playback stays on the same song — Task 1 `removePaths` tests.
2. **The full changer** when all five discs are unfinished and the playing one is among them: the picker must never offer the playing disc, Esc loads nothing — Task 1 `load({ slot })` refusing the playing slot; Task 7 picker.
3. **A queue saved by 2.14 with 40 single tracks of 40 albums** (the user's own library): becomes one CD-R, not 40 one-track discs or a dropped 35 — Task 1 `fromQueue` test.
4. **SHUFFLE ALL with REPEAT OFF ends**: after every track played once, playback stops instead of looping forever — Task 2 test.
5. **A corrupt or hand-edited `changer.txt`** (runs not matching `queue.txt`): treated as missing and rebuilt from the queue, never a crash or a disc pointing past the queue — Task 3 `parse` test.

---

## File Structure

- Create `src/renderer/js/changer.js` — the model: slots, load/eject/clear, order (next/previous/disc skip), played/done, removePaths, fromQueue, serialize/parse. Pure.
- Create `test/changer.test.mjs` — its tests.
- Create `src/renderer/js/changer-view.js` — the carousel and the disc's tracklist (DOM only; gets data and callbacks).
- Modify `src/main/store.js` — `changer.txt` read/write beside `queue.txt`.
- Modify `src/main/main.js` — `state:load` returns `changerText`.
- Modify `src/renderer/js/app.js` — the adapter, every queue mutation, transport, modes, persistence, restore, keys, mini state.
- Modify `src/renderer/js/spotify-deck.js` — `spotifyUpcoming` with the new modes, stopping at a non-Spotify track.
- Modify `src/renderer/index.html`, `src/renderer/styles.css` — the changer card in place of the queue card.
- Modify `src/renderer/js/shelf.js` — INTO THE CHANGER, slot numbers on spines, ALREADY IN SLOT.
- Modify `src/renderer/js/mini.js` — the new mode values.
- Modify `src/renderer/js/panels.js`, `src/renderer/js/help.js` — shortcut list (D, 1–5).
- Delete `src/renderer/js/play-next.js` and its test once nothing imports it (Task 5).
- Modify `src/locales/ru.json`, `README.md`.

---

### Task 1: The changer model — loading, ejecting, removing, migrating

**Files:**
- Create: `src/renderer/js/changer.js`
- Test: `test/changer.test.mjs`

**Interfaces:**
- Produces:
  - `SLOTS = 5`; `empty() → Changer`
  - `Changer = { slots: (Disc|null)[5], queue: string[], index: number, nextDisc: number|null }`
  - `Disc = { id: string, kind: 'album'|'cdr'|'spotify'|'audiocd', title: string|null, artist: string|null, start, end, done: boolean, finishedAt: number|null, played: number[] }`
  - `slotOf(c, index) → { slot, offset } | null`
  - `load(c, disc, tracks, { play?, next?, slot? }) → { changer, slot, replaced? } | { changer, slot, already: true } | { changer, full: true }`
  - `eject(c, slot, modes?, rnd?) → Changer`; `clear() → Changer` (= `empty()`)
  - `removePaths(c, gone: Set<string>) → Changer`
  - `fromQueue(paths, index, albumOf: (p) => ({ key, title, artist, kind? }) | null, { cdrTitle }) → { changer, dropped }`
  - `tracksOf(c, slot) → string[]`
  - `check(c) → true` or throws (the invariant, for tests)

- [ ] **Step 1: Write the failing tests**

```js
// test/changer.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { SLOTS, empty, slotOf, load, eject, removePaths, fromQueue, tracksOf, check } from '../src/renderer/js/changer.js';

const disc = (id, extra = {}) => ({ id, kind: 'album', title: id, artist: 'X', ...extra });
const fill = (n) => { let c = empty(); for (let i = 0; i < n; i++) c = load(c, disc(`d${i}`), [`d${i}/1`, `d${i}/2`]).changer; return c; };

test('a disc goes into the lowest free slot; the queue is the discs in slot order', () => {
  let c = load(empty(), disc('a'), ['a1', 'a2']).changer;
  assert.deepStrictEqual(c.queue, ['a1', 'a2']);
  assert.strictEqual(c.index, 0, 'nothing was playing: stands on its first track');
  const r = load(c, disc('b'), ['b1']);
  assert.strictEqual(r.slot, 1);
  c = eject(r.changer, 0);
  c = load(c, disc('c'), ['c1', 'c2', 'c3']).changer;
  assert.deepStrictEqual(c.slots.map((d) => d && d.id), ['c', 'b', null, null, null]);
  assert.deepStrictEqual(c.queue, ['c1', 'c2', 'c3', 'b1']);
  assert.ok(check(c));
});

test('PLAY stands on the new disc; PLAY NEXT marks it; a disc already in is not loaded twice', () => {
  let c = fill(2);
  c = load(c, disc('p'), ['p1'], { play: true }).changer;
  assert.strictEqual(c.queue[c.index], 'p1');
  c = load(c, disc('n'), ['n1'], { next: true }).changer;
  assert.strictEqual(c.nextDisc, 3);
  const again = load(c, disc('d0'), ['x']);
  assert.deepStrictEqual([again.already, again.slot, again.changer], [true, 0, c]);
});

test('full: a finished disc makes room (the one finished longest ago); none finished → full', () => {
  let c = fill(SLOTS);
  assert.ok(load(c, disc('z'), ['z1']).full);
  c.slots[3] = { ...c.slots[3], done: true, finishedAt: 20 };
  c.slots[1] = { ...c.slots[1], done: true, finishedAt: 10 };
  const r = load(c, disc('z'), ['z1']);
  assert.strictEqual(r.slot, 1);
  assert.strictEqual(r.replaced.id, 'd1');
  assert.ok(check(r.changer));
});

test('the picker\'s slot: any slot but the playing one', () => {
  const c = fill(SLOTS); // standing on d0/1, slot 0
  assert.strictEqual(load(c, disc('z'), ['z1'], { slot: 0 }).slot, -1);
  const r = load(c, disc('z'), ['z1'], { slot: 4 });
  assert.strictEqual(r.changer.slots[4].id, 'z');
  assert.strictEqual(r.changer.queue[r.changer.index], 'd0/1', 'still on the same song');
});

test('ejecting another disc keeps the song; the last disc out leaves nothing', () => {
  let c = fill(3);
  c = { ...c, index: 3 }; // d1/2
  const kept = eject(c, 2);
  assert.strictEqual(kept.queue[kept.index], 'd1/2');
  assert.ok(check(kept));
  const last = eject(load(empty(), disc('a'), ['a1']).changer, 0);
  assert.deepStrictEqual([last.queue, last.index], [[], -1]);
});

test('files gone from the disk leave their discs; an empty disc frees its slot; the song playing stays', () => {
  let c = fill(3);
  c = { ...c, index: 3 }; // d1/2
  c = removePaths(c, new Set(['d1/1', 'd0/1', 'd0/2']));
  assert.deepStrictEqual(c.slots.map((d) => d && d.id), [null, 'd1', 'd2', null, null]);
  assert.strictEqual(c.queue[c.index], 'd1/2');
  assert.ok(check(c));
  const gone = removePaths(c, new Set(['d1/2']));
  assert.strictEqual(gone.index, -1, 'the song playing went: nothing stands');
});

test('an old queue: album runs are discs, neighbouring singles are one CD-R', () => {
  const album = { a1: 'A', a2: 'A', s1: 'S1', s2: 'S2', s3: 'S3', b1: 'B', b2: 'B' };
  const albumOf = (p) => ({ key: album[p], title: `Album ${album[p]}`, artist: 'X' });
  const { changer, dropped } = fromQueue(['a1', 'a2', 's1', 's2', 's3', 'b1', 'b2'], 3, albumOf, { cdrTitle: 'MIX' });
  assert.deepStrictEqual(changer.slots.map((d) => d && [d.kind, d.title]), [['album', 'Album A'], ['cdr', 'MIX'], ['album', 'Album B'], null, null]);
  assert.strictEqual(changer.queue[changer.index], 's2');
  assert.strictEqual(dropped, 0);
  assert.ok(check(changer));
});

test('2.14\'s queue of forty singles from forty albums is one CD-R', () => {
  const paths = Array.from({ length: 40 }, (_, i) => `s${i}`);
  const { changer, dropped } = fromQueue(paths, 7, (p) => ({ key: p, title: p, artist: 'X' }), { cdrTitle: 'MIX' });
  assert.deepStrictEqual([changer.slots.filter(Boolean).length, changer.slots[0].kind, changer.queue.length, dropped], [1, 'cdr', 40, 0]);
  assert.strictEqual(changer.queue[changer.index], 's7');
});

test('more than five discs: the playing one and the four after it', () => {
  const paths = Array.from({ length: 14 }, (_, i) => `${Math.floor(i / 2)}-${i % 2}`); // 7 albums of 2
  const albumOf = (p) => ({ key: p.split('-')[0], title: p.split('-')[0], artist: 'X' });
  const { changer, dropped } = fromQueue(paths, 10, albumOf, { cdrTitle: 'MIX' }); // album 5
  assert.deepStrictEqual(changer.slots.map((d) => d.title), ['5', '6', '0', '1', '2']);
  assert.strictEqual(dropped, 2);
  assert.strictEqual(changer.queue[changer.index], '5-0');
});

test('no queue, no index', () => {
  const { changer } = fromQueue([], -1, () => null, { cdrTitle: 'MIX' });
  assert.deepStrictEqual([changer.queue, changer.index], [[], -1]);
  assert.deepStrictEqual(tracksOf(fill(1), 0), ['d0/1', 'd0/2']);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/changer.test.mjs`
Expected: FAIL — `Cannot find module '../src/renderer/js/changer.js'`.

- [ ] **Step 3: Write the module**

```js
// src/renderer/js/changer.js
// The CD changer: five slots, each empty or holding a disc — a run [start, end) of the flat queue that playback, the
// mini player, Spotify and the saved queue still work from. Every change to the slots and the queue goes through here,
// so a disc's run and the queue never drift apart. Pure: no DOM, no I/O; a changer is never changed in place.

export const SLOTS = 5;
export const empty = () => ({ slots: Array(SLOTS).fill(null), queue: [], index: -1, nextDisc: null });
export const clear = empty;

const withoutRun = ({ start, end, ...rest }) => rest;
export const tracksOf = (c, s) => (c.slots[s] ? c.queue.slice(c.slots[s].start, c.slots[s].end) : []);
const entriesOf = (c) => c.slots.map((d, s) => (d ? { ...withoutRun(d), tracks: tracksOf(c, s) } : null));

/** The slot and the track on its disc of queue position `index`, or null. */
export function slotOf(c, index) {
  if (index < 0) return null;
  for (let s = 0; s < SLOTS; s++) {
    const d = c.slots[s];
    if (d && index >= d.start && index < d.end) return { slot: s, offset: index - d.start };
  }
  return null;
}

// Slots ({ …disc, tracks } or null; a disc with no tracks frees its slot) and where to stand → a changer, runs back to back.
function build(entries, at, nextDisc) {
  const slots = [], queue = [];
  for (const e of entries) {
    if (!e || !e.tracks.length) { slots.push(null); continue; }
    const { tracks, ...d } = e;
    slots.push({ ...d, start: queue.length, end: queue.length + tracks.length });
    queue.push(...tracks);
  }
  const s = at && slots[at.slot];
  const index = s && at.offset >= 0 && at.offset < s.end - s.start ? s.start + at.offset : -1;
  return { slots, queue, index, nextDisc: nextDisc != null && slots[nextDisc] ? nextDisc : null };
}

/** The invariant: the discs' runs are back to back in slot order and cover the queue; index is in one or -1. */
export function check(c) {
  let at = 0;
  for (const d of c.slots) {
    if (!d) continue;
    if (d.start !== at || d.end <= d.start) throw new Error(`run ${d.id} is ${d.start}..${d.end}, expected from ${at}`);
    at = d.end;
  }
  if (at !== c.queue.length) throw new Error(`runs cover ${at} of ${c.queue.length}`);
  if (c.index !== -1 && !slotOf(c, c.index)) throw new Error(`index ${c.index} is in no disc`);
  if (c.nextDisc != null && !c.slots[c.nextDisc]) throw new Error('nextDisc is empty');
  return true;
}

// Where a new disc goes: the lowest free slot, else the finished disc that finished longest ago (not the playing one).
function roomFor(c) {
  const free = c.slots.findIndex((d) => !d);
  if (free >= 0) return free;
  const here = slotOf(c, c.index);
  let best = -1;
  c.slots.forEach((d, s) => {
    if (d.done && (!here || here.slot !== s) && (best < 0 || d.finishedAt < c.slots[best].finishedAt)) best = s;
  });
  return best;
}

/**
 * Loads `disc` ({ id, kind, title, artist }) with its `tracks` into the changer. `play`: it's where the changer stands
 * now; `next`: it plays when the disc playing ends; `slot`: into that slot (the picker's choice — never the playing
 * one). With nothing playing, the changer stands on its first track. → { changer, slot, replaced } (replaced: the disc
 * taken out, or null), { changer, slot, already: true } when a disc with that id is in, { changer, full: true } when
 * no slot is free or finished, and { changer, slot: -1 } for no tracks or the playing slot.
 */
export function load(c, disc, tracks, { play = false, next = false, slot = null } = {}) {
  if (!tracks.length) return { changer: c, slot: -1 };
  const have = c.slots.findIndex((d) => d && d.id === disc.id);
  if (have >= 0) return { changer: c, slot: have, already: true };
  const here = slotOf(c, c.index);
  const at = slot != null ? slot : roomFor(c);
  if (at < 0) return { changer: c, full: true };
  if (here && here.slot === at) return { changer: c, slot: -1 };
  const replaced = c.slots[at] ? withoutRun(c.slots[at]) : null;
  const entries = entriesOf(c);
  entries[at] = { id: disc.id, kind: disc.kind, title: disc.title ?? null, artist: disc.artist ?? null, done: false, finishedAt: null, played: [], tracks: tracks.slice() };
  const stand = play || !here ? { slot: at, offset: 0 } : here;
  const nextDisc = next ? at : c.nextDisc === at ? null : c.nextDisc;
  return { changer: build(entries, stand, nextDisc), slot: at, replaced };
}

/** Takes the disc in `slot` out. The playing disc's going moves on as DISC SKIP would (or stands nowhere). */
export function eject(c, slot, modes = {}, rnd = Math.random) {
  if (!c.slots[slot]) return c;
  const here = slotOf(c, c.index);
  let stand = here;
  if (here && here.slot === slot) {
    const skip = discSkip(c, modes, rnd);
    stand = skip >= 0 ? slotOf(c, skip) : null;
  }
  const entries = entriesOf(c);
  entries[slot] = null;
  return build(entries, stand, c.nextDisc === slot ? null : c.nextDisc);
}

/** Files gone from the disk leave their discs (an emptied disc frees its slot); the changer stays on the same song. */
export function removePaths(c, gone) {
  const here = slotOf(c, c.index);
  let stand = null;
  if (here && !gone.has(c.queue[c.index])) {
    stand = { slot: here.slot, offset: tracksOf(c, here.slot).slice(0, here.offset).filter((p) => !gone.has(p)).length };
  }
  const entries = c.slots.map((d, s) => (d ? { ...withoutRun(d), played: [], tracks: tracksOf(c, s).filter((p) => !gone.has(p)) } : null));
  return build(entries, stand, c.nextDisc);
}

/**
 * An old flat queue (2.14 and before) as discs: a run of two or more tracks of the same album (`albumOf(p)` → { key,
 * title, artist, kind? } or null) is a disc; neighbouring other tracks are one CD-R titled `cdrTitle`. More than five
 * discs: the playing one and the four after it (wrapping round). → { changer, dropped }.
 */
export function fromQueue(paths, index, albumOf, { cdrTitle }) {
  const runs = [];
  paths.forEach((p, i) => {
    const a = albumOf(p), key = a ? a.key : null, last = runs[runs.length - 1];
    if (last && key && last.key === key) { last.tracks.push(p); last.to = i; } else runs.push({ key, album: a, tracks: [p], from: i, to: i });
  });
  const discs = [];
  for (const r of runs) {
    if (r.key && r.tracks.length >= 2) {
      discs.push({ disc: { id: `album:${r.key}`, kind: r.album.kind || 'album', title: r.album.title, artist: r.album.artist }, tracks: r.tracks, from: r.from, to: r.to });
      continue;
    }
    const last = discs[discs.length - 1];
    if (last && last.disc.kind === 'cdr') { last.tracks.push(...r.tracks); last.to = r.to; }
    else discs.push({ disc: { id: `cdr:${r.tracks[0]}`, kind: 'cdr', title: cdrTitle, artist: null }, tracks: [...r.tracks], from: r.from, to: r.to });
  }
  const playing = Math.max(0, discs.findIndex((d) => index >= d.from && index <= d.to));
  const kept = discs.length <= SLOTS ? discs : Array.from({ length: SLOTS }, (_, k) => discs[(playing + k) % discs.length]);
  const entries = Array(SLOTS).fill(null);
  kept.forEach((d, s) => { entries[s] = { ...d.disc, done: false, finishedAt: null, played: [], tracks: d.tracks }; });
  const stand = index >= 0 && discs.length ? { slot: kept.indexOf(discs[playing]), offset: index - discs[playing].from } : null;
  return { changer: build(entries, stand, null), dropped: discs.length - kept.length };
}

// (Task 2 adds the order: nextIndex, previousIndex, discSkip, playSlot, moveTo, markFinished.)
export function discSkip() { return -1; }
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/changer.test.mjs`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/js/changer.js test/changer.test.mjs
git commit -m "The changer's model: five slots, each a run of the queue — loading, ejecting, files that went, and an old queue as discs"
```

---

### Task 2: The changer's order — modes, disc skip, finished discs

**Files:**
- Modify: `src/renderer/js/changer.js` (replace the placeholder `discSkip` at the end)
- Test: `test/changer.test.mjs`

**Interfaces:**
- Consumes: Task 1's `Changer`, `slotOf`, `tracksOf`.
- Produces:
  - `Modes = { shuffle: 'OFF'|'DISC'|'ALL', repeat: 'OFF'|'TRACK'|'DISC'|'ALL' }`
  - `nextIndex(c, modes, rnd = Math.random) → index | -1` (doesn't change `c`)
  - `previousIndex(c) → index | -1`
  - `discSkip(c, modes, rnd) → index | -1`; `playSlot(c, slot) → index | -1`
  - `moveTo(c, index) → Changer` (stands there; clears `nextDisc` on reaching it; a finished disc played again is unfinished)
  - `markFinished(c, index, modes, now = Date.now()) → Changer`

- [ ] **Step 1: Write the failing tests** (append to `test/changer.test.mjs`)

```js
import { nextIndex, previousIndex, discSkip, playSlot, moveTo, markFinished } from '../src/renderer/js/changer.js';

const OFF = { shuffle: 'OFF', repeat: 'OFF' };
const three = () => fill(3); // d0/1 d0/2 | d1/1 d1/2 | d2/1 d2/2, standing on 0
const at = (c, i) => ({ ...c, index: i });
const seq = (...values) => { let k = 0; return () => values[k++ % values.length]; };

test('in order: through the disc, on to the next slot, and after the last slot — the end', () => {
  const c = three();
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map((i) => nextIndex(at(c, i), OFF)), [1, 2, 3, 4, 5, -1]);
  assert.strictEqual(nextIndex(at(c, 5), { shuffle: 'OFF', repeat: 'ALL' }), 0);
  assert.strictEqual(nextIndex(at(c, 3), { shuffle: 'OFF', repeat: 'DISC' }), 2);
  assert.strictEqual(nextIndex(at(c, 3), { shuffle: 'OFF', repeat: 'TRACK' }), 3);
});

test('an empty slot between discs is passed over; PLAY NEXT\'s disc comes after the playing one', () => {
  let c = eject(three(), 1); // d0 | — | d2
  assert.strictEqual(c.queue[nextIndex(at(c, 1), OFF)], 'd2/1');
  c = load(three(), disc('n'), ['n1'], { next: true }).changer; // slot 3, next
  assert.strictEqual(c.queue[nextIndex(at(c, 1), OFF)], 'n1');
  c = moveTo(c, c.queue.indexOf('n1'));
  assert.strictEqual(c.nextDisc, null, 'reached: no longer marked');
});

test('SHUFFLE DISC: the disc\'s unplayed songs at random, then the next disc', () => {
  let c = load(empty(), disc('a'), ['a1', 'a2', 'a3']).changer;
  c = load(c, disc('b'), ['b1', 'b2']).changer;
  const modes = { shuffle: 'DISC', repeat: 'OFF' };
  assert.strictEqual(nextIndex(c, modes, seq(0.99)), 2, 'a3: of a2, a3 (not a1, playing)');
  c = markFinished(c, 0, modes); c = moveTo(c, 2);
  c = markFinished(c, 2, modes); c = moveTo(c, 1);
  assert.ok(['b1', 'b2'].includes(c.queue[nextIndex(c, modes, seq(0))]), 'a1 a3 played, on a2: the next disc');
  c = markFinished(c, 1, modes);
  assert.strictEqual(c.slots[0].done, true);
});

test('SHUFFLE ALL: any unplayed song of any disc; once all are played, the end (or again, repeating)', () => {
  let c = load(empty(), disc('a'), ['a1']).changer;
  c = load(c, disc('b'), ['b1']).changer;
  const modes = { shuffle: 'ALL', repeat: 'OFF' };
  assert.strictEqual(nextIndex(c, modes, seq(0)), 1);
  c = markFinished(c, 0, modes); c = moveTo(c, 1); c = markFinished(c, 1, modes);
  assert.strictEqual(nextIndex(c, modes, seq(0)), -1);
  assert.strictEqual(nextIndex(c, { shuffle: 'ALL', repeat: 'ALL' }, seq(0)), 0);
});

test('a disc is finished at its last song in order (or all of them, shuffled), and unfinished when played again', () => {
  let c = three();
  c = markFinished(c, 0, OFF, 5);
  assert.strictEqual(c.slots[0].done, false);
  c = markFinished(c, 1, OFF, 7);
  assert.deepStrictEqual([c.slots[0].done, c.slots[0].finishedAt], [true, 7]);
  c = moveTo(c, 0);
  assert.strictEqual(c.slots[0].done, false);
});

test('previous: the song before, across discs; DISC SKIP and the slot buttons', () => {
  const c = three();
  assert.deepStrictEqual([previousIndex(at(c, 2)), previousIndex(at(c, 0))], [1, -1]);
  assert.strictEqual(discSkip(at(c, 1), OFF), 2);
  assert.strictEqual(discSkip(at(c, 4), OFF), 0, 'wraps round');
  assert.strictEqual(discSkip(at(c, 1), { shuffle: 'DISC', repeat: 'OFF' }, seq(0.99)), 3);
  assert.strictEqual(discSkip(load(empty(), disc('a'), ['a1']).changer, OFF), -1, 'one disc: nowhere to go');
  assert.deepStrictEqual([playSlot(c, 2), playSlot(c, 4)], [4, -1]);
});

test('ejecting the playing disc moves on to the next disc', () => {
  const moved = eject(at(three(), 3), 1); // on d1/2, slot 1 out
  assert.strictEqual(moved.queue[moved.index], 'd2/1');
  assert.ok(check(moved));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/changer.test.mjs`
Expected: FAIL — `nextIndex` (and the others) not exported.

- [ ] **Step 3: Implement** — replace the last two lines of `changer.js` (the comment and the placeholder `discSkip`) with:

```js
// ---- The order: which song comes next, by the changer's modes ----------------------------------------------------

const occupied = (c) => c.slots.map((d, s) => (d ? s : -1)).filter((s) => s >= 0);
// The next occupied slot after `slot` (round to the first with `wrap`), or -1.
function slotAfter(c, slot, wrap) {
  const occ = occupied(c);
  const later = occ.find((s) => s > slot);
  return later != null ? later : wrap && occ.length ? occ[0] : -1;
}
const offsets = (d) => Array.from({ length: d.end - d.start }, (_, k) => k);
const unplayed = (d) => offsets(d).filter((k) => !d.played.includes(k));
const pick = (list, rnd) => list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];

/** The queue position to play after the one the changer stands on, by `modes` — or -1 at the end. */
export function nextIndex(c, { shuffle = 'OFF', repeat = 'OFF' } = {}, rnd = Math.random) {
  const here = slotOf(c, c.index);
  if (!here) return -1;
  if (repeat === 'TRACK') return c.index;
  const d = c.slots[here.slot], len = d.end - d.start;
  if (shuffle === 'ALL') {
    const left = c.slots.flatMap((x) => (x ? unplayed(x).map((k) => x.start + k) : [])).filter((i) => i !== c.index);
    if (left.length) return pick(left, rnd);
    if (repeat === 'OFF') return -1;
    const any = c.queue.map((_, i) => i).filter((i) => i !== c.index);
    return any.length ? pick(any, rnd) : c.index;
  }
  if (shuffle === 'DISC') {
    const left = unplayed(d).filter((k) => k !== here.offset);
    if (left.length) return d.start + pick(left, rnd);
    if (repeat === 'DISC') { const others = offsets(d).filter((k) => k !== here.offset); return d.start + (others.length ? pick(others, rnd) : here.offset); }
  } else if (here.offset + 1 < len) return c.index + 1;
  else if (repeat === 'DISC') return d.start;
  const to = c.nextDisc != null && c.nextDisc !== here.slot ? c.nextDisc : slotAfter(c, here.slot, repeat === 'ALL');
  if (to < 0) return -1;
  const n = c.slots[to];
  if (shuffle === 'DISC') { const l = unplayed(n); return n.start + pick(l.length ? l : offsets(n), rnd); }
  return n.start;
}

/** The song before: the previous one on the disc, or the last of the disc before. -1 at the very start. */
export const previousIndex = (c) => (c.index > 0 ? c.index - 1 : -1);

/** DISC SKIP: the next occupied slot (round to the first), its first song — a random one when shuffling. -1: no other disc. */
export function discSkip(c, { shuffle = 'OFF' } = {}, rnd = Math.random) {
  const here = slotOf(c, c.index);
  if (!here) return -1;
  const to = slotAfter(c, here.slot, true);
  if (to < 0 || to === here.slot) return -1;
  const n = c.slots[to];
  return shuffle === 'OFF' ? n.start : n.start + pick(offsets(n), rnd);
}

/** A slot's button (or a click on its disc): its first song, or -1 for an empty slot. */
export const playSlot = (c, slot) => (c.slots[slot] ? c.slots[slot].start : -1);

/** The changer stands on `index`: PLAY NEXT's disc, reached, is no longer marked; a finished disc played again isn't. */
export function moveTo(c, index) {
  const here = slotOf(c, index);
  if (!here) return { ...c, index: -1 };
  const slots = c.slots.slice();
  if (slots[here.slot].done) slots[here.slot] = { ...slots[here.slot], done: false, finishedAt: null };
  return { ...c, slots, index, nextDisc: c.nextDisc === here.slot ? null : c.nextDisc };
}

/** The song at `index` played to its end: noted; its disc is finished at its last song (shuffled: once all have played). */
export function markFinished(c, index, { shuffle = 'OFF' } = {}, now = Date.now()) {
  const here = slotOf(c, index);
  if (!here) return c;
  const slots = c.slots.slice(), d = slots[here.slot], len = d.end - d.start;
  const played = d.played.includes(here.offset) ? d.played : [...d.played, here.offset];
  const over = shuffle === 'OFF' ? here.offset === len - 1 : played.length >= len;
  // SHUFFLE DISC starts the disc's next round afresh; SHUFFLE ALL keeps count until every disc has played.
  slots[here.slot] = over ? { ...d, done: true, finishedAt: now, played: shuffle === 'ALL' ? played : [] } : { ...d, played };
  return { ...c, slots };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/changer.test.mjs`
Expected: PASS (17 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/js/changer.js test/changer.test.mjs
git commit -m "The changer's order: SHUFFLE off, disc or all, REPEAT off, track, disc or all, DISC SKIP, and when a disc has finished"
```

---

### Task 3: Keeping the changer between launches

**Files:**
- Modify: `src/renderer/js/changer.js` (append `serialize`, `parse`)
- Modify: `src/main/store.js` (`FILES.changer`, `writeQueue`, `readQueue`)
- Modify: `src/main/main.js` (nothing: `state:load` already returns `store.readQueue()`)
- Test: `test/changer.test.mjs`, `test/state.test.js`

**Interfaces:**
- Consumes: Task 1 `build`-shaped changers, `check`.
- Produces:
  - `serialize(c) → string` (the `changer.txt` text)
  - `parse(text, queue, index) → Changer | null` (null: missing, unreadable, or not matching the queue)
  - `store.writeQueue({ paths, index, positionMicros, changer })` also writes `changer.txt` when `changer` (a string) is given; `store.readQueue()` → `{ paths, index, positionMicros, changerText }` (`changerText` null when there's none). When `readQueue` drops missing files, `changerText` is returned as null (the runs no longer match) — the renderer rebuilds it with `fromQueue`.

- [ ] **Step 1: Failing tests**

Append to `test/changer.test.mjs`:

```js
import { serialize, parse } from '../src/renderer/js/changer.js';

test('the changer round-trips through changer.txt; text that doesn\'t fit the queue is refused', () => {
  let c = load(fill(3), disc('n', { title: 'Tab\there', artist: null }), ['n1'], { next: true }).changer;
  c = markFinished(c, 1, OFF, 99);
  const back = parse(serialize(c), c.queue, c.index);
  assert.deepStrictEqual(back.slots.map((d) => d && [d.id, d.kind, d.title, d.artist, d.start, d.end, d.done, d.finishedAt]),
    c.slots.map((d) => d && [d.id, d.kind, d.title.replace(/\t/g, ' '), d.artist, d.start, d.end, d.done, d.finishedAt]));
  assert.strictEqual(back.nextDisc, 3);
  assert.strictEqual(parse(serialize(c), c.queue.slice(1), 0), null, 'the queue lost a song');
  assert.strictEqual(parse('v1\t-\nalbum\t0\t9\t0\t\tx\tX\t\n-\n-\n-\n-', ['a'], 0), null, 'a run past the queue');
  assert.strictEqual(parse('garbage', ['a'], 0), null);
  assert.strictEqual(parse(null, ['a'], 0), null);
});
```

In `test/state.test.js`, after the existing queue test (line ~80), add:

```js
test('changer.txt is written beside queue.txt and read back; a queue that lost files comes back without it', () => {
  const a = path.join(home, 'ch-a.mp3'), b = path.join(home, 'ch-b.mp3');
  fs.writeFileSync(a, ''); fs.writeFileSync(b, '');
  store.writeQueue({ paths: [a, b], index: 1, positionMicros: 0, changer: 'v1\t-\nalbum\t0\t2\t0\t\tid\tT\tA\n-\n-\n-\n-' });
  assert.strictEqual(store.readQueue().changerText, 'v1\t-\nalbum\t0\t2\t0\t\tid\tT\tA\n-\n-\n-\n-');
  fs.rmSync(b);
  assert.strictEqual(store.readQueue().changerText, null);
});
```

Also update the two existing `deepStrictEqual(store.readQueue(), {...})` lines in that file to include `changerText: null`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/changer.test.mjs test/state.test.js`
Expected: FAIL — `serialize` not exported; `changerText` undefined.

- [ ] **Step 3: Implement**

Append to `changer.js`:

```js
// ---- changer.txt: "v1<TAB>nextDisc|-", then a line per slot: "-" or kind, start, end, done, finishedAt, id, title, artist ----

const clean = (s) => (s == null ? '' : String(s).replace(/[\t\n\r]+/g, ' '));
export function serialize(c) {
  const lines = [`v1\t${c.nextDisc ?? '-'}`];
  for (const d of c.slots) {
    lines.push(d ? [d.kind, d.start, d.end, d.done ? 1 : 0, d.finishedAt ?? '', clean(d.id), clean(d.title), clean(d.artist)].join('\t') : '-');
  }
  return lines.join('\n');
}
/** changer.txt's text for this queue → the changer, or null when it's missing, unreadable or doesn't fit the queue. */
export function parse(text, queue, index) {
  if (typeof text !== 'string') return null;
  const lines = text.split('\n');
  const head = /^v1\t(\d|-)$/.exec(lines[0] || '');
  if (!head || lines.length < SLOTS + 1) return null;
  const slots = [];
  for (let s = 0; s < SLOTS; s++) {
    const line = lines[s + 1];
    if (line === '-') { slots.push(null); continue; }
    const [kind, start, end, done, finishedAt, id, title, artist] = line.split('\t');
    if (!['album', 'cdr', 'spotify', 'audiocd'].includes(kind) || !id) return null;
    slots.push({ id, kind, title: title || null, artist: artist || null, start: Number(start), end: Number(end), done: done === '1', finishedAt: finishedAt ? Number(finishedAt) : null, played: [] });
  }
  const c = { slots, queue: queue.slice(), index: index >= 0 && index < queue.length ? index : -1, nextDisc: head[1] === '-' ? null : Number(head[1]) };
  try { check(c); } catch { return null; }
  return c;
}
```

In `src/main/store.js`: add `changer: 'changer.txt'` to `FILES`; in `readQueue`, return `changerText: dropped ? null : readText(FILES.changer)` where `dropped` is true when any saved path was skipped as missing (the function already maps `savedIndex` over kept paths — add a `let dropped = false;` set to `true` in the skip branch); in `writeQueue`, after writing `queue.txt`, `if (typeof changer === 'string') writeText(FILES.changer, changer);` (destructure `changer` from the argument). Return the empty case as `null` as before.

- [ ] **Step 4: Run the tests**

Run: `node --test test/changer.test.mjs test/state.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/js/changer.js src/main/store.js test/changer.test.mjs test/state.test.js
git commit -m "The changer is kept between launches in changer.txt, beside the queue; text that doesn't fit the queue is rebuilt"
```

---

### Task 4: Spotify's upcoming tracks under the changer — and the mixed-disc check

**Files:**
- Modify: `src/renderer/js/spotify-deck.js:28-31`
- Test: `test/spotify-deck.test.mjs:38-43`

**Interfaces:**
- Produces: `spotifyUpcoming(queue, index, { shuffle, repeat }, end = queue.length) → string[]` — the Spotify tracks straight after `index`, in order, up to `end` (the playing disc's end) or the first non-Spotify track; `[]` when shuffling or repeating a track or a disc.

- [ ] **Step 1: Failing test** — replace the existing `spotifyUpcoming` assertions (lines 39–42) with:

```js
  assert.deepStrictEqual(spotifyUpcoming(q, 0, { shuffle: 'OFF', repeat: 'OFF' }), [B, C]);
  assert.deepStrictEqual(spotifyUpcoming(q, 2, { shuffle: 'OFF', repeat: 'ALL' }), []);
  assert.deepStrictEqual(spotifyUpcoming(q, 0, { shuffle: 'DISC', repeat: 'OFF' }), []);
  assert.deepStrictEqual(spotifyUpcoming(q, 0, { shuffle: 'OFF', repeat: 'TRACK' }), []);
  assert.deepStrictEqual(spotifyUpcoming(q, 0, { shuffle: 'OFF', repeat: 'DISC' }), []);
  assert.deepStrictEqual(spotifyUpcoming([A, B, '/music/x.flac', C], 0, { shuffle: 'OFF', repeat: 'OFF' }), [B], 'stops at a file');
  assert.deepStrictEqual(spotifyUpcoming(q, 0, { shuffle: 'OFF', repeat: 'OFF' }, 2), [B], 'stops at the disc\'s end');
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test test/spotify-deck.test.mjs`
Expected: FAIL on "stops at a file".

- [ ] **Step 3: Implement**

```js
/** The Spotify tracks to queue after `index`: in order, to the disc's `end` or the first track that isn't Spotify's. */
export function spotifyUpcoming(queue, index, { shuffle, repeat }, end = queue.length) {
  if (shuffle !== 'OFF' || repeat === 'TRACK' || repeat === 'DISC' || index < 0) return [];
  const out = [];
  for (let i = index + 1; i < Math.min(end, queue.length) && isSpotifyUri(queue[i]); i++) out.push(queue[i]);
  return out;
}
```

- [ ] **Step 4: Run** `node --test test/spotify-deck.test.mjs` — PASS.

- [ ] **Step 5: The mixed-disc check (manual, before Task 5 is built on it).** `load()` in `app.js:400` already picks the Spotify deck per track, so a file after a Spotify track should simply switch decks at the seam. Verify by reading `load`, `loadSpotify` and `SpotifyTrackElement` that ending a Spotify track whose upcoming list is now `[]` fires `trackFinished` (`OVERRUN_MS` path) rather than Spotify playing on by itself. Write the finding (yes / no, and why) into the task's commit message. If it is **no**, stop and ask the user before Task 5 (the fallback from the spec: a Spotify disc unloads the other discs).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/js/spotify-deck.js test/spotify-deck.test.mjs
git commit -m "Spotify is told only the tracks of its own disc that come next, in order, up to the first file (checked: <finding>)"
```

---

### Task 5: The app plays from the changer

**Files:**
- Modify: `src/renderer/js/app.js` — state (line ~52), queue section (lines 155–345), transport (lines 672–706), tray (`putDiscOnTray` 1008–1016), Spotify (`stopSpotify`, `spotifyResync`), Audio CD (`onAudioCdGone`), file actions (1491–1520), modes (1555–1566), persistence (1529–1532), restore (1932–1937), keys (1670–1673), `pushMini` (1451)
- Modify: `src/renderer/js/mini.js:104-108`
- Delete: `src/renderer/js/play-next.js`, and its test file if one exists (`git grep -l play-next test/`)
- Test: `test/changer.test.mjs` (the disc builders), existing suite

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces (used by Tasks 6–8, exported on `app`): `app.changerState() → { slots, nextDisc, index, queue }`, `app.loadDisc(disc, tracks, { play, next }) → Promise<{ slot } | { cancelled: true }>`, `app.playSlot(slot)`, `app.ejectSlot(slot)`, `app.discSkip()`, and `app.onFullChanger = async (changer) → slot | null` (Task 7 sets it; until then it resolves `null`).
- Also exported from `changer.js` (new, pure, tested here): `discFor({ kind, paths, details, title, now }) → { id, kind, title, artist }` — the disc a set of tracks makes: one album (all `details` share album + album artist) → `{ id: 'album:' + key, kind: 'album', title: album, artist }`; otherwise `{ id: 'cdr:' + now, kind: 'cdr', title, artist: null }`.

- [ ] **Step 1: Failing test for `discFor`** (append to `test/changer.test.mjs`)

```js
import { discFor } from '../src/renderer/js/changer.js';

test('the disc a set of tracks makes: one album is that album; anything else is a CD-R', () => {
  const d = (album, artist) => ({ album, artist, credits: {} });
  assert.deepStrictEqual(discFor({ paths: ['1', '2'], details: [d('Ænima', 'Tool'), d('Ænima', 'Tool')], title: 'MIX · 14 OCT', now: 5 }),
    { id: 'album:tool\nænima', kind: 'album', title: 'Ænima', artist: 'Tool' });
  assert.deepStrictEqual(discFor({ paths: ['1', '2'], details: [d('Ænima', 'Tool'), d('Issues', 'Korn')], title: 'MIX · 14 OCT', now: 5 }),
    { id: 'cdr:5', kind: 'cdr', title: 'MIX · 14 OCT', artist: null });
  assert.strictEqual(discFor({ kind: 'spotify', paths: ['s'], details: [d('X', 'Y')], title: 'MIX', now: 5 }).kind, 'spotify');
});
```

Implement in `changer.js`:

```js
const key = (s) => String(s || '').toLowerCase().trim();
/** The disc that `paths` (with their `details`) make: their one album, or a CD-R titled `title`. `kind` overrides. */
export function discFor({ kind = null, paths, details, title, now = Date.now() }) {
  const artistOf = (d) => (d && ((d.credits && d.credits.albumArtist) || d.artist)) || '';
  const first = details[0];
  const one = first && first.album && details.length === paths.length
    && details.every((d) => d && key(d.album) === key(first.album) && key(artistOf(d)) === key(artistOf(first)));
  if (one) return { id: `album:${key(artistOf(first))}\n${key(first.album)}`, kind: kind || 'album', title: first.album, artist: artistOf(first) || null };
  return { id: `${kind || 'cdr'}:${now}`, kind: kind || 'cdr', title, artist: null };
}
```

Run `node --test test/changer.test.mjs` — PASS.

- [ ] **Step 2: The adapter and modes in `app.js`.** Add `import * as changer from './changer.js';` and `locale` to the `./i18n.js` import; delete the `play-next.js` import. In `state` replace `shuffle: false, repeat: 'OFF'` with `shuffle: 'OFF', repeat: 'OFF', changer: { slots: Array(5).fill(null), nextDisc: null }` and delete `nextUp`. Add after the state block:

```js
// The changer (changer.js) owns state.queue and state.index together with the slots; these two read and write all three.
const ch = () => ({ ...state.changer, queue: state.queue, index: state.index });
function apply(c) {
  state.changer = { slots: c.slots, nextDisc: c.nextDisc };
  state.queue = c.queue; state.index = c.index;
  upcomingCache = null;
}
const modes = () => ({ shuffle: state.shuffle, repeat: state.repeat });
```

Replace `shuffleCache`, `nextIndex()` and `upcomingIndex()` with one cached call (a shuffle's pick must stay the same between UP NEXT, preloading and the song's end):

```js
let upcomingCache = null; // { index, value }: the shuffle's pick, the same until the changer moves or changes
function upcomingIndex() {
  if (upcomingCache && upcomingCache.index === state.index) return upcomingCache.value;
  const value = changer.nextIndex(ch(), modes());
  upcomingCache = { index: state.index, value };
  return value;
}
```

Cycle the modes (replace `toggleShuffle` / `cycleRepeat` bodies):

```js
const SHUFFLES = ['OFF', 'DISC', 'ALL'], REPEATS = ['OFF', 'TRACK', 'DISC', 'ALL'];
function toggleShuffle() {
  state.shuffle = SHUFFLES[(SHUFFLES.indexOf(state.shuffle) + 1) % SHUFFLES.length];
  shuffleButton.setOn(state.shuffle !== 'OFF'); shuffleButton.setBadge(state.shuffle === 'OFF' ? null : state.shuffle === 'DISC' ? t('DISC') : t('ALL'));
  shuffleButton.title = state.shuffle === 'OFF' ? t('Shuffle') : state.shuffle === 'DISC' ? t('Shuffle: this disc') : t('Shuffle: all discs');
  upcomingCache = null; renderQueue(); spotifyResync(); pushMini(true);
}
function cycleRepeat() {
  state.repeat = REPEATS[(REPEATS.indexOf(state.repeat) + 1) % REPEATS.length];
  repeatButton.setOn(state.repeat !== 'OFF');
  repeatButton.setBadge(state.repeat === 'TRACK' ? '1' : state.repeat === 'DISC' ? t('DISC') : state.repeat === 'ALL' ? t('ALL') : null);
  repeatButton.title = { OFF: t('Repeat'), TRACK: t('Repeat: this track'), DISC: t('Repeat: this disc'), ALL: t('Repeat: all discs') }[state.repeat];
  upcomingCache = null; renderQueue(); spotifyResync(); pushMini(true);
}
```

(Keep whatever the old functions did after setting the button — read lines 1555–1566 and carry over any extra call.) If `modeButton(...).setBadge` doesn't exist on the shuffle button, it's the same `modeButton` factory as repeat — it does.

- [ ] **Step 3: Transport.** Replace `nextTrack`, `previousTrack` and the end of `trackFinished`:

```js
function goTo(index) {
  apply(changer.moveTo(ch(), index));
  load(state.queue[state.index]);
}
function nextTrack() {
  const next = upcomingIndex();
  if (next < 0) return false;
  goTo(next);
  return true;
}
function previousTrack() {
  if (engine.deck && engine.position > 5) { seekTo(0); return; }
  const prev = changer.previousIndex(ch());
  if (prev >= 0) goTo(prev); else if (engine.deck) seekTo(0);
}
function discSkip() {
  const to = changer.discSkip(ch(), modes());
  if (to < 0) { setStatus(t('NO OTHER DISC IN THE CHANGER')); return; }
  goTo(to);
}
function playSlot(slot) {
  const to = changer.playSlot(ch(), slot);
  if (to >= 0) goTo(to);
}
```

In `trackFinished`, before computing `next`, note the song as played: `apply({ ...changer.markFinished(ch(), state.index, modes()), index: state.index }); saveQueueSoon();` and treat `state.repeat === 'TRACK'` where the code says `'ONE'`. Every other `state.index = …; load(…)` pair in `app.js` (`setupQueueDrag`'s click, `toggle`, `closeTray`, restore) becomes `goTo(i)` or stays `load(state.queue[state.index])` when the index doesn't change.

- [ ] **Step 4: Loading discs.** Replace `addToQueue`, `playNext`, `appendAndPlay`, `loadPlaylist`'s queue push, `putDiscOnTray`, and the clear/undo pair. Remove `removeFromQueue` and `setupQueueDrag` (tracks can't be removed or reordered on a disc) and their call sites.

```js
const cdrTitle = () => t('MIX · {date}', { date: new Date().toLocaleDateString(locale, { day: 'numeric', month: 'short' }).toUpperCase() });
async function discOf(paths, { kind = null, title = null } = {}) {
  const details = await Promise.all(paths.map((p) => detailsCache.get(p) || cdp.details(p, { withCover: false }).catch(() => null)));
  return changer.discFor({ kind, paths, details, title: title || cdrTitle() });
}
// Into the changer: a free slot, a finished disc's, or the one the user picks. → { slot } or { cancelled: true }.
// (`item`, not `disc`: `disc` is the big disc's renderer everywhere else in app.js.)
async function loadDisc(item, tracks, { play = false, next = false } = {}) {
  let r = changer.load(ch(), item, tracks, { play, next });
  if (r.full) {
    const slot = await app.onFullChanger(ch());
    if (slot == null) return { cancelled: true };
    r = changer.load(ch(), item, tracks, { play, next, slot });
  }
  if (r.already) { setStatus(t('ALREADY IN SLOT {n}', { n: r.slot + 1 })); if (play) playSlot(r.slot); changerView.turnTo(r.slot); return { slot: r.slot }; }
  if (r.slot < 0) return { cancelled: true };
  const wasPlaying = state.index >= 0 && !!engine.deck;
  apply(r.changer);
  setStatus(r.replaced ? t('DISC {n} IN · {title} WENT BACK TO THE SHELF', { n: r.slot + 1, title: r.replaced.title || t('CD-R') }) : t('DISC {n} IN', { n: r.slot + 1 }));
  renderQueue(); saveQueueSoon(); spotifyResync();
  if (play || !wasPlaying) load(state.queue[state.index], { autoPlay: play });
  return { slot: r.slot };
}
async function addToQueue(items, { sorted = false, play = false, next = false, title = null } = {}) {
  const songs = sorted ? items : await cdp.collectAudio(items);
  if (!songs.length) { setStatus(t('NO SUPPORTED AUDIO FOUND')); return; }
  if (disc.trayOpen && !state.trayBusy) { putDiscOnTray(songs); return; }
  await loadDisc(await discOf(songs, { title }), songs, { play, next });
}
const playNext = (items, opts = {}) => addToQueue(items, { ...opts, next: true });
const appendAndPlay = (p) => addToQueue([p], { sorted: true, play: true });
```

`loadPlaylist` ends with `await loadDisc(await discOf(r.tracks, { title: r.name || null }), r.tracks, {})` (use the playlist's file name when the dialog returns one; if it doesn't, add `name: path.basename(file, '.m3u')` to `dialog:loadPlaylist`'s result in `main.js`). `putDiscOnTray(paths, start, status)` becomes: build the disc with `discOf`, `loadDisc(disc, paths, { play: false })`, then `apply(changer.moveTo(ch(), state.changer.slots[slot].start + start))` and the existing `load(…, { autoPlay: false })` and status. `insertDisc` keeps its tray animation and calls `putDiscOnTray`. Spotify's `playSpotifyDisc` passes `{ kind: 'spotify', title: name }`; `playAudioCd` passes `{ kind: 'audiocd', title: cd.album || t('AUDIO CD') }` — thread `kind`/`title` from `insertDisc` through `putDiscOnTray` to `discOf`. Delete every `if (spotifyDiscIn()) { insertDisc(…); return; }` early return: a Spotify disc is one slot now.

Clear / undo:

```js
function clearQueue() {
  if (!state.queue.length) return;
  if (undoClear) clearTimeout(undoClear.timer);
  undoClear = { changer: ch(), position: engine.position, playing: engine.playing, timer: setTimeout(() => { undoClear = null; renderQueue(); }, UNDO_CLEAR_SECONDS * 1000) };
  apply(changer.clear());
  resetToIdle(t('CHANGER EMPTIED'));
  renderQueue(); saveQueueSoon();
}
function undoClearQueue() {
  if (!undoClear || state.queue.length) return;
  const u = undoClear;
  clearTimeout(u.timer); undoClear = null;
  apply(u.changer);
  renderQueue(); saveQueueSoon();
  setStatus(t('CHANGER RESTORED'));
  if (state.index >= 0) load(state.queue[state.index], { autoPlay: u.playing, startAt: u.position });
}
function ejectSlot(slot) {
  const playing = changer.slotOf(ch(), state.index);
  const wasOn = playing && playing.slot === slot;
  apply(changer.eject(ch(), slot, modes()));
  if (!state.queue.length || state.index < 0) resetToIdle(t('CHANGER EMPTY'));
  else if (wasOn) load(state.queue[state.index]);
  renderQueue(); saveQueueSoon(); spotifyResync();
}
```

Files that went (`onAudioCdGone`, the library-watch removal near line 939, `stopSpotify`): replace their `state.queue = state.queue.filter(…)` blocks with `const was = state.loadedPath; apply(changer.removePaths(ch(), gone)); if (state.index < 0 && was && gone.has(was)) resetToIdle(…same message…);`. `stopSpotify` builds `gone` from the Spotify URIs in the queue.

`spotifyResync`: `spotifySession.resync(spotifyUpcoming(state.queue, state.index, modes(), (state.changer.slots[(changer.slotOf(ch(), state.index) || {}).slot] || {}).end))`. Every other `spotifyUpcoming(` call in `app.js` gets the same fourth argument (grep for it).

- [ ] **Step 5: Persistence and restore.**

```js
function queueSnapshot() {
  return { paths: state.queue, index: state.index, positionMicros: engine.deck ? Math.round(engine.position * 1e6) : 0, changer: changer.serialize(ch()) };
}
```

Restore (replacing lines 1932–1937):

```js
if (saved.queue) {
  let c = changer.parse(saved.queue.changerText, saved.queue.paths, saved.queue.index);
  if (!c) {
    const details = await Promise.all(saved.queue.paths.map((p) => cdp.details(p, { withCover: false }).catch(() => null)));
    const byPath = new Map(saved.queue.paths.map((p, i) => [p, details[i]]));
    const albumOf = (p) => { const d = byPath.get(p); const artist = d && ((d.credits && d.credits.albumArtist) || d.artist); return d && d.album ? { key: `${artist || ''}\n${d.album}`.toLowerCase(), title: d.album, artist: artist || null, kind: isSpotifyUri(p) ? 'spotify' : 'album' } : null; };
    const r = changer.fromQueue(saved.queue.paths, saved.queue.index, albumOf, { cdrTitle: t('MIX') });
    c = r.changer;
    if (r.dropped) setStatus(t('5 DISCS IN THE CHANGER · {n} WENT BACK TO THE SHELF', { n: r.dropped }));
    setTimeout(saveQueueSoon, 0);
  }
  apply(c);
  renderQueue();
  if (state.index >= 0) load(state.queue[state.index], { autoPlay: false, startAt: saved.queue.positionMicros / 1e6 });
}
```

- [ ] **Step 6: Keys, mini, exports.** In `onKeyDown`'s `actions` add `d: discSkip, 1: () => playSlot(0), 2: () => playSlot(1), 3: () => playSlot(2), 4: () => playSlot(3), 5: () => playSlot(4)`. In `pushMini` send `shuffle: state.shuffle !== 'OFF', repeat: state.repeat === 'TRACK' ? 'ONE' : state.repeat === 'OFF' ? 'OFF' : 'ALL'` (mini.js's existing display understands these; give it the disc number too: `disc: (changer.slotOf(ch(), state.index) || { slot: -1 }).slot + 1`). In `mini.js`, where it renders the track line, append `· DISC ${s.disc}` when `s.disc > 0`. Add to the `app` object (line ~1790): `changerState: ch, loadDisc, playSlot, ejectSlot, discSkip, onFullChanger: async () => null`. Delete `src/renderer/js/play-next.js` (and `test/play-next.test.mjs` if present).

- [ ] **Step 7: Run everything**

Run: `npm test`
Expected: PASS (the removed play-next tests gone; nothing else failing). Then `node --check` isn't enough for modules — run the app isolated (see Task 9 Step 1 for the commands) and play a few tracks: next/previous across two discs, SHUFFLE and REPEAT badges cycling, quit and relaunch (the changer comes back), a `queue.txt` from 2.14 (copy `~/.cdplayer/queue.txt` into the isolated home **as a copy**) becomes discs.

- [ ] **Step 8: Commit**

```bash
git add -A src/renderer/js src/main test
git commit -m "The player plays from the changer: music goes in as discs, next and previous follow the changer's modes, D skips a disc and 1–5 play one, and a 2.14 queue comes back as discs"
```

---

### Task 6: The carousel

**Files:**
- Create: `src/renderer/js/changer-view.js`
- Modify: `src/renderer/index.html:58-71` (the queue card)
- Modify: `src/renderer/styles.css` (queue card styles → changer)
- Modify: `src/renderer/js/app.js` (`renderQueue` draws the changer; covers)
- Test: `test/changer.test.mjs` (the pure geometry helper)

**Interfaces:**
- Consumes: `app.changerState()`, `playSlot`, `ejectSlot`, `discSkip`, `goTo`, `queueDisplay`, `detailsCache`, `cdp.shelfCover(path)` (thumbnail data URL or null), `spotifyTracks.get(uri).cover`.
- Produces: `createChangerView(root, { onPlaySlot, onPlayTrack, coverFor, animations }) → { render(view), turnTo(slot) }` where `view = { slots: [{ title, artist, kind, done, next, firstPath } | null], playingSlot, tracks: [{ index, title, time, current }], heading, info }`; and the pure `trayAngle(slot) → degrees` exported from `changer.js` (`trayAngle(s) = 90 - s * 72`, the playing slot turned to the laser on the right).

- [ ] **Step 1: Failing test for `trayAngle`**

```js
import { trayAngle } from '../src/renderer/js/changer.js';
test('the tray turns the playing slot to the laser, a fifth of a turn a slot', () => {
  assert.deepStrictEqual([0, 1, 4].map(trayAngle), [90, 18, -198]);
});
```

Implement: `export const trayAngle = (slot) => 90 - slot * 72;` — run, PASS.

- [ ] **Step 2: Markup.** Replace `#queue-card`'s inner list with:

```html
<div id="queue-card">
  <div id="queue-head">
    <div id="queue-text">
      <div id="queue-info" data-i18n>CHANGER EMPTY</div>
      <div id="queue-next" data-i18n>DROP AN ALBUM OR A FOLDER TO LOAD A DISC</div>
    </div>
    <div id="queue-actions">
      <!-- the existing SEARCH, SAVE, LOAD, CLEAR buttons stay; add before CLEAR: -->
      <button class="pill small" id="disc-skip-button" title="Next disc (D)" data-i18n-title data-i18n>DISC SKIP</button>
      <button class="pill small" id="eject-disc-button" title="Take the playing disc out of the changer" data-i18n-title data-i18n>EJECT</button>
    </div>
  </div>
  <div id="changer"></div>
  <div id="disc-heading"></div>
  <div id="queue-list" class="scroll"></div>
</div>
```

Change SAVE's title to "Save the playing disc as a .m3u playlist file" and LOAD's to "Load a .m3u playlist file as a CD-R".

- [ ] **Step 3: The view.**

```js
// src/renderer/js/changer-view.js
// The changer's carousel, seen from above: five slots round a tray, each disc with its cover printed on it, the
// playing one turned to the laser on the side facing the big disc. Under it, the playing disc's tracklist.
import { el } from './widgets.js';
import { trayAngle } from './changer.js';
import { t } from './i18n.js';

export function createChangerView(root, { tray, heading, list, onPlaySlot, onPlayTrack, coverFor, animations }) {
  const ring = el('div', { class: 'changer-ring' });
  const discs = Array.from({ length: 5 }, (_, s) => {
    const art = el('div', { class: 'changer-art' });
    const node = el('button', { class: 'changer-disc empty', onClick: () => onPlaySlot(s) }, art, el('span', { class: 'changer-no' }, String(s + 1)));
    node.style.setProperty('--a', `${s * 72}deg`);
    ring.append(node);
    return { node, art, path: null };
  });
  tray.replaceChildren(el('div', { class: 'changer-tray' }, ring), el('div', { class: 'changer-laser', title: t('The laser') }));
  let angle = null;

  function turnTo(slot) {
    if (slot < 0) return;
    const target = trayAngle(slot);
    // Always the same way round, like a real carousel: a smaller angle than now goes on a full turn.
    let next = target;
    if (angle != null) while (next > angle) next -= 360;
    const steps = angle == null ? 0 : Math.round((angle - next) / 72);
    ring.style.transition = animations() && steps ? `transform ${steps * 400}ms cubic-bezier(.4,0,.2,1)` : 'none';
    ring.style.transform = `rotate(${next}deg)`;
    angle = next;
  }

  function render(view) {
    view.slots.forEach((d, s) => {
      const x = discs[s];
      x.node.className = `changer-disc${d ? '' : ' empty'}${d && d.done ? ' done' : ''}${d && d.next ? ' next' : ''}${s === view.playingSlot ? ' playing' : ''}${d && d.kind === 'cdr' ? ' cdr' : ''}`;
      x.node.title = d ? [t('DISC {n}', { n: s + 1 }), d.title, d.artist].filter(Boolean).join(' · ') : t('Slot {n} · empty', { n: s + 1 });
      x.node.disabled = !d;
      const path = d ? d.firstPath : null;
      if (path !== x.path) {
        x.path = path;
        x.art.style.backgroundImage = '';
        x.art.textContent = d && d.kind === 'cdr' ? d.title || '' : '';
        if (path) coverFor(path).then((src) => { if (x.path === path && src) { x.art.style.backgroundImage = `url("${src}")`; x.art.textContent = ''; } });
      }
    });
    turnTo(view.playingSlot);
    heading.textContent = view.heading;
    const scrollTop = list.scrollTop;
    list.replaceChildren(...view.tracks.map((tr) => el('div', { class: `queue-row${tr.current ? ' active' : ''}`, title: t('Play {song}', { song: tr.title }), onClick: () => onPlayTrack(tr.index) },
      el('span', { class: 'num' }, `${tr.no}.`), el('span', { class: 'entry' }, tr.title), el('span', { class: 'east' }, el('span', { class: 'duration' }, tr.time)))));
    list.scrollTop = scrollTop;
  }
  return { render, turnTo };
}
```

(`view.tracks[i].no` is the track's number on its disc, 1-based.)

- [ ] **Step 4: `renderQueue` in `app.js`** builds the view instead of rows (keep the undo/clear button lines at its top and `updateDiscData()`):

```js
function renderQueue() {
  updateDiscData();
  /* …the existing CLEAR / UNDO CLEAR lines, with t('Clear the queue') → t('Take every disc out') … */
  const c = ch(), here = changer.slotOf(c, state.index);
  const slots = c.slots.map((d, s) => (d ? { title: d.title, artist: d.artist, kind: d.kind, done: d.done, next: c.nextDisc === s, firstPath: c.queue[d.start] } : null));
  if (!here) {
    $('queue-info').textContent = c.queue.length ? t('CHANGER · {n} DISCS', { n: slots.filter(Boolean).length }) : t('CHANGER EMPTY');
    $('queue-next').textContent = t('DROP AN ALBUM OR A FOLDER TO LOAD A DISC');
    changerView.render({ slots, playingSlot: -1, tracks: [], heading: '' });
    return;
  }
  const d = c.slots[here.slot];
  const modeText = [state.shuffle !== 'OFF' ? t('SHUFFLE: {m}', { m: t(state.shuffle) }) : null, state.repeat !== 'OFF' ? t('REPEAT: {m}', { m: t(state.repeat) }) : null].filter(Boolean).join(' · ');
  $('queue-info').textContent = [t('DISC {n} · {at} / {of}', { n: here.slot + 1, at: here.offset + 1, of: d.end - d.start }), modeText].filter(Boolean).join(' · ');
  const next = upcomingIndex();
  $('queue-next').textContent = state.repeat === 'TRACK' ? t('REPEATING THIS TRACK')
    : next >= 0 && next !== state.index ? t('UP NEXT · {song}', { song: queueDisplay(state.queue[next]) }) : t('END OF THE LAST DISC');
  const tracks = changer.tracksOf(c, here.slot).map((p, k) => {
    ensureDetails(p);
    const det = detailsCache.get(p);
    return { index: d.start + k, no: k + 1, title: queueDisplay(p), time: formatDuration(det ? det.duration : 0), current: d.start + k === state.index };
  });
  changerView.render({ slots, playingSlot: here.slot, tracks, heading: [t('DISC {n}', { n: here.slot + 1 }), d.title || (d.kind === 'cdr' ? t('CD-R') : null), d.artist].filter(Boolean).join(' · ') });
}
```

Create the view once in `start()` (before the first `renderQueue`):

```js
changerView = createChangerView($('queue-card'), {
  tray: $('changer'), heading: $('disc-heading'), list: $('queue-list'),
  onPlaySlot: playSlot, onPlayTrack: goTo, animations: () => anim.enabled,
  coverFor: (p) => (isSpotifyUri(p) ? Promise.resolve((spotifyTracks.get(p) || {}).cover || null) : cdp.shelfCover(p).catch(() => null)),
});
$('disc-skip-button').addEventListener('click', discSkip);
$('eject-disc-button').addEventListener('click', () => { const h = changer.slotOf(ch(), state.index); if (h) ejectSlot(h.slot); });
```

(`let changerView = null;` near the other module-level lets.) `savePlaylist` saves `changer.tracksOf(ch(), here.slot)` — the playing disc — instead of `state.queue`.

- [ ] **Step 5: Styles** (append to `styles.css`; reuse the theme variables the queue card uses — read the `#queue-card` rules first and take its colour variables from there):

```css
#changer { position: relative; height: 150px; margin: 6px 0 4px; display: flex; justify-content: center; }
.changer-tray { position: relative; width: 150px; height: 150px; border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,.04) 0 30%, rgba(0,0,0,.35) 31% 100%); box-shadow: inset 0 2px 8px rgba(0,0,0,.6); }
.changer-ring { position: absolute; inset: 0; transform: rotate(90deg); }
.changer-disc { position: absolute; left: 50%; top: 50%; width: 52px; height: 52px; margin: -26px; border: 0; padding: 0; border-radius: 50%; cursor: pointer;
  transform: rotate(var(--a)) translateY(-46px) rotate(calc(-1 * var(--a))); background: #c9ccd2; box-shadow: 0 1px 3px rgba(0,0,0,.5); overflow: hidden; }
.changer-disc .changer-art { position: absolute; inset: 0; border-radius: 50%; background-size: cover; background-position: center; font: 600 8px/1.1 var(--marker-font, inherit); color: #223; display: flex; align-items: center; justify-content: center; text-align: center; padding: 8px; }
.changer-disc::after { content: ''; position: absolute; left: 50%; top: 50%; width: 10px; height: 10px; margin: -5px; border-radius: 50%; background: #111; box-shadow: 0 0 0 4px rgba(255,255,255,.35); }
.changer-disc.empty { background: transparent; box-shadow: inset 0 1px 4px rgba(0,0,0,.7); cursor: default; }
.changer-disc.done { filter: grayscale(.6) brightness(.6); }
.changer-disc.playing { outline: 2px solid var(--accent); outline-offset: 1px; }
.changer-disc.next .changer-no::before { content: '▸'; }
.changer-no { position: absolute; bottom: -1px; right: 2px; font: 700 9px/1 inherit; color: rgba(255,255,255,.8); text-shadow: 0 1px 2px #000; z-index: 1; }
.changer-laser { position: absolute; right: calc(50% - 95px); top: 50%; width: 12px; height: 4px; margin-top: -2px; border-radius: 2px; background: var(--accent); box-shadow: 0 0 6px var(--accent); }
#disc-heading { font-size: 12px; font-weight: 700; letter-spacing: .04em; margin: 2px 0 4px; opacity: .85; }
```

Because the ring is rotated, each disc counter-rotates (`rotate(calc(-1 * var(--a)))`) only for its own slot angle; add `.changer-ring .changer-art { transform: rotate(calc(-1 * var(--ring, 0deg))); }` and set `--ring` on the ring in `turnTo` (`ring.style.setProperty('--ring', `${next}deg`)`) so covers stay upright as the tray turns.

- [ ] **Step 6: The big disc changes with the tray.** In `goTo`, when the slot changes (`changer.slotOf(ch(), index).slot !== previous slot`) and animations are on, set `disc.spinning = false` before `load`, so the big disc slows while the tray turns; `load` starts it again as now. No other change.

- [ ] **Step 7: Run** `npm test` (PASS), then the isolated app (Task 9 Step 1): load three albums from the shelf with INTO THE CHANGER and look at it. Take a screenshot.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/js/changer-view.js src/renderer/js/changer.js src/renderer/js/app.js src/renderer/index.html src/renderer/styles.css test/changer.test.mjs
git commit -m "The queue list is a carousel of five discs with their covers, turning the playing one to the laser, with its tracklist under it"
```

---

### Task 7: The full changer's picker

**Files:**
- Modify: `src/renderer/js/panels.js` (new `pickDiscToTakeOut`)
- Modify: `src/renderer/js/app.js` (`app.onFullChanger`)

**Interfaces:**
- Consumes: `openPanel(name, build, opts)` / `closePanel(name)` / `isOpen(name)` / `refreshPanel` (panels.js's own helpers, used by `showTags`); `app.changerState()`; `coverFor`.
- Produces: `panels.pickDiscToTakeOut(app, changer) → Promise<slot | null>`; `app.onFullChanger = (c) => panels.pickDiscToTakeOut(app, c)`.

- [ ] **Step 1: Implement** in `panels.js`:

```js
/** All five slots hold unfinished discs: which one goes back to the shelf? → its slot, or null (Esc / CLOSE). Not the playing one. */
export function pickDiscToTakeOut(app, c) {
  return new Promise((resolve) => {
    let chosen = null;
    const here = app.changerSlotOf(c.index);
    const p = openPanel('changer-full', () => [
      title(t('THE CHANGER IS FULL')), el('div', { class: 'subtitle' }, t('Which disc goes back to the shelf?')),
      el('div', { class: 'changer-pick' }, c.slots.map((d, s) => {
        const b = el('button', { class: 'changer-pick-disc', disabled: s === here, title: s === here ? t('Playing') : t('Take it out') }, el('div', { class: 'changer-pick-art' }), el('div', { class: 'name' }, `${s + 1}. ${d.title || t('CD-R')}`), d.artist ? el('div', { class: 'by' }, d.artist) : null);
        b.addEventListener('click', () => { chosen = s; closePanel('changer-full'); });
        app.coverForPath(c.queue[d.start]).then((src) => { if (src) b.firstChild.style.backgroundImage = `url("${src}")`; });
        return b;
      })),
    ], { width: 560 });
    p.onClose = () => resolve(chosen);
  });
}
```

Export `changerSlotOf: (i) => (changer.slotOf(ch(), i) || { slot: -1 }).slot` and `coverForPath` (the same function given to `createChangerView` as `coverFor`) on `app`, and set `onFullChanger: (c) => panels.pickDiscToTakeOut(app, c)`.

Styles:

```css
.changer-pick { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-top: 12px; }
.changer-pick-disc { background: none; border: 0; color: inherit; cursor: pointer; text-align: center; font: inherit; }
.changer-pick-disc:disabled { opacity: .35; cursor: default; }
.changer-pick-art { width: 84px; height: 84px; margin: 0 auto 6px; border-radius: 50%; background: #c9ccd2 center/cover; box-shadow: 0 1px 4px rgba(0,0,0,.5); }
.changer-pick-disc .name { font-size: 11px; font-weight: 700; } .changer-pick-disc .by { font-size: 10px; opacity: .7; }
```

- [ ] **Step 2: Check it** in the isolated app: load five albums (none finished), then a sixth — the picker shows five covers, the playing one greyed; Esc loads nothing; picking slot 3 loads it there and the status says which went back. Screenshot.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/js/panels.js src/renderer/js/app.js src/renderer/styles.css
git commit -m "A full changer asks which disc goes back to the shelf — any but the one playing"
```

---

### Task 8: The shelf, the keys list, the help

**Files:**
- Modify: `src/renderer/js/shelf.js:373, 726-734` and the spine builder
- Modify: `src/renderer/js/panels.js` (`showShortcuts`), `src/renderer/js/help.js`

**Interfaces:**
- Consumes: `app.loadDisc`, `app.changerState()`, `app.discFor` (export `changer.discFor` on `app` too, or build the disc in shelf.js: `{ id: a.id, kind: 'album', title: a.title, artist: a.artist }` — use this one: the shelf's own album id, so ALREADY IN SLOT matches the shelf's albums exactly).
- Produces: nothing new.

- [ ] **Step 1: INTO THE CHANGER.** In `openCase`, replace the PLAY NEXT / ADD TO QUEUE pills:

```js
const discOfAlbum = () => ({ id: a.id, kind: 'album', title: a.title, artist: a.artist });
pill(t('PLAY NEXT'), unwrapped(() => { app.loadDisc(discOfAlbum(), a.tracks.map((x) => x.path), { next: true }); closeCase(); }), t('Into the changer, to play after the disc playing')),
pill(t('INTO THE CHANGER'), unwrapped(() => { app.loadDisc(discOfAlbum(), a.tracks.map((x) => x.path)); closeCase(); }), t('Load the album into a free slot of the changer')),
```

Line 373's drag target (`target === 'queue'`) calls `shelf.app.loadDisc(discOfAlbum(a), a.tracks.map((t) => t.path), { next })` the same way (define `discOfAlbum(a)` as a module-level helper and use it in both places). The PLAY path (`shelf.app.insertDisc(paths, …)` at line ~790) passes `{ disc: discOfAlbum(a) }` through `insertDisc` → `putDiscOnTray`, which uses it instead of `discOf(paths)` when given (add that option in Task 5's `putDiscOnTray`: `async function putDiscOnTray(paths, start = 0, status, { disc: given = null, kind, title } = {})`).

- [ ] **Step 2: Slot numbers on spines.** Where spines are built (find `IN_PLAYER` / `holds(a, shelf.inPlayer)` in `shelf.js`), add:

```js
// The changer slot this album is in (1–5), or 0.
function slotFor(a) {
  const c = shelf.app.changerState();
  const mine = new Set(a.tracks.map((x) => x.path));
  const s = c.slots.findIndex((d) => d && (d.id === a.id || mine.has(c.queue[d.start])));
  return s + 1;
}
```

and in the spine element append `slotFor(a) ? el('span', { class: 'spine-slot', title: t('In the changer, slot {n}', { n: slotFor(a) }) }, String(slotFor(a))) : null`. Style:

```css
.spine-slot { position: absolute; top: 4px; left: 50%; transform: translateX(-50%); min-width: 14px; height: 14px; border-radius: 7px; background: var(--accent); color: #000; font: 700 9px/14px inherit; text-align: center; }
```

Redraw spines when the changer changes: in `app.js` `renderQueue`, `if (isShelfOpen()) refreshShelfBadges()`, exported from `shelf.js` as a function that re-runs the badge for each on-screen spine (`spineFor(a)` exists).

- [ ] **Step 3: Keys and help.** In `panels.showShortcuts` add the rows `D — Next disc` and `1–5 — Play the disc in that slot`; in `help.js` add an FAQ entry: `{ q: t('Where did the queue go?'), a: t('It’s a five-disc changer now: albums, folders and playlists go in as discs. INTO THE CHANGER on the shelf loads one; D skips to the next disc, 1–5 play a slot, and SHUFFLE and REPEAT work on this disc or all of them.') }`.

- [ ] **Step 4: Check** in the isolated app: a shelf album loaded shows its slot number on its spine; loading it again says ALREADY IN SLOT n and turns the carousel; `?` lists D and 1–5. Screenshot.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/js/shelf.js src/renderer/js/panels.js src/renderer/js/help.js src/renderer/styles.css src/renderer/js/app.js
git commit -m "The shelf loads albums INTO THE CHANGER and numbers the spines of those in it; the keys list and help explain D and 1–5"
```

---

### Task 9: Russian, README, the whole thing in the app

**Files:**
- Modify: `src/locales/ru.json`, `README.md`

- [ ] **Step 1: Run the isolated app** (never the real profile):

```bash
H=$CLAUDE_JOB_DIR/tmp/changer-home; M=$CLAUDE_JOB_DIR/tmp/changer-music
rm -rf "$H" "$M"; mkdir -p "$H" "$M"; : > "$H/onboarded"; printf '%s' "$M" > "$H/lastpath.txt"
# copy (never move) three or four album folders from ~/Music into "$M"
CDPLAYER_HOME="$H" ./node_modules/.bin/electron . --remote-debugging-port=9333
```

Drive it over DevTools as done for the booklet (a small `cdp.mjs` with `Runtime.evaluate` and `Page.captureScreenshot`). Check, with a screenshot each: the empty changer; three discs loaded, one playing at the laser; a disc change turning the tray; SHUFFLE DISC / ALL and REPEAT badges; the full-changer picker; the shelf's slot numbers; relaunch keeps the changer; a copy of `~/.cdplayer/queue.txt` placed in `$H` (no `changer.txt`) comes back as one CD-R.

- [ ] **Step 2: Russian.** `npm run i18n -- ru`, then fill every empty string (e.g. `DISC SKIP` → `СЛЕДУЮЩИЙ ДИСК`, `INTO THE CHANGER` → `В ЧЕЙНДЖЕР`, `THE CHANGER IS FULL` → `ЧЕЙНДЖЕР ПОЛОН`, `DISC {n}` → `ДИСК {n}`, `ALREADY IN SLOT {n}` → `УЖЕ В ГНЕЗДЕ {n}`, `MIX · {date}` → `СБОРНИК · {date}`, `CD-R` stays, `DISC` → `ДИСК`, `ALL` → `ВСЕ`, `OFF` → `ВЫКЛ`, `TRACK` → `ТРЕК`; `5 DISCS IN THE CHANGER · {n} WENT BACK TO THE SHELF` with the plural forms `one/few/many/other` as the file does elsewhere). Run it again: `ru: N/N (100%)`.

- [ ] **Step 3: README.** In Features, replace "Playback — … `.m3u` playlists …" with a **CD changer** line: "**CD changer** — five discs in a carousel: albums, folders, playlists, Spotify and real CDs go in as discs; SHUFFLE and REPEAT for this disc or all of them, DISC SKIP (`D`) and `1`–`5`". Add `D` and `1`–`5` to the keyboard shortcuts table.

- [ ] **Step 4: Run everything**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/locales/ru.json README.md
git commit -m "The changer in Russian and in the README"
```

Then hand over to the user to try (merging `cd-changer` into `main` is their call — superpowers:finishing-a-development-branch).
