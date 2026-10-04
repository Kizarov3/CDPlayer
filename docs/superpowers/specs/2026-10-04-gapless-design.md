# Gapless playback — design

## Goal

Songs that follow each other in the queue play without a gap between them, as a CD does — above all an album ripped
to one file per track (CDPlayer's own RIP makes exactly that). Today only cue-sheet tracks in one file run into each
other (`engine.continuesInto`); between files the next track is loaded only after the `ended` event: details over IPC,
a new `<audio>`, `loadedmetadata`, `play()` — tens to hundreds of milliseconds of silence on every seam, which breaks
live albums, *The Dark Side of the Moon*, *Abbey Road*'s medley, classical movements and DJ mixes.

## What was measured (Electron 44, macOS, in the app's renderer)

- `decodeAudioData` and the `<audio>` element already trim the encoder's padding: a 1.000 s tone is exactly 44 100
  samples as WAV, FLAC, MP3 (LAME) and AAC (M4A), 44 099 as Opus. Nothing to compensate.
- Two `<audio>` elements through Web Audio, the second already loaded:
  - started on the first one's `ended`: **21.7 ms of silence** at the seam (audible);
  - started by a 2 ms timer when the first has ≤ 12 ms left: **1.5 ms overlap**, the same in 10 runs out of 10
    (elements start on the audio pipeline's block grid, so the seam is steady, not random).

## Decisions (agreed)

- **Approach A**: the next track is prepared on a second deck ahead of time and started by a timer aimed at the
  current track's end, with a 5 ms equal-power blend at the seam to hide the remaining millisecond or two. Memory and
  streaming as today. (Decoding whole tracks into memory for sample-exact seams was rejected: 100–500 MB per track,
  a delay before every track, and a rewrite of seeking, position, cue sheets and the visualizer — for a difference
  nobody can hear.)
- Gapless whenever **CROSSFADE is off**, for any next track in the queue (shuffled too). No setting: silence that is
  in the files stays, as in Apple Music.
- Not gapless: Spotify (its audio plays outside the engine); a next track that needs another sample rate under
  QUALITY = LOSSLESS / HI-RES LOSSLESS (the audio context has to be rebuilt); REPEAT ONE (as today); audio-CD tracks
  read live from the drive (each is its own read); cue-sheet tracks in the same file (already gapless, unchanged).
- Anything that changes what comes next — another track chosen, a seek, the queue edited, shuffle or repeat changed —
  drops or re-prepares the waiting deck. A paused song keeps it.

## The engine (`src/renderer/js/audio.js`)

- `prepare(url, { segment = null, trim = 1 })` → `Promise<boolean>`: a standby deck (the same `createDeck`, source →
  trim → gain → input, gain at 0) loaded to `loadedmetadata`, seeked to `segment.start` (or 0), paused. Replaces any
  earlier standby. Resolves false if it can't be decoded or was replaced meanwhile.
- `cancelPrepared()`: disposes the standby. Called by `load()`, `stop()`, `setRate()`.
- `prepared` getter → the standby's `url` and `segment.start`, or null.
- **The seam**, checked by `watchSeam()` on the playback timer (40 ms): once the playing deck has ≤ 150 ms left (to
  `deck.end` for a cue stretch, else `el.duration`) and a standby is ready, a fine timer (every 2 ms) waits until
  ≤ `SEAM_LEAD` (0.011 s) is left, then: `standby.el.play()`; the outgoing deck's gain falls 1 → 0 and the incoming's
  rises 0 → 1 along equal-power curves over 5 ms from `ctx.currentTime`; `this.deck = standby`; the old deck (and
  `onEnded` for it is now ignored, as `deck !== this.deck`) is paused and disposed 60 ms later; `onAdvance(deck)`
  is called. A paused or seeked-away current deck stops the fine timer; the standby stays.
- `SEAM_LEAD` and the blend are constants, chosen from the measurement above and checked again by hand on Windows.

## The player (`src/renderer/js/app.js` + a small pure module)

`src/renderer/js/gapless.js` (pure, tested):
- `PREPARE_SECONDS = 10`.
- `seamlessNext({ crossfade, repeat, spotify, nextPath, nextDetails, currentCue, quality, engineRate, systemRate,
  isCdTrack })` → `{ url, segment } | null`: null when crossfade > 0, repeat ONE, Spotify, no next path, a CD track,
  the next is a cue track continuing the current one in the same file, or the next track's target rate under
  `quality` differs from `engineRate` (HIGH: the engine must be at `systemRate`, i.e. not custom). Otherwise the next
  file's media URL and, for a cue track, its segment.

In `playbackTick` (crossfade off, playing, not Spotify): when ≤ `PREPARE_SECONDS` are left and nothing is prepared
for `upcomingIndex()`'s path, its details are fetched (cached), `seamlessNext` decides, Sound Check's `known()` gives
the trim, and `engine.prepare()` runs, remembering `{ path, index }`. On each tick, if `upcomingIndex()`'s path is no
longer the prepared one, `engine.cancelPrepared()` (and it's prepared again on a later tick). `engine.watchSeam()`
runs on each tick too.

`engine.onAdvance` → `state.index = prepared.index`; `load(path, { seamless: true })`. In `load()`, `seamless` skips
`applyQuality`, `engine.load` and `play()` (the deck is already playing) and runs everything else as for any track —
title, cover, lyrics, history, Sound Check's `follow`, waveform, media session, mini player, Discord, queue view.

`trackFinished` stays the fallback: if the seam didn't happen (nothing prepared, a file that wouldn't load, the timer
starved), the next track loads after `ended` as today.

## Errors

A standby that fails to load is dropped silently; the seam falls back to today's behaviour. A failed `play()` on the
standby at the seam: the outgoing deck is kept as the current one, `ended` follows, and the fallback loads the track.

## Testing

- `gapless.test.mjs`: every null case of `seamlessNext`, a plain next file, a cue track in another file (its segment),
  rate rules for HIGH / LOSSLESS / HIRES.
- `audio-element-deck.test.mjs` (fake elements and context): `prepare` leaves a paused standby at gain 0 seeked to the
  segment start; `cancelPrepared` and a new `load` dispose it; `watchSeam` starts it when ≤ `SEAM_LEAD` is left, swaps
  `deck`, schedules both blend curves, calls `onAdvance` once, and ignores the old deck's `ended`; a paused deck
  doesn't seam; a failed `play()` keeps the old deck.
- By hand, in the app (isolated `CDPLAYER_HOME`): the spike's step files (0.25 then 0.5) queued as two tracks,
  measured at the engine's output through a tap — no silence and ≤ 3 ms overlap at the seam; a CDPlayer rip of a
  continuous album by ear; skip, seek near the end, edit the queue during the last 10 s, pause at the seam; crossfade
  on still crossfades; LOSSLESS with a 44.1 → 96 kHz change falls back without errors.
