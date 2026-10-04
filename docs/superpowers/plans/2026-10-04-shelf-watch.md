# Shelf Watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The CD shelf brings itself up to date when the music folder changes, without being closed and opened again.

**Architecture:** `library-watch.js` in the main process watches the music folder recursively and, after 3 s of quiet, sends `library-changed`. The renderer's shelf, if open, re-asks for its albums (incremental through `shelf-cache.json`) and redraws only when the albums' signature changed, keeping its scroll; the existing `renderGate` holds that back while a case or booklet is out.

**Tech Stack:** Electron 44 (Node 22+: recursive `fs.watch` on macOS, Windows and Linux), `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-04-shelf-watch-design.md`

## Global Constraints

- Quiet time 3000 ms. Only audio (`library.isSupportedAudio`), `.cue` and cover names (`shelf.js`'s `COVER_FILE`) count; names starting with `.` never do. A `null` filename counts.
- The watch follows the folder the shelf reads (`store.readLastPath()`), (re)started on app ready and on every `shelf:albums`.
- A failing watch (throw or `error` event) is stopped silently; the shelf works as before.
- Not in the smoke test (`smokeDir`): no watch there.
- Tests never touch a real `~/.cdplayer` (`process.env.CDPLAYER_HOME` to a temp dir).
- Commit messages in the repo's style; no AI attribution lines.

## Review Focus

- A burst of events across subfolders during a rip (dozens of files over minutes): exactly one `onChange` after it settles, not one per file → Task 1 test "a burst is one change".
- The folder removed or renamed while watched (`error`/`ENOENT`): no crash, no retry loop → Task 1 test "an erroring watch is stopped".
- A change arriving while the shelf is still loading: one more quiet load after it, not lost and not a second "READING YOUR MUSIC…" → Task 2 test via `refreshGate` busy while loading.
- Same albums, nothing visible changed (e.g. a cover's mtime touched): no redraw, no scroll jump → Task 2 test "same albums → same signature".
- `start()` called again with the same folder (every shelf open): the watch is kept, not torn down and rebuilt → Task 1 test "the same folder keeps its watch".

---

### Task 1: The watcher

**Files:**
- Create: `src/main/library-watch.js`
- Modify: `src/main/shelf.js` (export `COVER_FILE`), `src/main/main.js` (create, start on ready and in `shelf:albums`)
- Test: `test/library-watch.test.js`

**Interfaces:**
- Consumes: `library.isSupportedAudio(p)`, `shelf.COVER_FILE`.
- Produces: `createLibraryWatch({ watch = fs.watch, quietMs = 3000, onChange, timers = { setTimeout, clearTimeout } })` → `{ start(folder), stop(), folder }`; `relevant(filename) → boolean`.

- [ ] **Step 1: Write the failing test** `test/library-watch.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { createLibraryWatch, relevant } = require('../src/main/library-watch');

function fakeWatch() {
  const made = [];
  const watch = (folder, opts, listener) => {
    const w = new EventEmitter();
    w.folder = folder; w.opts = opts; w.closed = false; w.close = () => { w.closed = true; };
    w.fire = (name) => listener('change', name);
    made.push(w);
    return w;
  };
  return { watch, made };
}
function fakeTimers() {
  let now = 0, list = [];
  return {
    setTimeout: (fn, ms) => { const t = { fn, at: now + ms }; list.push(t); return t; },
    clearTimeout: (t) => { list = list.filter((x) => x !== t); },
    advance(ms) { now += ms; const due = list.filter((t) => t.at <= now); list = list.filter((t) => t.at > now); due.forEach((t) => t.fn()); },
  };
}

test('what counts: audio, cue sheets and covers — not hidden or temporary files', () => {
  for (const n of ['Album/01 Song.flac', 'a.MP3', 'x/y/disc.cue', 'Album/cover.jpg', 'folder.png', null]) assert.strictEqual(relevant(n), true, n);
  for (const n of ['.DS_Store', 'Album/._01.flac', 'Album/.cdplayer-rip-3.flac', 'Album/.01 Song.cdplayer-1-2.flac', 'notes.txt', 'Album/booklet.pdf']) assert.strictEqual(relevant(n), false, n);
});

test('a burst is one change, once the folder has been quiet', () => {
  const { watch, made } = fakeWatch(), timers = fakeTimers();
  let changes = 0;
  const lw = createLibraryWatch({ watch, timers, onChange: () => changes++ });
  lw.start('/music');
  assert.deepStrictEqual(made[0].opts, { recursive: true });
  for (let i = 0; i < 20; i++) { made[0].fire(`Album/${i}.flac`); timers.advance(1000); }
  assert.strictEqual(changes, 0);
  timers.advance(3000);
  assert.strictEqual(changes, 1);
  made[0].fire('.DS_Store'); timers.advance(5000);
  assert.strictEqual(changes, 1);
});

test('the same folder keeps its watch; another one replaces it', () => {
  const { watch, made } = fakeWatch();
  const lw = createLibraryWatch({ watch, timers: fakeTimers(), onChange() {} });
  lw.start('/music'); lw.start('/music');
  assert.strictEqual(made.length, 1);
  lw.start('/other');
  assert.deepStrictEqual([made.length, made[0].closed, lw.folder], [2, true, '/other']);
  lw.start(null);
  assert.deepStrictEqual([made[1].closed, lw.folder], [true, null]);
});

test('an erroring watch is stopped, and a throwing one never starts', () => {
  const { watch, made } = fakeWatch(), timers = fakeTimers();
  let changes = 0;
  const lw = createLibraryWatch({ watch, timers, onChange: () => changes++ });
  lw.start('/music');
  made[0].emit('error', Object.assign(new Error('gone'), { code: 'ENOENT' }));
  assert.deepStrictEqual([made[0].closed, lw.folder], [true, null]);
  const throwing = createLibraryWatch({ watch: () => { throw Object.assign(new Error('no'), { code: 'ENOSPC' }); }, timers, onChange() {} });
  assert.doesNotThrow(() => throwing.start('/music'));
  assert.strictEqual(throwing.folder, null);
});

test('stop() drops a change that was waiting for quiet', () => {
  const { watch, made } = fakeWatch(), timers = fakeTimers();
  let changes = 0;
  const lw = createLibraryWatch({ watch, timers, onChange: () => changes++ });
  lw.start('/music'); made[0].fire('a.flac'); lw.stop(); timers.advance(5000);
  assert.strictEqual(changes, 0);
});
```

- [ ] **Step 2: Run** `node --test test/library-watch.test.js` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/main/library-watch.js`**

```js
'use strict';
/**
 * The music folder, watched (recursively) so the CD shelf keeps up with it by itself: an album ripped, copied in,
 * retagged or deleted. Only names that can change the shelf count — audio, cue sheets, covers; never hidden files,
 * which are also what the rip and the tag writer write before their final rename. A burst of changes is one, once the
 * folder has been quiet for `quietMs`. Watching that isn't possible (a network drive, Linux out of inotify watches)
 * just stops: the shelf still reads the folder each time it's opened.
 */
const fs = require('fs');
const path = require('path');
const { isSupportedAudio } = require('./library');
const { COVER_FILE } = require('./shelf');

function relevant(filename) {
  if (filename === null || filename === undefined) return true; // some systems don't say what changed
  const name = path.basename(String(filename));
  if (name.startsWith('.')) return false;
  return isSupportedAudio(name) || /\.cue$/i.test(name) || COVER_FILE.test(name);
}

function createLibraryWatch({ watch = fs.watch, quietMs = 3000, onChange, timers = { setTimeout, clearTimeout } }) {
  let watcher = null, folder = null, timer = null;
  function stop() {
    if (timer) { timers.clearTimeout(timer); timer = null; }
    if (watcher) { try { watcher.close(); } catch { /* already closed */ } watcher = null; }
    folder = null;
  }
  function start(dir) {
    if (dir && dir === folder && watcher) return;
    stop();
    if (!dir) return;
    try {
      watcher = watch(dir, { recursive: true }, (_event, filename) => {
        if (!relevant(filename && filename.toString())) return;
        if (timer) timers.clearTimeout(timer);
        timer = timers.setTimeout(() => { timer = null; onChange(); }, quietMs);
      });
      folder = dir;
      watcher.on('error', () => stop());
    } catch { stop(); }
  }
  return { start, stop, get folder() { return folder; } };
}

module.exports = { createLibraryWatch, relevant };
```

In `src/main/shelf.js` add `COVER_FILE` to `module.exports`. (Check for a require cycle: `shelf.js` doesn't require `library-watch.js`, so none.)

- [ ] **Step 4: Run** `node --test test/library-watch.test.js` — Expected: PASS (5 tests).

- [ ] **Step 5: Wire it in `src/main/main.js`.** After the `shelf:albums` handler's surroundings (before it), add:

```js
// The music folder, watched so an open shelf keeps up with it (library-watch.js); it follows the folder the shelf reads.
const libraryWatch = require('./library-watch').createLibraryWatch({ onChange: () => { if (win && !win.isDestroyed()) win.webContents.send('library-changed'); } });
const watchMusicFolder = () => { if (!smokeDir) { const f = store.readLastPath(); libraryWatch.start(f && store.isDir(f) ? f : null); } };
```

At the top of the `shelf:albums` handler body: `watchMusicFolder();`. In `app.whenReady()`, after `createWindow();`: `watchMusicFolder();`. In the existing `before-quit` handler (`grep -n "before-quit" src/main/main.js`) add `libraryWatch.stop();`.

- [ ] **Step 6: Run** `npm test` — Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/library-watch.js src/main/shelf.js src/main/main.js test/library-watch.test.js
git commit -m "The music folder is watched: once it's been quiet for 3 s after songs, cue sheets or covers changed in it, the window is told"
```

---

### Task 2: The shelf brings itself up to date

**Files:**
- Modify: `src/renderer/js/shelf-order.js` (new `shelfSignature`), `src/renderer/js/shelf.js` (`load`, setup of listeners), `src/preload.js`
- Test: `test/shelf-order.test.mjs`

**Interfaces:**
- Consumes: Task 1's `library-changed` event; `renderGate` from `shelf-missing.js`.
- Produces: `shelfSignature(albums) → string`; `cdp.onLibraryChanged(fn)`; `load({ quiet })` in `shelf.js`.

- [ ] **Step 1: Write the failing test** (append to `test/shelf-order.test.mjs`; add `shelfSignature` to its import from `../src/renderer/js/shelf-order.js`):

```js
test('same albums → same signature, in any order; a new, gone or retitled song → another', () => {
  const a = { id: 'a', title: 'A', artist: 'X', tracks: [{ path: '/a/1.flac', title: 'One' }, { path: '/a/2.flac', title: 'Two' }] };
  const b = { id: 'b', title: 'B', artist: 'Y', tracks: [{ path: '/b/1.flac', title: 'Uno' }] };
  const sig = shelfSignature([a, b]);
  assert.strictEqual(shelfSignature([b, a]), sig);
  assert.notStrictEqual(shelfSignature([a]), sig);
  assert.notStrictEqual(shelfSignature([a, { ...b, tracks: [...b.tracks, { path: '/b/2.flac', title: 'Dos' }] }]), sig);
  assert.notStrictEqual(shelfSignature([a, { ...b, title: 'B (Remastered)' }]), sig);
  assert.notStrictEqual(shelfSignature([a, { ...b, tracks: [{ path: '/b/1.flac', title: 'Eins' }] }]), sig);
});
```

- [ ] **Step 2: Run** `node --test test/shelf-order.test.mjs` — Expected: FAIL (`shelfSignature` is not exported).

- [ ] **Step 3: Implement** in `src/renderer/js/shelf-order.js` (after `matchesFilter`):

```js
/** What the shelf shows, as one string: each album's id, title, artist, year and its songs' paths and titles — so a
 * change in the music folder that doesn't change any of that redraws nothing. */
export function shelfSignature(albums) {
  return albums.map((a) => JSON.stringify([a.id, a.title, a.artist || null, a.year || null, a.tracks.map((t) => [t.path, t.title])])).sort().join('\n');
}
```

- [ ] **Step 4: Run** `node --test test/shelf-order.test.mjs` — Expected: PASS.

- [ ] **Step 5: Preload.** In `src/preload.js` after `onShelfProgress: on('shelf-progress'),`: `onLibraryChanged: on('library-changed'),`.

- [ ] **Step 6: Quiet loads in `src/renderer/js/shelf.js`.**
  - Import `shelfSignature` from `./shelf-order.js` (extend the existing import line).
  - Change `load()` to `load({ quiet = false } = {})`:
    ```js
    async function load({ quiet = false } = {}) {
      const generation = ++shelf.generation;
      shelf.loading = true;
      if (!quiet) {
        $('shelf-count').textContent = t('READING YOUR MUSIC…');
        $('shelf-body').replaceChildren();
      }
      let result;
      try { result = await shelf.app.cdp.shelfAlbums(); } catch { result = { folder: null, albums: [], error: true }; }
      if (generation !== shelf.generation) return;
      shelf.loading = false;
      // The music folder changed, but nothing the shelf shows did: leave it as it is.
      if (quiet && (result.name || null) === shelf.folderName && shelfSignature(result.albums) === shelfSignature(shelf.albums)) return;
      const scroll = quiet ? $('shelf-body').scrollTop : 0;
      shelf.albums = result.albums;
      // …the rest of the existing body, unchanged, down to and including render()…
      if (quiet) $('shelf-body').scrollTop = scroll;
    }
    ```
    (Only the `quiet` lines are new; keep every existing line between `shelf.albums = result.albums;` and `render();` exactly as it is.)
  - Next to `redraw` (line ~29), add the gate that holds a quiet load back while a case is out, a spine is carried or pulled, the booklet is open, or a load is running:
    ```js
    // The music folder changed (library-watch.js): the shelf, if it's open, reads it again quietly — once the case,
    // booklet or spine in hand is put back, and after a load that's already running.
    const refresh = renderGate({
      render: () => { if (shelf.open) load({ quiet: true }); },
      busy: () => shelf.loading || !!shelf.caseOpen || isBookletOpen() || shelf.pulling || $('shelf').classList.contains('carrying'),
    });
    ```
  - In the setup function where `app.cdp.onShelfProgress(…)` is registered (line ~108), add: `app.cdp.onLibraryChanged(() => { if (shelf.open) refresh.request(); });`

- [ ] **Step 7: Run** `npm test` — Expected: all PASS.

- [ ] **Step 8: Verify by hand.** `CDPLAYER_HOME=$CLAUDE_JOB_DIR/tmp/home npm start` with a test music folder under `$CLAUDE_JOB_DIR/tmp/music` (copy two albums' worth of `test/fixtures/smoke.*` into subfolders, tagged differently or untagged so they group by folder). Open the shelf (`S`), scroll a little, then in a terminal: `cp -R "$CLAUDE_JOB_DIR/tmp/music/Album A" "$CLAUDE_JOB_DIR/tmp/music/Album C"` — within ~4 s Album C appears shrink-wrapped, the scroll position is kept, no "READING YOUR MUSIC…". Open a case, copy another album: nothing moves until the case is put back, then it appears. `rm -rf` the copy: it disappears. `touch` a cover: nothing redraws.

- [ ] **Step 9: README.** In the **The CD shelf** feature bullet, after "every album in your music folder spine-out," insert "kept up to date as you add, rip or remove albums,".

- [ ] **Step 10: Commit**

```bash
git add src/renderer/js/shelf-order.js src/renderer/js/shelf.js src/preload.js test/shelf-order.test.mjs README.md
git commit -m "An open shelf keeps up with the music folder: a new album turns up shrink-wrapped and a removed one goes, without READING YOUR MUSIC and with the scroll kept; it waits while a case or the booklet is out"
```
