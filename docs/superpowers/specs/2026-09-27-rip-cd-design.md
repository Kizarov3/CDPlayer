# Rip this CD

Date: 2026-09-27 · Status: draft for review

## Goal

With an audio CD in the drive, one click saves the whole disc into the music folder as lossless FLAC files, named
and tagged from MusicBrainz with the album cover, so the album is on the shelf and plays without the disc. On
macOS, Linux and Windows. Nothing to install.

What the user said: "Rip this CD" means "copying the music from a real audio CD onto your computer as files";
FLAC, saved automatically into the music folder (not a folder picker, not MP3); approved this design.

## What the user sees

- While an audio CD is in the drive, a **RIP** button sits next to the **AUDIO CD** button.
- Click it → ripping starts, one track at a time; the button reads `RIPPING 4/12 · 38%` (tracks done / total, and
  the share of the disc's sectors done). Clicking it again cancels (asks nothing; a cancel is cheap).
- Music keeps playing meanwhile — the disc too.
- Done → `RIPPED TO <Album>` in the status line for a few seconds; the button returns to RIP; the shelf is rescanned
  so the album is on it.
- The album folder already exists → a small dialog: *"<Album> is already in your music folder. Replace it?"*
  **REPLACE** / **CANCEL**. Replace removes only the files this rip is about to write (`NN Title.flac`,
  `cover.jpg`), nothing else in the folder.
- No music folder chosen yet → the folder picker (the shelf's) opens first.

## Where the files go

`<music folder>/<Album Artist>/<Album> (<Year>)/<NN> <Title>.flac` and `cover.jpg` beside them.

- A multi-disc release: `<NN>` becomes `<disc>-<NN>` (`2-05 Title.flac`).
- Not named by MusicBrainz: `Unknown Artist/Audio CD (<disc ID first 8 chars>)/<NN> Track <N>.flac`.
- No year: `<Album>` without the parentheses.
- Names are made safe for every system: `/ \ : * ? " < > |` and control characters → `_`, trailing dots and spaces
  removed, Windows' reserved names (`CON`, `NUL`, `COM1`…) prefixed with `_`, each part at most 120 characters.

## Design

### 1. The FLAC encoder — `src/main/encoders/flac.js`

`encodeFlac(pcm: Int16Array interleaved stereo, { sampleRate: 44100 }) → Buffer`, pure JavaScript, no dependencies.

- Stream: `fLaC`, STREAMINFO (min/max block size 4096, min/max frame size, 44100 Hz, 2 channels, 16 bits, total
  samples, MD5 of the audio), then frames of 4096 samples (the last shorter).
- Each frame chooses per channel the smallest of: **verbatim**, **FIXED** predictors order 0–4, and **LPC** order 8
  (autocorrelation with a Welch window, Levinson–Durbin, coefficients quantised to 15-bit precision); residuals
  **Rice**-coded with partition order 0–4, the best parameter per partition. Stereo: the smallest of
  left/right, left/side, side/right and mid/side.
- Frame header CRC-8 and frame CRC-16 as the FLAC format requires.
- Aim: within a few percent of `flac -5` in size; correctness is what matters.

`decodeFlac(buf) → Int16Array` — `src/main/encoders/flac-decode.js`: a decoder for exactly what the encoder writes
(verbatim, fixed, LPC, Rice, the four stereo modes). Used to check every file before it's kept, and by the tests.

### 2. Where the audio comes from — `src/main/rip.js` `trackPcm(disc, index) → Int16Array`

- macOS: the disc's `N Audio Track.aiff` through the existing `aiffToWav` (big-endian → the WAV's little-endian
  PCM), header stripped.
- Linux: the gvfs `Track N.wav`'s data chunk.
- Windows: `win-cd.readSectors(drive, lba, sectors)` in chunks of 25 (a sector that won't read is silence, as in
  playback — the rip goes on).

### 3. The rip — `src/main/rip.js`

`ripDisc(disc, names, { musicFolder, onProgress, signal, encode }) → { folder, files }`, in the main process. The
disc is read there — on Windows through the same drive helper playback uses (a second helper would fight it for the
drive) — and the heavy part, encoding and checking, runs in a worker thread (`src/main/rip-worker.js`: `encode(pcm)
→ { flac }` after its own decode-and-compare), so playback and the window stay smooth. Progress goes to the window.

For each track, in order: read its PCM → the worker encodes it, decodes the result and compares it with the PCM
(and the MD5) → write `.<name>.flac.part` → tag it (`tag-writer.writeTags`: title, artist, album, album artist, year, track/of,
disc/of, MusicBrainz release ID, cover) → rename to its final name. `cover.jpg` is written once, from the cover
MusicBrainz named the disc with.

Stops cleanly:
- cancelled (`signal`) → the `.part` file is deleted; finished tracks stay; status `RIP CANCELLED`.
- the disc is taken out (a read fails with the disc gone, or `audio-cd-gone`) → same; status `DISC REMOVED`.
- a write fails (disk full, permissions) → the `.part` is deleted; status `RIP FAILED · <reason>`.
- the check after encoding fails (an encoder bug) → the track is not written; status `RIP FAILED · couldn't
  check <title>`. Never keeps a file that doesn't decode back to the disc's audio.

One rip at a time.

### 4. The window — `src/renderer/js/app.js`, `index.html`, `styles.css`

- `#rip-button` beside `#cd-button`: shown only while `state.audioCd` is set; `RIP` / `RIPPING n/N · p%`.
- IPC: `rip:start(mount)`, `rip:cancel()`, events `rip-progress { done, total, percent }` and
  `rip-done { ok, folder, reason }`; `rip:exists(mount)` → the album folder path if it exists (for the dialog).
- After a rip: `RIPPED TO <Album>` and the shelf's cache is refreshed.

## Out of scope

- Other formats (MP3, ALAC), a choice of folder per rip, AccurateRip / CUETools checks, re-rip of single tracks.
- CD-TEXT names. Ripping while the tray animation plays the disc is fine; ripping two discs at once isn't offered.

## Testing

Unit tests (node --test, on this Mac):
- Encoder/decoder round trip is bit-exact on: silence, a full-scale square wave, a sine sweep, white noise, a stereo
  file where L = R (mid/side wins), a last frame shorter than 4096, and a real 30 s excerpt of a fixture track.
- STREAMINFO: total samples and MD5 right; `music-metadata` reads our FLAC's duration, channels and bits.
- Frame CRC-8/CRC-16 correct (a flipped byte is caught by the decoder).
- File names: every unsafe character, reserved Windows names, long names, multi-disc numbering, unnamed discs.
- `ripDisc` with a fake disc (PCM from a function) → the right files, tags readable by `music-metadata`, cover.jpg;
  cancel mid-way leaves no `.part`; a write error stops with the reason.

In the running app:
- Chromium plays a ripped FLAC (the packaged app's smoke test decodes a FLAC fixture already; a rip output is added).
- The user's Three Dollar Bill, Y'all$ CD ripped on this Mac: 13 files in `Limp Bizkit/Three Dollar Bill, Yall$
  (1997)/`, on the shelf with its cover, plays.
- Windows: a test build ripping the same disc in the user's VM.
