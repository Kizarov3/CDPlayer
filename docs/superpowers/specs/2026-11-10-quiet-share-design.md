# Quiet share cards and videos — design

## Why

The Now Playing card (P) and its videos are what people send friends. The user posts them to a Telegram channel and
in DMs, and wants them "nonchalant and tuff": something friends don't cringe at. Two outside reviews of the current set
agreed with the user:

- **Cards:** props do the talking (screws, tape, a planet ring, snow, a synthwave grid, ADMIT ONE, katakana rain), a
  shouty NOW PLAYING label, quotes in curly marks and italics with a coloured bar, a muddy glow behind the words. BLUE's
  disc covers the cover so the title reads "NIGHT DRNIGHT DRIVE", TERMINAL tints the cover green, and ALBUM and CASE
  are the same card. At 1200×630, a link-preview shape, a card shows up small in Telegram.
- **Videos:** the picture moves forward and then back: ALBUM's zoom settles back then pushes in while the title rises
  with it, VISUALIZER pumps the cover and the line on every kick, and LYRICS bounces each line and pops each word.
  Intros run long: TERMINAL boots for about 2.2 s from a nearly black first frame (the chat's thumbnail), and JEWEL
  CASE swings its lid and slides its page for about 1.7 s.

## Decisions (the user's)

- **Three quiet bases**, picked from mockups (`.superpowers/brainstorm/14802-1794335133/content/share-directions.html`
  and `share-looks.html`), all three liked:
  - **A, quiet:** the art big, the title and the artist under it in one face.
  - **B, the line:** the lyric big, the art small at the bottom with the title and the artist.
  - **C, full frame:** the cover edge to edge, a small caption over a soft fade at the bottom.
- **Each PLAYER LOOK its own card on one base, adding the one thing it has in the player:**

  | Look | Base | Its one thing |
  |---|---|---|
  | CLASSIC | A | the CD itself, the cover printed on it (not a square cover) |
  | JEWEL CASE | A | the cover in a real jewel case |
  | VISUALIZER | A | a thin strip of bars under the cover |
  | HI-FI | A | a strip of the deck's display under the cover (track, time); no screws, no metal |
  | ALBUM | C | the cover full frame |
  | LYRICS | B | the line big; the small art is a small CD |
  | TERMINAL | B | monospace, like a command's output; the cover in its own colours, no green, no rain |

- **WHITE:** any look's card in the light theme is the same card on warm paper with dark ink.
- **Videos:** each look's video is its card, with one thing moving.
- **"We make CDPlayer": discs, or disc formats, belong in it.** Not on every card, but no vinyl.
  - A square sleeve with a disc sliding out of it reads as vinyl, so CLASSIC's disc is the hero, not tucked behind a cover.
  - Disc cues are the CD with its hub and hole, the jewel case, a CD player's display (TRK 03, the time) and track numbers.

## How it looks

### The card

- **Size:** 1080×1350 (4:5, which Telegram shows big, in a channel and a DM). The year card (THE YEAR ON THE SHELF)
  stays as it is.
- **Margins** about 84 px. Square corners on the cover, at most a soft short shadow.
- **One face**, the player's (`FONT`), except TERMINAL's monospace.
  - Title about 46 px, semi-bold, full ink.
  - Artist the same size at about 55 % opacity.
  - "Album · Year" about 24 px at about 38 %.
  - Sentence case as tagged. No NOW PLAYING label.
- **The quote** (the lines picked in the panel, up to ten as today):
  - upright, no quotation marks, no bar;
  - the first line full ink and any others a step fainter;
  - "…" where lines were skipped, as today.
  - On base A it goes under the names, and the art shrinks to make room for longer quotes. On B it is the big thing.
- **Background:**
  - dark themes: the theme's background with a little of the cover's own colour, darkened;
  - light themes: warm paper;
  - a theme image, where the theme has one: under it, heavily dimmed;
  - a faint mono grain (same grain for the same song). No glows, no accent-coloured decoration.
  - The built-in colour themes no longer have cards of their own (ticket, snow, planet…). A theme only colours the
    look's card.
- **Credit:** `cdplayer`, lower-case, small, faint, in a corner.
- **No cover:** the silver CD-R written on in marker, as today.

### Per look (card)

- **CLASSIC:** a CD, round, the cover printed on it as the player draws its disc. It has:
  - the clear ring and the hole at the hub, the bit of background showing through the hole;
  - a thin bright rim;
  - a faint rainbow sheen.
  The names sit under it.
- **JEWEL CASE:** a jewel case seen from the front, lying on the theme's surface. It has:
  - the cover behind the clear lid;
  - the ribbed hinge strip down the left;
  - one soft diagonal glare.
  The names sit under it.
- **VISUALIZER:** the cover with, under it, one thin strip of bars from the song's own waveform where the player has it.
  The part played so far is full ink and the rest faint, like a quiet seek bar; with no waveform, quiet even bars.
- **HI-FI:** the cover with, under it, a strip of the deck's display: the LCD look on WHITE, the VFD/dot look on dark
  themes, as the player draws it. It shows `TRK 03` and the time into the song; where the track or time isn't known,
  only what is.
- **ALBUM:** the cover full frame (cropped square-to-4:5 from the middle), a soft fade at the bottom, the names over it in
  light ink (dark ink on WHITE only if the fade is light).
- **LYRICS:** the picked line(s) big at the top, about 64 px for one line, smaller as more are picked. At the bottom: a
  small CD (the cover printed on it), the title and the artist, and the track and time in small monospace. With no line
  picked, the title takes the big place.
- **TERMINAL:** monospace, terminal paper (dark; light on WHITE, as TERMINAL does). It shows:
  - a faint `$ cdplayer now` prompt;
  - the line(s) as typed output with a block cursor;
  - at the bottom, the cover small in its true colours, then `title — artist`, `album (year)`, `03 · 1:42 / 3:12`.

### The videos (9:16 1080×1920 and 1:1 1080×1080)

Rules, for every look:

- **Frame 0 is the finished picture.** No intro: no case opening, no typing of the screen, no disc sliding out, no boot.
  Frame 0 is what a chat shows as the thumbnail.
- **One thing moves.** The camera is locked; ALBUM alone has one slow push in one direction. No settle, no overshoot,
  no sine drift, and never two scale moves on one thing.
- **The music moves only small things:** bars, a display's dots, a meter. Never the cover or the words.
- **Lines come in softly:** an opacity fade with a rise of at most about 12 px, 250–400 ms, ease-out. The sung words
  light by colour/opacity. A line leaves with a quicker fade, with no sweep, no scaling, no bounce and no per-word pop.

Per look:

- **CLASSIC:** the CD turning slowly (the disc the player draws, `song.face`), the lines under the names.
- **JEWEL CASE:** the case open from frame 0, the disc turning in its tray, the lines below. No lid swing, no camera move,
  no page sliding in.
- **VISUALIZER:** the cover still, the strip under it moving with the spectrum, the lines below.
- **HI-FI:** the cover with the display strip under it; the line lit in the display's dots as it's sung (as HI-FI's film
  does now), the strip's level marks on the real levels. No push.
- **ALBUM:** the cover full frame with one linear push of at most 3 % over the clip, one way, the lines at the bottom.
- **LYRICS:** base B. The words light as they're sung, and lines crossfade. The small CD stays still.
- **TERMINAL:** the screen fully drawn at frame 0; only the line types itself behind the cursor as it's sung.
- **WHITE:** every film on paper with dark ink, soft grey shadows (as the light stages do now).

## Non-goals

- No new sizes or buttons in the panel: still copy/save the card, VIDEO 9:16 and VIDEO 1:1.
- The year card, the SHELFIE picture and the booklet are unchanged.
- No vinyl anywhere.

## Anti-goals

- Props and costume: screws, tape, stickers, snow, stars, grids, tickets, rain, spotlights, fake buttons or progress
  handles.
- Shouty labels, quotation marks, italics, accent bars, glows.
- Anything that wobbles, pumps or comes back where it came from; an intro before the words.
- Looks that end up the same card again (ALBUM ≠ JEWEL CASE).

## Verification

- A harness renders every look's card in RED and WHITE plus a few other themes, and a contact sheet of each film's
  frames over 8 s in both formats. They are checked by eye: no props, frame 0 finished, nothing reversing.
- The existing tests are kept where they still apply:
  - layout inside the frame and not overlapping;
  - the quote fitting at ten lines;
  - soft shadows on every film, dark and light.
- Tests are updated where the layout changed (the jewel-case layout test).

## Left to the builder (my calls)

- Exact sizes, opacities, grain strength, the tint mix.
- How the CD and the case are drawn (reusing the films' disc and case drawing where it helps).
- Passing `track`, `position`, `duration` and `waveform` to the card from `app.js` for HI-FI, VISUALIZER, LYRICS and
  TERMINAL.
- The panel preview's size for the 4:5 card.
- Removing the code the old theme cards and films no longer use.
