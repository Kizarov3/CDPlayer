# WHITE PLASTIC — a light theme — design

## Goal

CDPlayer has only ever been dark. The AppImage catalog (appimage.github.io PR #11083) asks that an app start light
when the system isn't set to dark, and its test withholds `screenshot-ok` (so the PR can't auto-merge) when the window
is mostly dark. Beyond the catalog, a light player is a look of its own: a glossy white portable player, not today's
deck with its colours inverted.

## Decisions (the user's)

- **Direction C, "WHITE PLASTIC"**, picked from three mockups (DAYLIGHT, SILVER, WHITE PLASTIC): glossy white body,
  soft shadows instead of dark edges, round white keys, a backlit **grey-green LCD with dark digits** for the deck
  display, a warm red-orange accent. Mockup: `.superpowers/brainstorm/2724-1794293814/content/light-looks-v2.html`
  (card C). Rough reference values from it: body `#fbfbfc`→`#eef0f2`, text `#2a2c30`, muted `#8b8f96`, accent `#e0442e`,
  LCD `#b9c6b2` with digits `#1f2a1c`, key shadow `0 2px 6px rgba(0,0,0,.10)`.
- **A colour theme, not a look.** It joins RED, BLUE, SUNSET… in the theme list; every look keeps its layout.
- **Everywhere**: every screen and every look goes white with it: CLASSIC, VISUALIZER, LYRICS, HIFI, ALBUM, CASE,
  TERMINAL, and the shelf, history, settings, CD VIEW, Spotify, booklet, guide/help/tour, What's New, dialogs and
  menus, mini mode.
- **Picked on first launch on every OS**: with no settings yet (a new install), the system's light/dark preference
  decides, light gives WHITE PLASTIC, dark gives RED. After that it is an ordinary saved theme, changed in Settings like
  any other. Existing users keep their theme; nothing changes for them.

## How it works

### Light themes in general

Today a theme is six colours (`bg card accent accent2 text muted`, `theme.js`), but the dark *material* (the backdrop
gradient, shadows, glass, key faces, panel fills, scrims, `#000`/`#111`/`rgba(0,0,0,…)`) is hard-coded in about 150
places in `styles.css`, plus canvases (the disc's shadow and shine, the visualizer, VU meters, the VFD/deck display,
TERMINAL's character grid, share cards).

- A theme is **light** when its `bg` is light (relative luminance above a threshold). This is computed, not a flag, so
  a light theme someone makes in the theme editor gets the light material too. *(My call.)*
- When the theme shown is light, the root gets a marker (e.g. `html.light`) and the hard-coded dark material becomes
  variables with a dark default and a light value: surfaces, edges, shadows, scrims, glass, key faces. The dark themes
  must look exactly as they do today: a pixel-level non-change for RED, BLUE, etc. is the safety line.
- Canvases read the same "is light" from `colors` (they already redraw on `onColorsChanged`).
- Theme changes still animate (`setColors`); the light/dark material switch may simply cross-fade or jump at the
  midpoint, whichever looks less broken. *(Builder's call.)*

### WHITE PLASTIC itself

- A built-in palette added to `THEMES` (before AUTO). Display name **WHITE**, short like the others; saved as `WHITE`
  on line 5 of `settings.txt`. *(My call; "WHITE PLASTIC" was the mockup's name.)*
- The deck display (DECK and VFD) becomes the grey-green LCD with dark, un-glowing digits. Other themes' displays stay.
- TERMINAL becomes dark characters on a white "paper" screen, in the theme's colours, the way it already follows a theme.
- The disc and cover art are untouched; only the player around them goes light. The disc's drop shadow becomes a soft
  grey one, not black.
- AUTO stays a dark theme derived from the cover (unchanged).

### First launch

- First launch = `settings.txt` doesn't exist in the data folder (honour the existing data-folder resolution in
  `store.js`).
- `main.js:60` forces `nativeTheme.themeSource = 'dark'`. Read `nativeTheme.shouldUseDarkColors` **before** that line
  (with `themeSource` still `'system'`), and use it only to pick the initial theme. On Linux Electron reads the GTK
  theme / portal colour scheme; the AppImage test machine has none, so it gets light.
- Then set `themeSource` from the theme actually shown: `'light'` for a light theme, `'dark'` otherwise, and update it
  when the theme changes, so native menus, scrollbars, dialogs and the macOS/Windows title bar match.
- Later system theme changes do **not** switch the player; the choice is made once. *(My call.)*

### Also follows the theme

- The phone remote already takes the player's theme colours: it must work with a light theme.
- Mini mode (`mini.css`), share cards/videos (`share-card.js`, `share-video.js`), the jewel case/booklet pages (already
  light paper, so they should keep reading right on a light backdrop).

## Non-goals

- No light version of AUTO, no light variants of the other built-in themes.
- No "follow system theme" setting that keeps switching.
- No redesign of layouts; nothing moves.

## Anti-goals

- Any visible change to the dark themes.
- Washed-out, low-contrast text: muted text and the LCD digits must stay readable (aim for WCAG AA on body text).
- Leftover black patches: a dark scrim, shadow or panel showing up in some corner of a light screen is the most likely
  failure. Every screen and look gets checked by eye in WHITE.
- Existing users waking up to a white player.

## Verification

- Unit tests for: light detection from a palette; first-launch theme choice (no `settings.txt` + light → `WHITE`, dark →
  `RED`; existing `settings.txt` → its theme kept). Tests use `-Duser.home`-style isolation: a fake home/data dir, never
  the real one.
- Screenshots of every look and every screen in WHITE and in RED, before and after, RED compared for no change.
- Run the AppImage catalog's dark check (`code/check-screenshot.sh` in AppImage/appimage.github.io: at least 60 % of a
  downscaled grey copy darker than 35 % grey, mean below 35 %) on a first-launch screenshot: it must pass.

## Left to the builder

The exact colour values (start from the mockup's), variable names, how the shadows and gloss are drawn, and the order in
which screens are converted.
