# Sound Check — design

## Goal

Songs from different albums and decades play at the same loudness, as with Apple Music's Sound Check or a player that
reads ReplayGain. Today nothing evens them out: the graph in `src/renderer/js/audio.js` is decks → mono → EQ →
spatial → volume, and a 1985 CD rip after a 2015 remaster is 6–10 dB quieter. Shuffle, crossfade and the shelf's
mixed sorts make that jump happen all the time.

## Decisions (agreed)

- **Settings → SOUND CHECK**: `OFF` (default), `TRACK`, `ALBUM`. It's an option you turn on, not on by default.
- ALBUM keeps an album's own quiet and loud songs as they were mastered; TRACK makes every song alike.
- Target loudness **−18 LUFS** (ReplayGain 2's reference), so ReplayGain tags and our own measurements agree.
- A quiet song is raised only as far as its peak allows (no limiter, no clipping); loud songs are lowered.
- Loudness comes from the file's **ReplayGain tags** when it has them, else from **measuring it once** (ITU-R BS.1770
  integrated loudness), kept in a cache.
- Only what's played is measured: the loaded track first, then the rest of its album. No library-wide background scan.
- Not in this version: **Spotify** (it evens out loudness itself), a **live audio CD** (its rips are measured as files),
  and **untagged files longer than 20 minutes** (cue-sheet images, DJ mixes) — decoding them whole would take hundreds
  of MB. Tagged long files are evened out from their tags. These play at their own loudness, as today.

## Where the loudness comes from

`metadata.js` adds `replayGain` to a track's details when the tags have it (music-metadata's
`common.replaygain_track_gain/peak`, `replaygain_album_gain/peak`; Opus `R128_TRACK_GAIN/R128_ALBUM_GAIN` are Q7.8 dB
relative to −23 LUFS, so +5 dB is added): `{ trackGain, trackPeak, albumGain, albumPeak }` in dB and linear peak,
any of them `null`.

Otherwise the renderer measures the file (below) and the result is kept in `soundcheck.json` in the data folder:
`{ version: 1, tracks: { [path]: { stamp, loudness, peak, duration } } }` — `stamp` is `size:mtime` as in the shelf
cache, so a changed file is measured again. `src/main/soundcheck-cache.js`, with IPC `soundcheck:get(paths)` →
`{ [path]: entry }` (only fresh entries) and `soundcheck:put(path, entry)` (written a second after the last change).
A cue track is a stretch of its sheet's file; it's looked up and measured by that file.

## Measuring

`src/renderer/js/loudness.js` (pure, tested with `node --test`):
- `kWeighting(sampleRate)` → the two biquads of BS.1770 (high shelf + high pass), coefficients worked out for any rate.
- `integratedLoudness(channels, sampleRate)` → `{ loudness, peak }`: 400 ms blocks with 75 % overlap, absolute gate at
  −70 LUFS, relative gate at −10 LU; channel weights 1 (left, right; more channels are summed at 1, surrounds aren't
  weighted — music here is stereo). `loudness` is `-Infinity` for silence.
- `trackGain({ loudness, peak })`, `albumLoudness(entries)` (duration-weighted power mean of the tracks' loudness,
  peak = the highest), `gainFor(mode, track, album)` → `{ db, linear, source }` with
  `linear = min(10^(db/20), 0.944 / peak)` (−0.5 dB margin: the peak is measured on a resampled copy).

`src/renderer/js/sound-check.js` does the work: fetches `cdp.mediaUrl(file)` (the media protocol already turns AIFF,
AU and ALAC into WAV), `decodeAudioData` on an `OfflineAudioContext` at **16 kHz** (K-weighting's shelf is at 1.5 kHz;
a 20-minute stereo file is ~150 MB while decoding), skips files whose details say they're over 20 minutes, one file at a
time, and `soundcheck:put`s the result. A file that can't be decoded is remembered for the session and skipped.

## Applying it

`AudioEngine.createDeck` puts a `trim` GainNode between a deck's source and its crossfade gain, so crossfade curves are
untouched. `engine.setTrim(deck, linear, rampSeconds)`; the current deck is `engine.deck`.

In `app.js`, after a file track is loaded (`load()`), when SOUND CHECK isn't OFF:
1. `known = replayGain from details` or `soundcheck:get([file])`. Known → `setTrim` at once (before `play()`).
2. Not known → it plays at 1.0, the file is measured first, then `setTrim(…, 1 s)`.
3. ALBUM: the album is the shelf's (`soundcheck:album(path)` → its paths, from `shelf.albumOf`, i.e. the shelf's last
   read or its cache). Until every track of it is known, the track's own gain is used; once all are, the album gain,
   ramped over 2 s. A track not on the shelf uses TRACK. Album ReplayGain tags, when present, are used as they are.
4. The rest of the album's tracks are measured in the background, in album order, after the loaded one.

Changing SOUND CHECK applies to the deck playing now, ramped over 0.5 s; OFF sets the trim to 1.
A gapless cue sheet (`engine.setSegment`) keeps the same file, so the same gain.

## What you see

Under the title, after the ◈ LOSSLESS badge: `SC −4.2 DB` in the same small print, only when SOUND CHECK is on and the
playing track has a gain. Hover: `SOUND CHECK · ALBUM · FROM REPLAYGAIN TAGS` / `… · MEASURED` / `… · LIMITED BY THE
SONG'S PEAKS` when the peak cut a boost. While measuring: `SC …`.

**Settings → SOUND CHECK** (after SPATIAL AUDIO): a menu `OFF`, `ALBUM`, `TRACK`, hint: "Plays every song at the same
loudness, from its ReplayGain tags or measured once. ALBUM keeps an album's quiet and loud songs as they were made."
Not shown for Spotify discs (the row says it doesn't apply, as QUALITY does). HELP gets one line.

## Settings storage

`soundCheck: 'OFF' | 'TRACK' | 'ALBUM'` appended as the next field of `settings.txt` (after `taskbarDisc`); missing or
unknown → `OFF`. Russian strings in `src/locales/ru.json`.

## Testing

- `loudness.test.mjs`: the 48 kHz K-weighting coefficients match BS.1770's table; a 1 kHz sine at 0 dBFS in one
  channel measures −3.01 ±0.1 LUFS (BS.1770's own check), at −20 dBFS in both channels −20 ±0.1 LUFS; the same noise
  measured at 16 kHz is within 0.5 LU of 48 kHz; gating ignores silence; `gainFor` caps by peak; album power mean.
- `soundcheck-cache.test.js`: stale stamps dropped, writes debounced, a broken file ignored.
- `metadata-format.test.js`: ReplayGain and R128 tags read into `replayGain`.
- `state.test.js`: the new settings field round-trips and defaults to OFF.
- By hand: a quiet old rip after a loud remaster on shuffle; crossfade between them; a gapless cue album.
