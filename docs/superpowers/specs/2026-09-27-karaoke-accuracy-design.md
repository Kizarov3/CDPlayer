# Karaoke: timing as accurate as Apple Music Sing, and its look

Date: 2026-09-27 · Status: draft for review

## Goal

Karaoke Mode (`Y`) should light each word up exactly when it is sung — holding on long notes, pausing in the
gaps — and look like Apple Music's karaoke view: words that glow and lift as they are sung, backing vocals under
the line, and duet singers on opposite sides.

What the user said: "make karaoke more accurate as on Apple Music karaoke" — both the timing and the look.

## What's wrong today (measured, not guessed)

1. **Word-timed lyrics are rarely used.** `findLyrics` asks lrclib.net first; lrclib only times whole lines.
   Unison — the only source with word timings — is asked only when lrclib has nothing. So most songs get an even
   sweep across the line instead of real word timing.
2. **Word and line end times are thrown away.** Unison's TTML gives every word a `begin` and an `end` (Espresso:
   427 timed words) and every line an `end`. `ttml.js` keeps only the begins. A word therefore fills until the next
   one starts: long notes fill too fast, pauses between words are filled through, and a line stays lit through the
   instrumental break after it.
3. **Backing vocals and singers are dropped.** `ttm:role="x-bg"` spans are skipped, and `ttm:agent` (v1/v2/v3 —
   In the End has Chester, Mike and both) is ignored.
4. **No output-latency correction.** Karaoke uses `engine.position` (the media element's `currentTime`), which runs
   ahead of what reaches the ears by the output latency — tens of milliseconds wired, 150–250 ms on Bluetooth.
5. **Line-only lyrics sweep evenly by time**, not by how long each word takes to sing.

## Design

### 1. Lyrics lookup prefers word timing

`findLyrics` (src/main/online.js) asks Unison first for the name as given (and its guesses with an artist), and
uses its answer when it is TTML with word timings. Otherwise the order is as today (lrclib exact → lrclib search →
Unison line-timed/LRC → lrclib free text). Unison answers in well under a second; a miss (404) costs one request.
Unison's existing checks stay: same song and artist, and within 4 s of the file's length.

Lyrics already inside the file still win — they are the user's own.

### 2. One text format that carries everything: extended enhanced LRC

Lyrics stay a single string (so the lyrics panel, the booklet, "Save found art & lyrics" and other players keep
working). `ttmlToLrc` writes, and `parseLrc` reads, three additions to enhanced LRC — each one a convention other
LRC readers already ignore or show harmlessly:

- **Word ends.** A stamp with no word after it ends the word before it:
  `[00:08.84]<00:08.84>Now <00:09.16>he's <00:09.59> <00:10.06>thinkin'` — "he's" ends at 9.59, then a gap until
  "thinkin'" starts at 10.06. A stamp at the end of the line ends the line (`… <00:12.34>oh<00:12.90>`).
- **Singers.** A `v1:` / `v2:` / `v3:` prefix after the line stamp, as Apple-derived LRC files write it:
  `[00:16.71]v2:<00:16.71>It <00:17.02>starts`. Only written when the song has more than one singer.
- **Backing vocals.** A `[bg:` line right after the line they are sung under, with its own word stamps:
  `[bg: <00:25.10>(oh <00:25.40>no)<00:25.90>]`. LRC readers treat an unknown `[tag:]` line as metadata.

`parseLrc` returns per line: `time`, `end` (null when unknown), `text`, `agent` (null, 'v1', 'v2', 'v3'),
`words: [{ time, end, text }]` (end null when unknown), and `bg: [{ time, end, text }] | null`. Everything it
returns today stays the same for plain and enhanced LRC without these additions.

### 3. Word progress from real begin/end times

`wordProgress` (src/renderer/js/lyrics.js):

- A word with an `end` fills from `time` to `end`, and holds full after it — pauses between words stay unfilled.
- A word without an `end` fills until the next word starts, capped (as today).
- **Line-only lyrics:** the line's time (until its `end`, or the next line, capped) is shared among its words by
  their sung length — letters, with syllables counted — instead of evenly. Each word then fills like a timed word.
  This is a better guess, not real timing; it is only used when the lyrics have none.

`currentLineIndex` uses a line's `end`: after it, and before the next line starts, no line is current. Karaoke then
shows Apple's "• • •" breathing dots in the gap when it is longer than ~3 s.

### 4. What you hear, not what's decoded

Karaoke (and the lyrics panel and booklet highlight) use `engine.heardPosition`: `position` minus the audio
context's `outputLatency` (falling back to `baseLatency`), read each frame since it changes when the output device
does. Settings gets **Lyrics Offset** (−500…+500 ms, step 50, default 0, saved with the other settings) for the odd
song whose lyrics are timed a little off; it applies to everything that follows the lyrics.

### 5. The Apple Music look

In Karaoke Mode (styles.css `.k-*`, karaoke.js):

- **Fill.** The sung part of a word is the accent colour, with a soft edge (a short gradient, not a hard cut) that
  moves through the word.
- **Lift.** A word rises a couple of pixels as it is sung and settles back. A word held for more than ~1 s glows
  (text-shadow in the accent, growing with how long it's held).
- **Depth.** Lines further from the current one are dimmer and slightly blurred; the scroll to the next line eases
  with a gentle overshoot.
- **Backing vocals** sit under their line, smaller and dimmer, and fill on their own timing.
- **Duets.** In a song with singers, v1's lines are left-aligned, v2's right-aligned, v3's (both) centred; with one
  singer everything stays centred as now.
- The Animations setting off: no lift, glow, blur or overshoot — the fill only.

## Out of scope

- Per-syllable timing inside a word (Unison times words; syllable spans without spaces are already joined into one
  word by `ttml.js`).
- Pitch/vocal-removal features, and scoring.
- Changing lrclib's lyrics (it only has line timing).

## Testing

Unit tests (node --test):

- `ttml.test` / metadata-sources: TTML → extended LRC keeps word ends, line ends, gaps, `v1`/`v2`/`v3` (only when
  more than one singer), and `[bg:` lines with their timings; a real Unison sample (Espresso's first lines) as the
  fixture.
- `lyrics.test`: `parseLrc` reads all three additions, and plain / enhanced LRC parse exactly as before;
  `wordProgress` holds in gaps, fills over each word's own duration, and splits line-only time by sung length;
  `currentLineIndex` returns no line after a line's end.
- `findLyrics` asks Unison first and takes word-timed TTML; falls back to lrclib as before when Unison has none or
  only line timing.

In the running app (a separate test copy, never the user's window): Karaoke on a Unison song (Espresso or In the
End — duet) and an lrclib-only song, screenshots of a held word, a gap with the dots, backing vocals and the duet
alignment; the lyrics offset setting moves the highlight.
