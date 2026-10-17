# AUTOMIX — design

## Goal

Like Apple Music's AutoMix: when the queue moves on by itself to a song that isn't the next one of the same album, the
next song's beginning plays over the end of this one — where this one actually winds down, not at the end of its file —
so there's no silence between them, and the overlap sounds deliberate rather than two songs talking at once.

Today there are two behaviours: gapless (CROSSFADE off), which keeps the silence that's in the files (a 6-second silent
tail, then a 2-second silent lead-in, is 8 s of nothing between shuffled songs), and CROSSFADE N s, which blends the
last N seconds of the *file* blindly — over silence if the song ended early, or cutting a song's ending short.

## Decisions (the user's)

- **A setting, off by default** — like every setting, nothing changes for anyone until they turn it on. Settings →
  SOUND → **AUTOMIX** (ON/OFF), next to CROSSFADE. While AUTOMIX is on, the CROSSFADE slider is inactive (dimmed, can't
  be dragged; its value is kept for when AUTOMIX is off again).
- **An album played in order stays gapless**, AUTOMIX or not: *The Dark Side of the Moon*, a live album or a classical
  work must run on exactly as it was made. AUTOMIX is for everything else the queue moves on to: a shuffled queue, a
  queue of songs from different albums, the CD changer moving to another disc, REPEAT ALL wrapping round.
- **No tempo or beat matching**: the songs play at their own speed and pitch. Smooth and without silence is the aim.

## Decisions (made in design — the user can still overrule)

- Only automatic advances mix. NEXT / PREVIOUS / picking a song / the end of a seek switch at once, as today.
- What's audible is found from the decoded audio (below), once per file, cached — as Sound Check measures loudness.
- To keep the overlap clean, the outgoing song's bass is drawn out through a rising high-pass filter during the mix, so
  two bass lines never sound together; the gains follow equal-power curves.
- Beyond the setting, only the status line says AUTOMIX during a mix, as it says CROSSFADING during a crossfade.

## When a transition is a mix

`mixKind({ automix, crossfade, repeat, spotify, current, next, … })` → `'GAPLESS' | 'AUTOMIX' | 'CROSSFADE' | 'PLAIN'`:

1. Spotify playing or next, a track read live from an audio CD → as today. REPEAT ONE → the song repeats; under AUTOMIX
   plainly (no crossfade into itself: the CROSSFADE slider is inactive).
