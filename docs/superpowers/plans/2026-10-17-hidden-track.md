# Hidden Track Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CDPlayer finds a song hidden after minutes of silence at the end of a disc's last track, plays the silence
with a countdown in the status pill and a ghost row in the queue, and names the hidden song when it begins.

**Architecture:** A pure renderer module (`hidden-track.js`) holds the detector and the countdown/phase rules; the
waveform's existing 8 kHz decode also yields a 100 ms power envelope for it. Main keeps results in `hidden.json`
(`hidden-cache.js`, modelled on `soundcheck-cache.js`), answers "is this the last track of its disc", and names the
hidden song from MusicBrainz. `app.js` follows the playing position through three phases (song → silence → hidden)
and updates the pill, title, badge, seek-bar marker, queue/changer ghost row, media session, Discord and mini player.

**Tech Stack:** Electron 44 (castLabs), plain ES modules in the renderer, CommonJS in main, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-17-hidden-track-design.md` (read it first; prototype beside it:
`docs/superpowers/specs/2026-10-17-hidden-track-prototype.mjs`).

## Global Constraints

- Only files: not cue-sheet tracks (`cueRef`), not audio-CD tracks (`isAudioCdTrack`), not Spotify, not files of 30 minutes or more (the waveform's own rule, `app.js:712`).
- Announced only on the **last track of its disc**: shelf album order by disc then track; off the shelf, tags' track number = track total.
- Detection numbers, verbatim: 100 ms blocks; 1 s smoothing; floor = 5th percentile; `T = clamp(floor + 12, −70, −48)` dBFS; gap starts ≥ 30 s in; digital gap (median < −70 dBFS) ≥ 10 s; hiss gap ≥ 30 s with 95th − 5th spread ≤ 6 dB; sound after = above `max(gapMedian + 15, −60)` dBFS, ≥ 20 s of it spanning ≥ 20 s; longest gap wins.
- Nothing about playback changes: gapless, crossfade, NEXT, PREVIOUS, REPEAT, SHUFFLE, changer, HISTORY counts, disc data side, lyrics, Sound Check.
- No setting; no new npm dependency.
- Before the listener first reaches the silence: no marker, no ghost row, no name anywhere. After "found" (8 s of the hidden song heard): shown from load.
- No confetti, sound, popup or toast; the pill never blinks (no fade on the per-second update).
- Every new UI string goes through `t()` and gets its Russian in `src/locales/ru.json` (the i18n test fails otherwise). Agreed wording: `NOT OVER YET · {time}` = `ЕЩЁ НЕ ВСЁ · {time}`; `{name} IN {time}` = `{name} ЧЕРЕЗ {time}`; `HIDDEN TRACK IN {time}` = `СКРЫТЫЙ ТРЕК ЧЕРЕЗ {time}`; `HIDDEN TRACK` = `СКРЫТЫЙ ТРЕК`; `Hidden track` = `Скрытый трек`; `HIDDEN` badge = `СКРЫТЫЙ`.
- Tests and manual runs never touch the real `~/.cdplayer`: `CDPLAYER_HOME` set to a temporary folder.
- Commits: plain sentences in the repo's style; no Co-Authored-By or "Generated with" lines.

## Review Focus

1. **A file whose cache entry exists but is stale** (re-ripped, tags edited): the `size:mtime` stamp must drop it, and detection must run again — Task 2 tests it.
2. **Seeking into the middle of the silence or straight into the hidden song, and back** (the phase moves without passing through the boundary): title, pill and badge must follow the phase, not the transition — Task 5 tests `hiddenPhase` at every region and Task 6 derives everything from the phase each tick.
3. **A track change during the silence** (NEXT, a queue click, the album replaced from the shelf): no stale countdown, title, marker or ghost row left for the new track — Task 6 resets on every `load()` by token.
4. **The same file in the queue twice, or in queue and changer**: the ghost row follows the playing row only — Task 7 keys it by queue index, not path.
5. **A detected hidden part on a track that isn't the last of its disc** (an album with a long silent interlude in track 3): cached, never announced — Task 2 tests `isLastOfDisc`, Task 6 gates on it.

---

### Task 1: The detector

**Files:**
- Create: `src/renderer/js/hidden-track.js`
- Test: `test/hidden-track.test.mjs`

**Interfaces:**
- Produces:
  - `export const BLOCK_SECONDS = 0.1`
  - `export function powerEnvelope(channels: Float32Array[], sampleRate: number): Float64Array` — mean power over all channels per 100 ms block (the prototype's `envelope`).
  - `export function detectHidden(power: Float64Array): { songEnd: number, hiddenStart: number } | null` — seconds, one decimal; `hiddenStart` refined on the raw (unsmoothed) blocks: the first block after the gap above the sound level.

- [ ] **Step 1: Write the failing tests** — port the prototype's 11 synthetic cases (its signal helpers move into the test file). Found cases assert `Math.abs(r.songEnd - truth[0]) <= 2` and, after refinement, `Math.abs(r.hiddenStart - truth[1]) <= 0.2`; rejected cases assert `null`. Also: `powerEnvelope([x, x], 8000).length === Math.ceil(x.length / 800)`, and a stereo file with silence on one channel only is not a gap.
- [ ] **Step 2: Run** `node --test test/hidden-track.test.mjs` — expect FAIL (module missing).
- [ ] **Step 3: Implement** both functions from the prototype; add the raw-block refinement. Module stays pure (no DOM, no imports from `app.js`).
- [ ] **Step 4: Run** `node --test test/hidden-track.test.mjs` — expect all PASS; then `npm test` — all PASS.
- [ ] **Step 5: Commit** — `git add src/renderer/js/hidden-track.js test/hidden-track.test.mjs && git commit -m "Hidden track: finds a song after minutes of silence in a file's power envelope"`

### Task 2: Main — cache, last track of its disc, IPC

**Files:**
- Create: `src/main/hidden-cache.js`
- Modify: `src/main/shelf.js` (export `isLastOfDisc`), `src/main/main.js` (beside the Sound Check handlers, ~`main.js:287-294`), `src/preload.js:100`
- Test: `test/hidden-cache.test.js`, `test/shelf.test.js`

**Interfaces:**
- Produces:
  - `createHiddenCache({ read, write, stat, delayMs = 1000 })` → `{ get(file): Entry | null | undefined, put(file, entry: Entry | null), update(file, fields: Partial<Entry>) }`. `undefined` = never checked or stale; `null` = checked, nothing. `Entry = { songEnd, hiddenStart, name: string | null, asked: boolean, found: boolean }`. Stored in `hidden.json` as `{ version: 1, tracks: { [file]: { stamp, ...entry } | { stamp, none: true } } }`.
  - `isLastOfDisc(album, path): boolean` in `shelf.js` — `album.tracks` are in disc then track order; true when `path` is the last of the tracks sharing its `disc`.
  - IPC `hidden:get(file)` → `{ entry: Entry | null | undefined, lastOfDisc: boolean | null }` (`null` = not on the shelf). `hidden:put(file, entry | null)`, `hidden:update(file, fields)`.
  - Preload: `cdp.hidden = { get, put, update, name }` (`name` is added in Task 3; wire it now as `invoke('hidden:name')`).

- [ ] **Step 1: Write failing tests** in `test/hidden-cache.test.js`, as `soundcheck-cache.test.js` does: an entry is returned while the stamp matches and `undefined` once size or mtime change (Review Focus 1); `null` is kept and read back as `null`; `update` merges `{ found: true }` and `{ name, asked: true }` without losing the rest; a broken file reads as empty. In `test/shelf.test.js`: `isLastOfDisc` for a one-disc album (last true, others false), a two-disc album (the last of disc 1 and of disc 2 both true), tracks with no disc number (treated as disc 1).
- [ ] **Step 2: Run** `node --test test/hidden-cache.test.js test/shelf.test.js` — expect FAIL.
- [ ] **Step 3: Implement** the cache (copy `soundcheck-cache.js`'s shape), `isLastOfDisc`, the three handlers (`lastOfDisc` via `shelf.albumOf(file)`), the preload entry. Validate argument types in the handlers as the Sound Check ones do.
- [ ] **Step 4: Run** `npm test` — all PASS.
- [ ] **Step 5: Commit** — `"Hidden track: what was found in each file is kept in hidden.json, and main says whether a song is the last of its disc"`

### Task 3: Naming the hidden song

**Files:**
- Modify: `src/renderer/js/hidden-track.js`, `src/main/online.js` (export), `src/main/main.js`
- Test: `test/hidden-track.test.mjs`, create `test/hidden-name.test.js`

**Interfaces:**
- Produces:
  - `export function splitTitle(title: string): { main: string, hidden: string } | null` in `hidden-track.js` — splits on the first `" / "`; null without one or with an empty side.
  - `hiddenNameFrom(recordings, { title, duration }): string | null` in `online.js` — the first recording whose length is within 5 s of `duration` and whose title, split on `" / "`, has a part before it equal to `title` (compared with the existing `sameSong`/case-insensitive rule) → the part after.
  - `findHiddenName({ artist, title, duration }): Promise<{ name: string | null } | { networkError: true }>` — one `mbFetch` query `recording:"<title>" AND artist:"<artist>" AND dur:[(d−5)·1000 TO (d+5)·1000]`, limit 25, through `hiddenNameFrom`.
  - IPC `hidden:name({ artist, title, duration })` → `findHiddenName`.

- [ ] **Step 1: Write failing tests** — `splitTitle('Something in the Way / Endless, Nameless')` → `{ main: 'Something in the Way', hidden: 'Endless, Nameless' }`; `splitTitle('AC/DC')` → null; `splitTitle('A / ')` → null. `hiddenNameFrom` with recordings `[{ title: 'Something in the Way / Endless, Nameless', length: 1235066 }, { title: 'Something in the Way', length: 232000 }]`, `{ title: 'Something in the Way', duration: 1235 }` → `'Endless, Nameless'`; with `duration: 662` → null; a recording `'Other / X'` → null.
- [ ] **Step 2: Run** `node --test test/hidden-track.test.mjs test/hidden-name.test.js` — expect FAIL.
- [ ] **Step 3: Implement** the three functions and the handler.
- [ ] **Step 4: Run** `npm test` — all PASS.
- [ ] **Step 5: Commit** — `"Hidden track: its name from the title tag's ' / ', or from MusicBrainz's recording of that length"`

### Task 4: Phase and countdown rules

**Files:**
- Modify: `src/renderer/js/hidden-track.js`
- Test: `test/hidden-track.test.mjs`

**Interfaces:**
- Produces:
  - `export function hiddenPhase(h: { songEnd, hiddenStart } | null, position: number): 'song' | 'silence' | 'hidden' | null` — null without `h`; `'silence'` for `songEnd ≤ position < hiddenStart`.
  - `export function countdown(h: { hiddenStart, found, name }, position: number): { key: string, params: object }` — `{ key: 'NOT OVER YET · {time}' }` before found; after: `{name} IN {time}` with the name upper-cased, or `HIDDEN TRACK IN {time}` without a name. `{time}` = remaining whole seconds as `m:ss`, rounded up (7:42 shows until 7:41.0).
  - `export function hiddenName(h, details): string | null` — `h.name`, else `splitTitle(details.title).hidden`, else null (the caller shows `t('Hidden track')`).
  - `export function displayTitle(details): string` — the main part when the title splits, else the title.

- [ ] **Step 1: Write failing tests** — `hiddenPhase` at 0, at `songEnd − 0.1`, at `songEnd`, mid-silence, at `hiddenStart`, at the file's end, and after a jump from 0 to the hidden part (Review Focus 2); `countdown` at 462 s left → `7:42`, at 461.2 s → `7:42`, at 0.4 s → `0:01`; the three keys; `hiddenName`/`displayTitle` with and without `" / "`.
- [ ] **Step 2: Run** `node --test test/hidden-track.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement.** (Uses its own `m:ss`; never imports `app.js`.)
- [ ] **Step 4: Run** — PASS; `npm test` — PASS.
- [ ] **Step 5: Commit** — `"Hidden track: the song, the silence and the hidden song as phases of the position, and the pill's countdown"`

