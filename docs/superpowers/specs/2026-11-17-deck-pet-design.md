# BLIP — a pet in the deck's display — design

## Goal

A small Tamagotchi-like creature drawn in dots in the deck's display, that lives off the way you listen and notices
what you do with the player. It should make people want to keep growing it — and so keep coming back to the player —
without ever turning listening into a chore: it can't starve, die, sulk or nag.

Live mock (real CDPlayer screenshots with the pet drawn over them, every state, form and reaction switchable):
`docs/superpowers/specs/2026-11-17-deck-pet-mock/index.html`. Its `<script>` is the reference for the sprites, the
states and the three drawing styles (LED dots, LCD dots, TERMINAL half-blocks).

## How it was decided

The user asked for "a tamagotchi", picked where it lives from two approaches, saw the mock and liked it, and handed
every other product choice to agents ("спроси у агентов"): a game designer, a critic, a v1-scope reviewer, an engineer
and a fresh-eyes reviewer. Where they disagreed, the call below is noted.

### Approaches (where it lives)

1. **In the deck's display (picked by the user).** Drawn in the same dots as the digits, in the empty space between
   the lamps and the time — an easter egg in a 90s hi-fi. Takes no extra room, costs almost nothing.
2. **EGG — its own little window**, an egg-shaped keychain with three buttons and an LCD. Closer to a real
   Tamagotchi, but a second object competing with the player (the Discman mini-player was dropped for this reason),
   unreliable transparent windows on Linux, and a CPU cost.

## The pet

- **Name:** BLIP by default (a dot on a display and a short sound; reads fine as БЛИП). Renameable on its card,
  up to 8 characters, upper case. The name is shown only on the card, never on the display.
- **Off by default.** A setting turns it on. People find it in What's new and in Settings — never an in-app prompt.
- **Where:** a 25×16 dot grid (~2.6 px pitch) in `#deck-display` between the flags and the time, in CLASSIC,
  VISUALIZER, HI-FI and CD VIEW. Dark themes: lit dots in the theme's accent with the digits' glow, unlit dots faintly
  there (as the 88:88 behind the time). WHITE: LCD ink, no glow. TERMINAL: the same bitmap in half-block characters
  (▀▄█) in NOW PLAYING, with a caption `[BLIP · COLLECTOR · DANCING]`. Hidden in LYRICS, ALBUM and (in v1) JEWEL CASE;
  hidden when the display is too narrow.

### Growing

- **Stages by listening hours:** EGG (as soon as it's turned on) → BABY (the first album played start to end, **or**
  1 hour of listening, whichever comes first — so shuffle and streaming listeners hatch too) → KID (10 h) → TEEN
  (30 h) → ADULT (30 days since hatching and 50 h, at the first monthly reading).
- **Monthly molt:** on the 1st of each month the adult form is re-read from the last 30 days, shown as a little
  scene (it trembles, a "?", it flashes in outline, the new form). A reason to look in; nothing is lost by not looking.
- **Habit forms (6):** COLLECTOR (most listening is albums played start to end; holds its own disc), RAVER (25+
  different artists; shades), NIGHT OWL (40%+ of plays 23:00–04:00; ear tufts, saucer eyes, they glow at midnight),
  LOYALIST (one artist 40%+; a heart), EARLY BIRD (40%+ of plays 05:00–09:00; crest and beak), EXPLORER (50+ first
  plays; antenna and backpack). RAVER counts artists only: shuffle use isn't logged.
- **Surprise forms**, never hinted, no "???" silhouettes, no "n/12": v1 has GHOST (found a hidden track) and ECHO (the
  same song exactly a year later). Later: VINYL (10 pre-1980 albums whole), METALHEAD (10 h of Metal/Rock/Punk tags),
  JAZZ CAT (5 jazz/blues albums whole, at night) — later because year and genre tags are often missing.
- **Diary on its card:** hatched (date, album), each form found (date), items earned. Any form found can be chosen to
  show; the chosen one stays until you choose another.
- **Forms and molts use the plays' original timestamps**, so imported history fills the diary honestly and doesn't make
  everyone an EXPLORER the month they import. Listens before the hatch date don't hatch forms instantly; they do count
  toward the growth spurt below.

### Items (for cumulative milestones, never streaks)

v1: CROWN (10 albums whole), GOLD RECORD (one album whole 5 times), HEADPHONES (100 h), SCARF (listened on 7 different
days — not in a row, just 7), PARTY HAT (worn by itself on its hatch day each year). Later: CAPE (500 h), MEDAL (100
albums whole). The shelf on its card shows only what's been earned — no empty slots. One item worn at a time.

### It reacts to the music

- **Loudness, ~5 times a second while playing:** it bobs (more when it's louder), jumps on a loud peak (at most every
  ~20 s), naps for a second in the silence between tracks (so on gapless albums it stays awake).
- **A snack** for each counted play (mouth opens, a small disc shrinks beside it). **A feast** for an album played
  start to end (a bigger disc, then a happy dance).
- **Its favourite album** (the one most often played start to end) gets its own dance when it plays.
- **Sniffs** an album it has never eaten (no track of it ever played).
- **A rare trick**, about 1 in 25 finished tracks (a somersault).
- **Karaoke** mouth moving with the words — later (needs a hook into karaoke).

### It notices you (the "something is missing" fix)

- **Eyes follow the cursor** while it's over the window.
- **A click is a poke:** it squashes, blinks, looks happy. Three quick pokes: the somersault. **Double-click opens its
  card.**
- **What you do to the deck:** skip → dizzy for a second (eyes become slits, it sways, dots circle its head); seek →
  slides along; volume above ~85% → squeezes its eyes shut, hands over its ears; volume below ~15% → leans toward the
  digits; eject → hops out of the top of the display, comes back when a disc loads and sniffs it.
