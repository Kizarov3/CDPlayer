# Shelf watch — design

## Goal

The CD shelf keeps up with the music folder by itself. Today the folder is read only when the shelf is opened
(`openShelf` → `load()` → `shelf:albums`, incremental through `shelf-cache.json`): an album ripped, copied or retagged
while the shelf is open doesn't appear until it's closed and opened again.

## Decisions (agreed)

- The main process watches the music folder (`fs.watch(folder, { recursive: true })`, which Electron 44's Node does on
  macOS, Windows and Linux).
- Only changes that can matter count: audio files (the extensions `library.js` collects), `.cue` sheets and cover
  files (`shelf.js`'s `COVER_FILE`). Hidden files (`.DS_Store`, `._*`) are ignored — which also covers the rip's
  `.cdplayer-rip-N.flac` and the tag writer's `.<name>.cdplayer-…` temporary files; their final rename is what counts.
- Changes are gathered until the folder has been quiet for **3 s**, so ripping or copying an album is one update.
- An open shelf is brought up to date **quietly**: no "READING YOUR MUSIC…", the scroll position, the filter and an
  opened box kept. A new album arrives shrink-wrapped as any new album does; a removed one disappears.
- Choosing another music folder moves the watch there. When watching isn't possible (a network drive, too many
  folders for Linux's inotify), the shelf works as it does today, with no message.

## The watcher

`src/main/library-watch.js`, `createLibraryWatch({ watch = fs.watch, quietMs = 3000, onChange })` (testable with a
fake `watch`):
- `start(folder)` — stops any previous watch, starts one on `folder`; an `error` event or a throw stops it silently.
- `relevant(filename)` (pure) — true for audio, `.cue` and cover names; false for hidden and temporary names.
  A `null` filename (some systems don't say) counts as relevant.
- Relevant events (re)start a `quietMs` timer; when it fires, `onChange()` is called once.
- `stop()`.

`main.js` starts it on app ready with `store.readLastPath()` and again whenever the music folder is chosen
(`pickMusicFolder`, the rip's folder pick). `onChange` → `win.webContents.send('library-changed')`.
Nothing is read in the main process on a change: the next `shelf:albums` re-reads only the changed files
(by `size:mtime`), so a change while the shelf is closed costs nothing and the shelf is right when it's opened.

## The shelf

`preload.js`: `onLibraryChanged(fn)`. In `src/renderer/js/shelf.js`:
- `library-changed` while the shelf is closed: nothing.
- While it's loading: one more quiet reload is done once that load finishes.
- While a case or the booklet is open over it: the reload waits until it's closed (rebuilding the spines under an
  open case would lose it).
- Otherwise `load({ quiet: true })`: the albums are asked for again; if their signature (album ids and each album's
  track paths, `shelfSignature(albums)` — pure) is unchanged, nothing else happens; if it changed, `render()` runs and
  the shelf body's `scrollTop` is put back. Colours, Discogs entries and covers come from their caches as on any load.
- The count line (`3 ALBUMS`) updates with it.

Search (`panels.js`) reads the folder each time it's opened, so it needs nothing.

## Testing

- `library-watch.test.js`: `relevant()` for audio, cue, covers, `.DS_Store`, `._x.flac`, temp names, `null`; a burst
  of events → one `onChange` after the quiet time (fake timers); `start()` again stops the old watch; a throwing or
  erroring `watch` doesn't throw.
- `shelf-signature` in `shelf-order.test.mjs` (or its own test): same albums in another order → same signature; a new
  track → different.
- By hand: shelf open, copy an album into the folder → it appears shrink-wrapped within a few seconds, scroll kept;
  delete it → it goes; retag a file → its spine updates; rip a CD with the shelf open.