2. The next track **continues the album**: a cue track that runs on in the same file (`continuesCurrent`), or both songs
   have the same album key (album artist or artist + album, lower-cased — `albumAimFor`'s key) and the next one's
   (disc, track) number directly follows (same disc and track + 1, or disc + 1 and track 1) — shuffled or not; or,
   for tags that are incomplete (no track numbers, a compilation whose artist changes from song to song), played in
   order — shuffle off, the next entry in the queue is index + 1 — and the same album name (or, with no album tag on
   either, the same folder). → `GAPLESS`, even with AUTOMIX on.
   (CROSSFADE N s keeps crossfading within albums, as it does today — that's the user's own choice of setting.)
3. AUTOMIX on → `AUTOMIX`. Off → CROSSFADE > 0 ? `CROSSFADE` : `GAPLESS` (today's behaviour exactly).

## Finding what's audible — `src/renderer/js/automix.js` (pure, tested)

`edges(channels, sampleRate)`, from the song decoded at 8 kHz (`OfflineAudioContext`), all levels against the song's
`body` (its typical loud level: the 75th percentile of 50 ms block levels):

- `start` / `end`: the first / last block above `body − 40 dB` (and −60 dBFS), ±50 ms. Outside is silence to skip.
- `fadeStart`: from where the 1-s smoothed level stays below `body − 6 dB` to the end — where its ending begins.
- `settle`: from where it stays below `body − 24 dB` — where the ending has died away for good. (−18 dB, the first
  try, sat on quiet last verses: the next song talked over Thom Yorke's last words in *The Bends*.)
- `gapEnd`: where the last ≥ 1 s silence inside the sound ends (a quiet coda after a pause, as in *Sour*).
- `introRise`: how long the song takes to get loud; `endLevel` / `headLevel`: its last / first second.

## Planning the mix — `mixPlan(out, inc)` → `{ at, overlap, startAt, fadeIn, fadeFrom, fadeOut }`

Tuned against the user's verdicts on six real transitions (v1: 1 too early, 5 and 6 a bit abrupt, 2 excellent, 3 and 4
good), a second opinion over all 573 pairings of their library, and a simulation of every pairing for clipping and for
holes the curves make.

- `startAt = inc.start`: the next song's leading silence is skipped.
- **An ending that dies away** (`end − fadeStart ≥ 2 s` and `end − settle ≥ 0.5 s`): the next song comes in at
  `max(settle, gapEnd, end − 10)`, but at least 1 s before the end — never over the last words, never in a silence
  before a coda. The old song plays its own decay for the first half of the overlap, then fades (equal-power) over the
  second, its bass drawn out by a high-pass gliding 20 → 250 Hz over the first half (fading it from the start left a
  hole: *Street Spirit*). The next one comes in at −10 dB (`fadeFrom`) and rises to full over 3 s — however short the
  overlap — so a loud song after a quiet ending doesn't jump in (*Sail To The Moon → By Myself*) and an opening hit
  isn't lost (*Master Of Puppets*); a song whose first second is 15 dB under its body opens quietly by itself and
  gets 0.5 s.
- **Anything else** — a dead stop, or an ending still sounding at its end (a ringing last chord, *Pyramid Song*):
  its end is kept as it is (no fade, no bass cut, a 50 ms fade over what's then only silence). The next song comes in
  1 s before the end and rises from silence within that second (0.5 s if it opens quietly) — or, when the old one's
  last second is within 5 dB of its body (it stops at full tilt, *Given Up*), only 0.3 s before: two loud things at
  once sound like a collision.
- `overlap` never exceeds a third of either song's audible length.

The constants are the ones these checks settled on; the next tuning should come from listening.

## Keeping the overlap from clipping

Measured on the user's library (191 songs, each mixed into another): 26 of 191 overlaps summed past full scale, by
up to +2.2 dB for up to ~11 ms — dead stops and endings alike (CROSSFADE does the same). So the engine's output goes
through a guard: ×0.5 → a WaveShaper → ×2 (both exact in floats). The shaper has no curve — Chromium then passes the
sound bit for bit (checked: 96000 of 96000 samples identical) — except while two songs overlap (a mix or a crossfade),
when `softClipCurve` leaves everything below ±0.9 as it is (to float rounding) and bends what's above smoothly towards
±1, never past it. Overs a file decodes to by itself (loud AAC masters) are left as they always were.

## Measuring and caching

- `measureEdges(url)` in the renderer decodes as `measureFile` does (and when Sound Check is measuring the same file
  anyway, one decode can give both) and runs `edges`. Same limits as Sound Check: files over `MAX_MEASURE_SECONDS` or
  `MAX_DECODE_BYTES` aren't measured. A cue track: not measured (its file is an album image) → fallback.
- Kept in `automix.json` in the data folder, the shape and staleness rule of `soundcheck-cache.js` (`stamp` =
  size:mtime), through IPC as Sound Check's cache is.
- When it's measured, with AUTOMIX on: the playing song as soon as it starts, then the upcoming one (`upcomingIndex()`)
  — one file at a time, the newest wish first; an upcoming song that's no longer upcoming is skipped when its turn
  comes. Turning AUTOMIX on measures the playing and upcoming songs at once.

## The engine (`src/renderer/js/audio.js`)

Gapless's standby deck and seam become the mix's:

- Each deck gets a `BiquadFilterNode` (high-pass, at 0 Hz — transparent) between trim and gain:
  source → trim → **filter** → gain → input.
- `prepare(url, { segment, trim, startAt = 0 })` — as today, the standby is seeked to `startAt` (within a segment: its
  start).
- `armMix({ at, overlap, fadeIn })` — instead of the end-of-file seam, the standby starts when the playing deck reaches
  `at` (file time): `watchSeam` aims its fine timer at `at` rather than at the end. Then: `standby.el.play()`; the
  curves above are scheduled from `ctx.currentTime`; `this.deck = standby`; the old deck becomes `fadingOut` (so
  `cancelCrossfade` — any manual load, stop, seek, jog — cuts it off) and is disposed at the end of the overlap;
  `onAdvance(deck)` is called at the start, so the title, cover, lyrics, etc. switch as the new song comes in.
- Without `armMix`, the seam is gapless's, unchanged.
- A failed `play()` on the standby: as gapless — the old deck plays on, `ended` and the fallback follow.

## The player (`src/renderer/js/app.js`)

- `state.automix` (false), `setAutomix(v)`: saves, drops anything prepared, re-plans.
- `playbackTick`: with the transition `AUTOMIX` and both songs' edges known, `prepareNext` prepares the next song with
  `startAt` and arms the mix once ≤ `overlap + PREPARE_SECONDS` is left before `at`. The CROSSFADE branch is skipped
  under AUTOMIX.
- **Fallbacks**, so AUTOMIX is never worse than off:
  - edges not known (yet, or can't be): gapless as today;
  - the next song needs the audio context rebuilt at another rate (QUALITY LOSSLESS / HI-RES): no overlap is possible,
    but the silence still goes — once the playing song reaches `out.end` it's treated as finished, and the next loads
    at `inc.start`.
- Seeking past `at` (into the overlap region) before the mix began: the mix starts at once with what's left.
- Pausing mid-mix: pauses both decks (the old one's fade resumes with it) — or, simpler, finishes the old deck off at
  once; the builder picks whichever is cleaner in the engine, as long as nothing plays on unheard.

## Settings

After hearing it, the user asked for AUTOMIX and CROSSFADE as options of one setting:

- Settings → SOUND → **TRANSITION** (ПЕРЕХОД), a menu like QUALITY's: **OFF** (back to back, gapless — the default),
  **AUTOMIX**, **CROSSFADE**. Only under CROSSFADE is its **LENGTH** slider shown (1–15 s, 5 by default), kept while
  another is picked. Each has its own hint. Unavailable for Spotify, as before.
- `settings.txt`: the second line holds the crossfade's seconds only while CROSSFADE is picked (else 0 — what the Java
  app reads); a 27th line holds the transition and the kept seconds (`AUTOMIX 7`). A file without it: CROSSFADE if its
  second line had seconds, else OFF (`1`, the first AUTOMIX build's line, reads as AUTOMIX).
- Help/FAQ mention AUTOMIX where they mention crossfade. Strings go through `t()` and into `ru.json`.

## Testing

- `automix.test.mjs`: `edges` on synthetic signals — a tone padded with silence (start/end found to ±50 ms), a 5-s
  linear fade-out (`fadeStart` ≈ its start), a dead stop (`fadeStart = end`), a quiet-then-loud intro (`introRise`), all
  silence; `mixPlan` — an ending, a dead stop, the 10-s cap, the one-third cap for short songs, `fadeIn` for a loud and a
  fading-in opening; `mixKind` — every row of the table above (album continues by track, by disc + 1, by folder; cue run-on;
  shuffle across albums; REPEAT ALL wrap; Spotify; CD; REPEAT ONE; AUTOMIX off with and without CROSSFADE).
- `audio-element-deck.test.mjs`: `prepare` with `startAt`; `armMix` starts the standby when the deck reaches `at`,
  schedules the gain and filter curves, calls `onAdvance` once, keeps the old deck as `fadingOut` and disposes it after
  the overlap; a manual load mid-mix cuts the old deck off.
- Store: the AUTOMIX line round-trips; an older settings file reads as off.
- By hand, in the app (isolated `CDPLAYER_HOME`): AUTOMIX off sounds exactly as before; on,
  across shuffled songs with long silent tails, fade-outs and dead stops; an album in order still gapless (the seam
  measured as in the gapless design); skip / seek / pause during a mix; LOSSLESS with a rate change falls back without
  silence or errors; Spotify shows the row unavailable.