- **A voice:** a few of its own words for ~2 s in place of the PLAY · PAUSE · SHUFFLE · REPEAT lamps (lighting the
  way a lamp does): YUM, WHOLE THING!, KIND OF BLUE!! (its favourite's name), NEW? SNIFF SNIFF, HELLO! (hatching),
  TA-DA (molt), YAAAWN… HI (waking), A YEAR AGO TODAY: <song> (ECHO). Only in the silence between tracks or on pause,
  at most once every 5 tracks; ~25 fixed words, EN and RU, all about itself, never about you.
- **A temper** seeded per install — sleepy, bouncy, curious or shy — only changes how often it does what it already
  does (dozing, bob size, sniffing, tricks). Shown on the card ("a curious one").

### The first ten minutes

The egg appears the moment the setting is turned on and wobbles to the music; each finished track adds a crack. Someone
with history hatches on their first album through (or hour) with a GROWTH SPURT — baby → kid → teen → adult in a few
flashes — and the items their past listening already earned drop onto the shelf one by one.

### Its card (double-click)

The pet on a strip of display, its name (click to rename), form and day, hatched (date, album), favourite, last meal,
next look (the 1st of next month), temper, the shelf, the diary. No numbers toward anything, no progress bars.

## Rules that hold in every release

- No hunger, no sadness, no death, no streaks, no notifications, no badges, no sounds.
- No counters or progress bars on the display, no "missing" states, nothing about how long you've been away. Asleep
  after a few days without music; it wakes happy, yawns, and shows the last album it ate.
- It never changes what plays and never interrupts the music.
- At most ~8 fps; drawn only while it's visible and music is playing (still pose otherwise); a still pose with
  animations off or reduced motion.

## How it's built (engineer's map)

- **`src/main/pet.js`** — pure module (no electron/fs), like `album-runs.js`/`listens.js`: `empty`/`parse` and
  `evolve(state, stats, now) → { state, events[] }` for stage, form, items, molt, hatch. Kept in memory in `main.js`
  and written on the existing plays debounce. Everything except the name, chosen form, found forms (with dates), hatch
  date/album, earned items and temper is recomputed from history, so it survives backups and imports.
- **Inputs (all already in main):** counted plays and first plays (`plays()`, `playedAt()`, `firstPlayedAt()`),
  timestamped listens (`listened().list`), albums played through (`runsState().through[id].n`; capture `heard()`'s
  `through` in the `plays:add` handler for the feast), hours/artist/genre/year from `yearOnShelf`/the shelf scan
  (recomputed on play, throttled; start after the first shelf scan), new album = first `w.torn` for it, hidden track
  found = hook `hidden:update` with `found`. `plays:add` returns `{ …, pet }` events to the renderer.
- **`src/renderer/js/pet-sprite.js`** — the mock's sprites, `frame(t, {pose, form, item, level, look})`, `drawDots`,
  `drawTerm`, importable in tests. **`pet-view.js`** — the canvas in `#deck-display`, the card, reactions, speech;
  driven from the existing `frame()` loop after its mini-mode/hidden/shelf checks (no timer of its own); loudness from
  `engine.stereo()`/`levels(1)` sampled at the pet's pace.
- **Layout:** `<canvas id="vfd-pet">` between `.vfd-flags` and `.vfd-time`, glow overhanging by negative margin like
  `paint()`; hide below ~420 px of display width; check HI-FI's `grid-area: deck` and CD VIEW's 460 px display.
- **TERMINAL:** `tui.js` `nowPlaying()` draws the half-block rows beside the spectrum when wide enough.
- **Persistence:** `pet: 'pet.json'` in `store.js` FILES (`{version: 1, …}`), added to `backup.js`'s list. Setting =
  a new appended `settings.txt` line (index 33), through `DEFAULT_SETTINGS`, `writeSettings`, the settings snapshot and
  restore, a toggle row in `panels.js`, and `test/state.test.js`.
- **i18n:** every word through `t()`, `npm run i18n -- ru`, fill `src/locales/ru.json`
  (`test/i18n-locales.test.mjs` checks).
- **Tests:** `test/pet.test.js` (evolve: stages, the hatch OR rule, forms from timestamps, molt on the 1st, items,
  imports not hatching forms), `test/pet-sprite.test.mjs` (frames are 25×16, every form/pose draws). Tests set
  `CDPLAYER_HOME` to a temp dir before requiring `store`.
- **Size:** ~1,100–1,400 lines over ~14 files, 4 new.

## v1 and later

- **v1:** the setting; the display, CD VIEW and TERMINAL; all stages and the first ten minutes; the 6 habit forms and
  the molt; GHOST and ECHO; loudness reactions, snack, feast, favourite dance, sniff, trick; the cursor, pokes and the
  deck reactions; its voice; temper; the five v1 items; the card with rename, shelf and diary.
- **Later:** JEWEL CASE pen doodle on the tray insert (in the mock); VINYL, METALHEAD, JAZZ CAT; karaoke mouth; CAPE and
  MEDAL; a still share card of the pet in the share-card style (no counts on it).

## Dropped

STAR and a microphone for karaoke songs (people would sing for the pet, not the song); a nightcap for staying up past
3:00 (rewards no sleep); "???" silhouettes and "5/12" (a to-do list); tempo detection (costly, unreadable at 25×16);
any beeps (break gapless playback); a "home"/the disc drawn in the display (takes the creature's room); anything about
time away.

## Left to the builder

Exact dot art beyond the mock; timings; the exact thresholds' edge cases; the RU words; where precisely the TERMINAL
art sits at narrow widths.