### Task 5: The seek bar's marker

**Files:**
- Modify: `src/renderer/js/widgets.js:138-173` (the `Slider`)

**Interfaces:**
- Produces: `slider.setMarker(value: number | null)` — draws a small `?` in the accent colour above the bar at that value (0–1000 on the progress slider), on the waveform and on the plain line; `pointer(…, 'up')` lands on the marker's value when the release is within 6 px of it.

- [ ] **Step 1: Implement** `setMarker`, the drawing (after the bars/line, before the thumb), and the snap in `pointer`. `valueForX` stays as is; the snap compares pixel positions.
- [ ] **Step 2: Check by hand** in the app (Task 6's wiring lands next; until then, call `progress.setMarker(500)` from the dev console): the `?` shows with WAVEFORM on and off, and a release a few pixels from it seeks exactly to it.
- [ ] **Step 3: Commit** — `"The seek bar can show a ? where something starts, and a click near it lands on it"`

### Task 6: Wiring in the player

**Files:**
- Modify: `src/renderer/js/audio.js:426-445`, `src/renderer/js/app.js` (`stateStatus`/`setStatus` ~`:100-112`, `load()` ~`:614-714`, `playbackTick` ~`:2159`, `updateMediaSession`/`pushDiscord` ~`:1381-1404`, `shareCard` ~`:848`), `src/renderer/index.html:46` (badge), the stylesheet beside `#quality-badge`, `src/locales/ru.json`

**Interfaces:**
- Consumes: Task 1 `powerEnvelope`, `detectHidden`; Task 2 `cdp.hidden.get/put/update`; Task 3 `cdp.hidden.name`; Task 4 `hiddenPhase`, `countdown`, `hiddenName`, `displayTitle`; Task 5 `progress.setMarker`.
- Produces: `state.hidden: { path, token, songEnd, hiddenStart, name, found, last, revealed } | null` and `state.hiddenPhase` — read by Task 7's rows.

- [ ] **Step 1:** `computeWaveform(url, buckets)` returns `{ buckets, power }` — `power = powerEnvelope(all decoded channels, 8000)`; decode with as many channels as the file has (`new OfflineAudioContext(2, 1, 8000)`), the buckets still from channel 0 as now. Update its one caller (`app.js:713`) to `progress.setWaveform(w.buckets)`.
- [ ] **Step 2: In `load()`**, at the top: `state.hidden = null`, `state.hiddenPhase = null`, `progress.setMarker(null)`, the badge hidden. After details are known, for an eligible file (Global Constraints): `cdp.hidden.get(path)` → `last = lastOfDisc ?? (credits.track.no === credits.track.of)`. With an entry and `last`: set `state.hidden` (`revealed = entry.found`), marker shown when found. When the waveform's power arrives and the entry was `undefined`: `detectHidden(power)` → `cdp.hidden.put(path, result ? { ...result, name: null, asked: false, found: false } : null)`; if found and `last`, set `state.hidden`. With `last` and `!asked` (and no `" / "` name): `cdp.hidden.name({ artist, title: displayTitle(details), duration })` → on `{ name }`, `cdp.hidden.update(path, { name, asked: true })` and keep it in `state.hidden` (never shown before the hidden phase). Every async step checks `token === state.loadToken` (Review Focus 3). The title shown at load is `displayTitle(details)`.
- [ ] **Step 3: Each `playbackTick`** with `state.hidden`: `phase = hiddenPhase(state.hidden, engine.position)`. On a change of phase:
  - → `'silence'`: `revealed = true`; marker at `hiddenStart / duration · 1000`; `renderQueue()`.
  - → `'hidden'`: `setStatus(t('HIDDEN TRACK'))`; `setTrackTitle(name || t('Hidden track'), artist)`; badge `t('HIDDEN')` shown; `updateMediaSession()`; a timer of `HEARD_SECONDS` — still in the hidden phase and playing then → `found = true`, `cdp.hidden.update(path, { found: true })`, `renderQueue()`.
  - → `'song'` (seeked back): main title back, badge hidden, `updateMediaSession()`.
  While `'silence'` and no passing word is held (a `statusHeld` flag set by `setStatus`, cleared by its 6 s timer), write `STATUS_DOT + stateStatus()` with `setText` once a second — no fade.
- [ ] **Step 4: `stateStatus()`** returns `t(countdown(...).key, params)` when playing in the silence phase (after the open-tray case, before NOW SPINNING); PAUSED and OPEN still win.
- [ ] **Step 5: Media session and Discord** — `updateMediaSession` uses `state.titleText` for the title; `pushDiscord` sends, in the hidden phase, `position − hiddenStart` and `duration − hiddenStart`; in the silence phase `duration: 0` (no timestamps, `discord.js:83`). Share card: in the hidden phase `lyricChoices(null, …)` (no main-song lyrics); the title already comes from `state.titleText`.
- [ ] **Step 6: Locales** — add the Russian for every new key (Global Constraints) to `src/locales/ru.json`.
- [ ] **Step 7: Run** `npm test` — all PASS (the i18n test included).
- [ ] **Step 8: Check by hand** with `CDPLAYER_HOME=$(mktemp -d) npm start` and a test FLAC made from the Task 1 signal (`songEnd` ≈ 40 s, `hiddenStart` ≈ 100 s, ~2 min total — write it with a short node script in the job's tmp folder; set its track number = track total): first play shows nothing until 40 s, then the countdown and `?`; the pill doesn't blink; a volume change takes the pill for 6 s and the countdown returns; at 100 s `HIDDEN TRACK`, the title and badge; seek back to 10 s restores the title; after 8 s of the hidden part, reload the file — marker and name present from the start; NEXT during the silence goes on as usual; PAUSED shows while paused.
- [ ] **Step 9: Commit** — `"The hidden track in the player: a countdown in the pill through the silence, a ? on the seek bar, and the hidden song's name, badge, media session and Discord status when it begins"`

### Task 7: Ghost row in the queue and the changer

**Files:**
- Modify: `src/renderer/js/app.js` (`renderQueueList` ~`:294-323`, the changer's `tracks` ~`:286-290`), `src/renderer/js/changer-view.js:49`, the stylesheet beside `.queue-row`

**Interfaces:**
- Consumes: `state.hidden`, `state.hiddenPhase` (Task 6).

- [ ] **Step 1: Implement** — when `state.hidden && state.hidden.revealed`, one extra row right after the **playing** row (`i === state.index`, never another row with the same path — Review Focus 4): class `queue-row ghost`, indented, no number, no duration, no ×, not draggable (it's skipped by the drag index math), text `· · ·  ???` before the hidden phase has been reached in this play-through or found, else `· · ·  <name or t('Hidden track')>`. Clicking it after found: `seekTo(state.hidden.hiddenStart)`. The changer's tracklist gets the same row under its current track (a `ghost` flag on the track view, rendered by `changer-view.js`). With animations on, the `???` → name change fades (`pulseClass(row, 'fade-in')`).
- [ ] **Step 2: Check by hand** (the Task 6 test file): queue mode and changer mode; the same file queued twice shows one ghost row, under the one playing; dragging other rows still lands where expected.
- [ ] **Step 3: Commit** — `"A hidden track's ghost row under its song in the queue and the changer: ??? until it's heard, then its name"`

### Task 8: The booklet

**Files:**
- Modify: `src/renderer/js/booklet.js` (~`:300-320` content, ~`:382-388` rows), the booklet stylesheet's `.pen` rules

**Interfaces:**
- Consumes: `cdp.hidden.get` (Task 2), `hiddenName` (Task 4).

- [ ] **Step 1: Implement** — for each of the album's tracks whose cache entry is `found`, a row right after it with `{ pen: true, name }`: no number, no time, no tally; rendered in the `.pen` handwriting style, slightly rotated as `tallyMarks` does. In the whole-tracklist branch, a `wholeList` row with `missing` whose title equals the hidden name (case-insensitive) of a found entry of this album is not shown as missing — it is replaced by the pen row.
- [ ] **Step 2: Check by hand** — the test file on the shelf as a one-track album: booklet before found (nothing), after found (the pen line under the song).
- [ ] **Step 3: Run** `npm test` — PASS.
- [ ] **Step 4: Commit** — `"Once found, the booklet has the hidden song written in pen under its track"`

### Task 9: Final check

- [ ] **Step 1: Run** `npm test` — all PASS; paste the summary line.
- [ ] **Step 2: Russian** — switch the language, repeat Task 6 Step 8 briefly: every new word in Russian, nothing overflows the pill.
- [ ] **Step 3: A real rip** if one is available (Nevermind, Dookie, Parachutes): detected, named, countdown sane. Otherwise say so in the hand-over.
- [ ] **Step 4: README** — one clause in **The disc** or **Playback** feature line: a hidden track after the silence at a disc's end is found, counted down to and named. Commit: `"README: hidden tracks"`.
