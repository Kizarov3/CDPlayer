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

`edges(channels, sampleRate)` → `{ duration, start, end, fadeStart, body }` in seconds / dBFS, from the song decoded
mono at a low rate (Sound Check's way: `OfflineAudioContext` at 16 kHz):

- An envelope of 50 ms RMS blocks in dBFS.
- `body`: the song's typical loud level — the median of the loudest half of the blocks.
- `start`: the first block above `body − 40 dB` (and above −60 dBFS), minus 50 ms. `end`: the last such block, plus
  50 ms. Everything outside is silence (or near-silence: room tone, a hiss tail) to skip.
- `fadeStart`: going back from `end`, the earliest time after which the 1-second smoothed level stays below
  `body − 6 dB` to `end` — where the song's ending (a fade-out, a ringing last chord, an outro) begins. Equal to `end`
  when the song stops dead.
- `introRise`: from `start`, the first time the smoothed level reaches `body − 6 dB` (a song that fades in or opens
  quietly has a long one).

`mixPlan(out, inc)` → `{ at, overlap, startAt, fadeIn }` (all seconds; `at` and `startAt` are file times):

- `startAt = inc.start` — the incoming song's own leading silence is skipped.
- The outgoing's tail `tail = out.end − out.fadeStart`:
  - an ending (`tail ≥ 2 s`): `overlap = clamp(tail, 2, 10)`; `at = out.end − overlap` — the next song arrives as this
    one winds down;
  - a dead stop: `overlap = 1`, `at = out.end − 1`, and the outgoing song is **not** faded or filtered — it plays its
    last second at full level to its end (then a 50 ms fade over what's only silence), with the incoming one rising
    under it: no silence, and the final hit or chord isn't softened.
- `overlap` never exceeds a third of either song's audible length (`end − start`) — short songs stay whole.
- `fadeIn`: a song that opens loud (`inc.introRise − inc.start < 2 s`) is brought up over `min(overlap, 3)`; one that
  opens quietly or fades in by itself already arrives gently, so it gets only `min(overlap, 0.5)`.
- So the plan also says how the outgoing goes: `fadeOut` (`true` for an ending, `false` for a dead stop). With it, its
  gain falls 1 → 0 along an equal-power curve from `at` to `at + overlap` and its high-pass glides 20 Hz → 250 Hz over
  the first half of the overlap; without it, it stays as it is until `at + overlap`. The incoming rises 0 → 1 over
  `fadeIn` (equal-power).

Constants (the −40 / −6 dB thresholds, 2 / 10 s, 3 s, 250 Hz) are starting points to tune by ear on real songs.

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

- `settings.txt`: one more line after SHUFFLE/REPEAT: AUTOMIX `1` / `0`, missing → `0`. `DEFAULT_SETTINGS.automix =
  false`. The settings test covers the round trip and old files.
- Settings panel: `row(t('AUTOMIX'), automix)` (a `toggle`) after CROSSFADE, wrapped in `unavailable` for Spotify; a
  hint: "Blends one song into the next where it winds down — no silence between them. Albums played in order stay
  gapless." While on, the CROSSFADE row gets an inactive state (dimmed, no pointer events).
- Help/FAQ and the guide mention AUTOMIX where they mention crossfade. Strings go through `t()` and into `ru.json`
  (`AUTOMIX` → `АВТОМИКС`).

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
