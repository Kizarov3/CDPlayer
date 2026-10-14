# CD changer as a mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The queue comes back as the default; the CD changer is a mode switched in Settings, each with its own music.

**Architecture:** `state.changerMode` picks which store `state.queue` / `state.index` belong to. The functions that
differ between the two ask it; the queue paths are 2.14's code (from git `878bfff`), the changer paths are today's.

**Tech Stack:** Electron, renderer ES modules, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-15-changer-mode-design.md`

## Global Constraints

- Branch `changer-mode`; merge to main and push when done (the user agreed in advance).
- Tests never touch `~/.cdplayer` (CDPLAYER_HOME). Russian 100 % (`npm run i18n -- ru`). No AI attribution in commits.
- `queue.txt` stays readable by 2.14.

## Review Focus

1. Switching modes while a song plays: the other mode's song loads paused at its own position; switching back resumes
   the first one's song and position — neither store is overwritten by the other.
2. A user upgrading from the changer build (changer.txt, no changer-queue.txt): nothing lost in either mode.
3. Queue mode is really 2.14: drag reorder, ×, PLAY NEXT run, shuffle cache, a Spotify disc replacing the queue.
4. Changer-only things never leak into queue mode: slot badges, `D` / `1`–`5`, "DISC n" in the mini player, DISC SKIP.
5. Russian: the Settings row and its hint fit; the queue card in both modes fits.

---

### Task 1: Two stores on disk, the setting, PLAY NEXT back

**Files:** `src/main/store.js`, `src/main/main.js`, `test/state.test.js`, restore `src/renderer/js/play-next.js` and
`test/play-next.test.mjs` (`git checkout 878bfff -- …`), `test/i18n-locales.test.mjs` (silent list).

- [ ] Failing tests in `test/state.test.js`:
  - `writeQueue({ paths, index, positionMicros, mode: 'CHANGER', changer })` writes `changer-queue.txt` + `changer.txt`,
    not `queue.txt`; `readChangerQueue()` returns `{ paths, index, positionMicros, changerText, savedPaths, savedIndex, missing }`.
  - `writeQueue` without `mode` (or `'QUEUE'`) writes only `queue.txt`.
  - Upgrade: with `queue.txt` + `changer.txt` and no `changer-queue.txt`, `readChangerQueue()` returns queue.txt's list
    with changer.txt's text.
  - Settings: `changer` round-trips (default false).
- [ ] Implement: `FILES.changerQueue = 'changer-queue.txt'`; `readQueueFile(name)` shared by `readQueue()` /
  `readChangerQueue()` (the latter falls back to queue.txt when its own file is missing and changer.txt exists);
  `writeQueue` routes by `mode`; settings line `changer` (ON/OFF) appended after the last one; `state:load` returns
  `changerQueue: store.readChangerQueue()`.
- [ ] `npm test` green; commit.

### Task 2: The app runs either mode

**Files:** `src/renderer/js/app.js`, `src/renderer/js/booklet.js`.

- [ ] `state.changerMode` from settings; `stores` keeps the inactive store `{ queue, index, positionMicros, changer?, nextUp? }`.
- [ ] Mode-aware: `upcomingIndex` (2.14 `nextIndex` with `pinnedNext` + shuffle cache in queue mode), `goTo`,
  `previousTrack`, `notePlayed` (changer only), `trackFinished`'s repeat TRACK, `addToQueue` / `playNext` /
  `appendAndPlay` / `loadPlaylist` / `loadDisc` (queue: push / `insertNext`, Spotify disc replaced like 2.14),
  `putDiscOnTray` (queue: replaces the queue), clear / undo, `stopSpotify`, `onAudioCdGone`, `spotifyResync`'s end,
  `updateDiscData` (queue: 2.14's same-album run), `renderQueue` (queue: 2.14 rows with ×, NEXT tag, drag),
  `queueSnapshot` (+ `mode`), restore at start (both stores), `pushMini` disc (changer only), keys `d` / `1`–`5` (changer
  only), shuffle/repeat cycles per mode, booklet `albumTracks` per mode.
- [ ] `setChangerMode(on)`: save the active store (sync), keep it in `stores`, swap in the other, coerce DISC → ALL for the
  queue, render, load its song paused at its position; `app.changerMode()` for other modules.
- [ ] `npm test` green; commit.

### Task 3: The switch and everything that shows the mode

**Files:** `src/renderer/js/panels.js` (Settings row), `src/renderer/index.html` / `styles.css` (queue card per mode),
`src/renderer/js/shelf.js` (button label, badges), `src/renderer/js/help.js`, `README.md`, `src/locales/ru.json`.

- [ ] Settings → Look: CHANGER ON/OFF with a hint; calls `app.setChangerMode`.
- [ ] Queue card: `body.changer-mode` class shows the carousel / disc heading / DISC SKIP / EJECT; else the plain list.
- [ ] Shelf: INTO THE CHANGER vs ADD TO QUEUE; slot badges only in changer mode.
- [ ] Help / FAQ / keys / README say the changer is a mode (Settings → CHANGER), `D` / `1`–`5` in changer mode.
- [ ] Russian 100 %; `npm test` green; commit.

### Task 4: Verify in the app, review, merge

- [ ] Isolated Russian instance: the screen tour in both modes (audit clean but intended ellipses); switching back and
  forth keeps each mode's music/position; shelf and keys per mode; mini player.
- [ ] Fresh reviewer on the branch; fix Critical/Important with tests; merge to main, push.
