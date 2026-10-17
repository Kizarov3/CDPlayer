# Hidden track — design

## Goal

Many CDs hide a song at the end of their last track: the song ends, minutes of silence follow, and then another
song plays — Nirvana's *Nevermind* ("Something in the Way", ten minutes of nothing, "Endless, Nameless"), Green Day's
*Dookie*, Coldplay's *Parachutes*. A rip keeps it all in one file. Today CDPlayer plays it like any file: the
listener sits through the silence not knowing whether anything is coming, or skips it and never finds the song.

CDPlayer finds the hidden song in the file, plays the silence as the CD does — but says that something is coming
and counts down to it — and says so when it begins. It is one more thing the player knows about a real CD, in the
spirit of the shelf's dust and the booklet's pen marks.

## Decisions (agreed with the user)

- The silence is **played, not skipped**, as on a CD, with a **countdown** to the hidden song.
- The countdown shows in two places: **the status pill** at the top (A) and **the queue list** (D). The user
  approved mockups of the three moments described under *What the listener sees*.
- When the hidden song begins, the player **says so**.

Everything else here was decided while designing (with two agents' reviews of the code) and marked *(my call)* where
the user didn't choose it; the user approved the mockups and the description as a whole.

## Non-goals

- Cue-sheet tracks, audio-CD tracks read from the drive, Spotify: no detection (no waveform decode is done for them,
  and Spotify's audio can't be read). *(my call)*
- A song hidden in the pregap before track 1 (HTOA): not in this version. (Found while designing: `cue.js` throws
  away INDEX 00, so a cue sheet's pregap can't be played at all; the Windows ripper never reads it.)
- Files of 30 minutes or more: no detection, as they get no waveform today (`app.js:712`). *(my call)*
- No setting. The feature changes nothing about how a file plays, only what the player says about it. *(my call)*

## Anti-goals (it fails if…)

- A quiet coda, an ambient outro, a pause inside a song, a classical movement's rest or an applause gap is taken for
  a hidden track.
- The silence is skipped by itself, or a "skip?" button nags.
- The surprise is spoiled: the hidden song's name, a ghost row or a marker shows before the listener reaches the
  silence the first time.
- It's cheap: confetti, a sound, a popup or toast, an achievement, "You found it!". One word in the pill is enough.
- A made-up track number (a CD has no track 13 here) or an extra ring on the disc's data side.
- The pill blinks every second.
- Anything about playback changes: gapless, crossfade, NEXT, PREVIOUS, REPEAT, SHUFFLE, the changer, HISTORY's count.

## Detection

**Where.** In the waveform's decode, which already decodes every file (not cue, not CD, under 30 minutes) at 8 kHz
as it loads, whether or not WAVEFORM is shown (`audio.js:427`, `app.js:709-714`). Today `computeWaveform` returns
only 220 normalized RMS buckets of channel 0; it's extended to **also** return a power envelope: mean power over
**all channels** per 100 ms block (≈ 12 000 floats for 20 minutes). The waveform it draws stays as it is. No second
decode.
The result is ready seconds after the track loads — long before its silence.

**The algorithm** — a pure function `detectHidden(envelope)` in a new module (e.g. `src/renderer/js/hidden-track.js`),
tested under `node --test`. Prototyped and checked on 11 synthetic files (≈ 60 ms per 20-minute file):

1. Smooth the envelope over 1 s (dBFS). The file's floor = its 5th-percentile level.
2. Silence threshold `T = clamp(floor + 12, −70, −48)` dBFS — digital zeros or 16-bit dither give −70; tape/vinyl hiss
   at −58 gives −48.
3. A **gap** is a run below `T` starting at least 30 s into the file, and either
   - its median under −70 dBFS (digital silence) and at least 10 s long, or
   - at least 30 s long and steady: its 95th − 5th percentile spread ≤ 6 dB (hiss, not a quiet passage).
4. After the gap, "sound" is a block above `max(gapMedian + 15, −60)` dBFS. The hidden part needs at least 20 s of
   sound, spanning at least 20 s (not a few seconds of noise or a click).
5. Several gaps qualify → the longest. Result: `{ songEnd, hiddenStart }` in seconds, or `null`.
6. The smoothing puts `hiddenStart` ≈ 0.5 s early: refine it on the raw 100 ms blocks (the first block above the
   sound level), so a click on the marker lands on the music, not before it.

The synthetic cases that passed, to keep as tests: *Nevermind*-like (232 s song with an 8 s fade, 598 s zeros, 405 s
hidden) with zeros, with dither and with −58 dBFS hiss under everything; *Dookie*-like (170 / 80 / 96 s); a quiet
a cappella hidden song at −38 dBFS with 1 s pauses. Rejected: a 120 s ambient outro at −46 dBFS; 600 s of zeros then
4 s of noise; a 3 s dead stop mid-song; a 20 s interlude at −52 dBFS; a song then silence to the end; 30 s of leading
silence. The prototype — `detectHidden`, `envelope` and these 11 signals, all passing — is
`docs/superpowers/specs/2026-10-17-hidden-track-prototype.mjs` (`node` it to see the results); port it as the module
and its test, then add the raw-block refinement of step 6.

**Which files are announced.** Detection may run on every decoded file, but the player only acts on the **last
track of its disc**: the shelf album's paths are in disc and track order (`shelf.albumOf`, the `soundcheck:album`
IPC, `main.js:294`) — the last path of its disc number; for a file not on the shelf, its tags' track number equals
their track total. A loose file with neither: not announced. *(my call — a disc of a multi-disc album can have its own
hidden track, so it's per disc, not per album.)*

**Cache.** `hidden.json` beside `soundcheck.json`, through a `hidden-cache.js` modelled on `soundcheck-cache.js`
(keyed by path, checked by a `size:mtime` stamp, saved a second after a change). An entry: `{ songEnd, hiddenStart,
name, found }`, or `null` for "checked, nothing there". Kept out of `soundcheck.json` so its version never forces
every song to be measured again. With a cached entry the countdown and (once found) the ghost row are ready the
moment the track loads, without waiting for the decode.

## Naming the hidden song

In order:
1. The file's own title tag, split on " / " (rips named from MusicBrainz often have "Something in the Way /
   Endless, Nameless") — the part after it.
2. MusicBrainz, which names such recordings "A / B" (Nevermind's: "Something in the Way / Endless, Nameless",
   1 235 s). No lookup made during normal play returns that title today, so this is **one new lookup per file**:
   when a hidden part is detected and the cache has no name yet, main runs `online.lookupTags` (`online.js:194`,
   `pickRecording` matching by the file's artist, album and duration) through a new IPC; if the recording's title
   is "A / B" with A matching the file's title, B is the name. The result — a name or "none" — goes into the cache
   entry, so it's asked once per file. Offline or a failed lookup: no name, asked again on a later load. The name
   is fetched ahead but never shown before the hidden song begins. *(my call — the approved mockup promised the name
   from MusicBrainz, and a well-tagged rip has only "Something in the Way" in its title.)*
3. Otherwise `Hidden track` / `Скрытый трек`.

When a file's title tag is "A / B", the player's title shows **A** until the hidden song begins. *(my call)*

## What the listener sees

All words in English and Russian in `src/locales`, in the app's voice. The examples are the agreed wording.

**Before the silence, the first time:** nothing. No marker, no ghost row, no UP NEXT. (The waveform's bump after the
flat line is the file's honest outline and stays.)

**During the silence** (playing, `songEnd ≤ position < hiddenStart`):
- **The pill** counts down: `NOT OVER YET · 7:42` / `ЕЩЁ НЕ ВСЁ · 7:42`. Once the song has been found:
  `ENDLESS, NAMELESS IN 7:42` / `ENDLESS, NAMELESS ЧЕРЕЗ 7:42`, or `HIDDEN TRACK IN 7:42` /
  `СКРЫТЫЙ ТРЕК ЧЕРЕЗ 7:42` without a name. It's part of `stateStatus()` (`app.js:100`), so a passing word (volume,
  tray) still takes the pill for its 6 s and the countdown comes back. Updated once a second **without** the fade
  `setStatus` gives a new word (`app.js:106-111`) — the pill must not blink. PAUSED and the open tray win, as now.
- **The seek bar** shows a small `?` above the point where the hidden song starts, on the waveform and on the plain
  line when WAVEFORM is off (`widgets.js`). A click within a few pixels of it lands exactly on `hiddenStart`.
- **The queue** (and the changer's tracklist) gets one ghost row, indented under the file's row, with no number and
  no time: `· · ·  ???`. The pill already has the time.

**When the hidden song begins** (position reaches `hiddenStart`, or a seek lands past it):
- The pill says `HIDDEN TRACK` / `СКРЫТЫЙ ТРЕК` once, then goes back to NOW SPINNING by its usual 6 s timer.
- The title becomes the hidden song's name; the artist stays. A `HIDDEN` badge in the line under it.
- The ghost row's `???` becomes the name (a fade when animations are on).
- The media session, mini player and Discord (if on) follow the new title; Discord's timestamps cover the hidden
  song's own stretch. During the silence Discord gets no timestamps, so no bar runs past the song.
- The share card (P) names the hidden song and quotes no lyrics from the main song.
- A seek back before `hiddenStart` puts the main title back.

**Found.** The hidden song counts as found once 8 s of it have played (HISTORY's rule, `HEARD_SECONDS`). It's stored
in the cache entry (`found: true`). From then on, for that file, from the moment it loads: the `?` marker shows, the
ghost row shows with the name, and a click on the row plays from `hiddenStart` (loading the file first if it isn't the
one playing).

**The booklet.** Once found, the hidden song's name is written in pen under the last song, as an owner would add it,
without tally marks or a number. Where MusicBrainz lists the hidden song as a track of its own, the booklet's whole
tracklist (`booklet.js` `wholeList`) must not show it in grey as missing from the collection when the file holds it.

## What doesn't change

- **HISTORY and play counts:** the file is counted once, as now. The hidden song has no count of its own and no
  tally marks in the booklet. (An early mockup's caption said otherwise; the user was told this version replaces it
  and agreed. One count per file keeps `load()`, HISTORY, `plays.js`, disc wear and the booklet's tallies untouched.)
- **NEXT** during the silence goes to the next track, album or disc, as on a CD. **PREVIOUS** past 5 s goes to the
  file's start. **REPEAT ONE** repeats the whole file, silence included. SHUFFLE, the changer, DISC SKIP: unchanged.
- **Gapless and crossfade:** they act at the file's end, after the hidden song (`gapless.js`, `app.js:2160-2175`).
- **The disc's data side:** one ring for the track, as on the CD.
- **Lyrics and karaoke:** the main song's, as now.
- **Sound Check:** its loudness gates leave the silence out; nothing to do.

## Found while designing (not part of this feature)

- **AUTOMIX** (branch `worktree-automix`, unmerged): its ending detection is relative to the song's level and, on
  the synthetic files, put the next song over a quiet hidden song or skipped it with the silence. Whichever of the two
  is merged second treats a file with a hidden track like an album running on: a gapless seam at the file's end.
- **Sound Check under ALBUM** never gets *Nevermind*'s album level: its last file (1 235 s) is over
  `MAX_MEASURE_SECONDS` and its decode over `MAX_DECODE_BYTES`, and one unmeasured song makes `albumLevelOf` give up.
  Also `albumLevel` weights songs by full duration, so a long silence weighs as music. A separate fix.

## Testing

- `hidden-track.test.mjs`: the synthetic cases above (found, with `songEnd` within 2 s and `hiddenStart` within
  0.2 s after refining; and the rejected ones); the naming rules (" / " split, MusicBrainz match, fallback); the
  last-track-of-its-disc rule.
- `hidden-cache.test.js`: as `soundcheck-cache.test.js` — stamp invalidation, `null` entries, `found` kept.
- Countdown and pill text as a pure function of `(entry, position, found, playing)`, tested in EN and RU.
- By hand in the app, with `CDPLAYER_HOME` set to a temporary folder (never the real `~/.cdplayer`): a real rip of *Nevermind*'s last track if available, else a synthetic FLAC built from the test
  signal; first time vs found; pause, seek onto the marker, NEXT during the silence, REPEAT ONE; WAVEFORM off; the
  changer; Russian.
