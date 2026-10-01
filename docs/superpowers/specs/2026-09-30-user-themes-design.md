# User themes — design

## Goal

Let people make their own themes — six colors, a scene (visualizer + particles) and an optional background image —
and share them, so a theme can be posted and picked up by someone else. Sharing is the point: a `.cdtheme` file for any
theme, and a one-line `cdtheme:…` code for themes without an image.

## Decisions (agreed)

- Scope C: palette + scene + background image, with export/import.
- A theme's image replaces the album-cover glow in `#backdrop` while that theme is on (AMBIENT BACKGROUND is ignored
  and says "theme's image" under its toggle).
- Sharing: `.cdtheme` file (everything) and a code (no image). A theme with an image has EXPORT… only.
- Storage: one file per theme in `~/.cdplayer/themes/`, the same format as an export.

## The theme

`.cdtheme` is JSON:

```json
{ "cdtheme": 1, "name": "VAPORWAVE",
  "colors": { "bg": [r,g,b], "card": [...], "accent": [...], "accent2": [...], "text": [...], "muted": [...] },
  "scene": "OCEAN", "image": "data:image/jpeg;base64,…" , "blur": 12, "dim": 40 }
```

- `scene`: one of `BARS` (bars, no particles), `SNOW`, `GALAXY`, `OCEAN`, `MATRIX`, `AUTUMN` — the modes of the
  built-in theme with that name.
- `image`: `null` or a data URL `data:image/(jpeg|png|webp);base64,…`. Images put in by the editor are shrunk to at most
  1920 px on the long side and re-encoded as JPEG of at most 1 MB (quality lowered in steps: 0.85, 0.75, 0.65, 0.55);
  if it still doesn't fit — IMAGE TOO BIG. No path to the original is kept.
- `blur` 0–40 (px), `dim` 0–90 (%); only meaningful with an image. Defaults 0 and 30.

`parseTheme(json)` (main) accepts a theme only if: `cdtheme` is 1; `name` is a non-empty string (trimmed, upper-cased,
cut to 16 characters, no `/ \ : * ? " < > |` or control characters); `colors` has all six keys, each exactly three
integers 0–255; `scene` is from the list (missing → `BARS`); `image` is null/missing or a data URL as above and at most
1.5 MB of text; `blur`/`dim` are numbers (clamped; missing → defaults). Unknown fields are dropped. Anything else →
`null`.

## Storage

- `<data dir>/themes/<hash>.cdtheme` (`~/.cdplayer` or `%LOCALAPPDATA%\CDPlayer`, as the store resolves it). The file
  name is the first 16 hex digits of the SHA-1 of the theme's name, so no name can make a bad file name (`CON` on
  Windows, case-insensitive disks); the name itself is read from the file. Files that don't parse are skipped by `list()`.
- A name equal to a built-in theme or an existing user theme gets " 2", " 3"… (`uniqueName`), on save of a new theme
  and on import. Editing an existing theme may keep its own name; renaming removes the old file.
- The chosen theme is still line 5 of settings.txt, by name. At launch it's looked up among built-in and user themes;
  not found → RED.

## Code

`cdtheme:` + base64url of bytes: version `1`, the scene's index in the list, the 18 color values in the order bg, card,
accent, accent2, text, muted, the name's length in bytes, the name in UTF-8, and a checksum byte (the sum of the
others mod 256), so a code changed on the way is refused rather than read as a different theme (about 50 characters; short enough for the 200-character
clipboard read that `clipboard:text` does). `decodeCode` strips
whitespace, checks the prefix, decodes and runs `parseTheme`. `encodeCode` refuses a theme with an image.

## Theme menu (Settings → THEME)

- The ten built-in themes, a divider, the user's themes (swatch = the image's thumbnail when it has one), then
  **+ NEW THEME**, **IMPORT…**, **PASTE CODE**.
- Right-click (or ✎ on hover) a user theme: **EDIT**, **EXPORT…**, **COPY CODE** (no image only), **DELETE** (asks
  first; deleting the theme that's on switches to RED).
- A `.cdtheme` file dropped on the window imports it and switches to it.
- PASTE CODE reads the clipboard; imported/pasted themes are saved and switched to, status `THEME ADDED`.

## Editor

A panel like Settings; the player behind it recolors live.

- **START FROM**: any built-in theme, or **THIS ALBUM** (AUTO's palette from the cover playing).
- Six colors — BACKGROUND, CARDS, ACCENT, ACCENT 2, TEXT, MUTED — each a swatch opening `<input type="color">`, with
  its hex. **HARD TO READ** beside TEXT when TEXT on BACKGROUND has contrast below 4.5:1 (doesn't block SAVE).
- **SCENE**: BARS, SNOW, GALAXY, OCEAN, MATRIX, AUTUMN.
- **IMAGE**: CHOOSE… (or drop an image on the panel), REMOVE; with an image, BLUR and DIM sliders and
  **COLORS FROM IMAGE** (AUTO's derivation run on the image).
- **NAME**, **SAVE**, **CANCEL** (restores the theme that was on before the editor opened).

## Background

`applyBackdrop(theme)` in app.js: with an image, `#backdrop` shows it (cover-fit) with CSS
`filter: blur(<blur>px) brightness(<1 - dim/100>)`, marked as the theme's; without, it falls back to the cover glow
logic in `onCoverChanged`, which leaves the backdrop alone while the theme's image is showing. The Now Playing card and
video draw their background from the theme's image (same blur/dim) when there is one, else the blurred cover as now.

## Code units

- `src/main/user-themes.js` — `parseTheme`, `uniqueName`, `encodeCode`, `decodeCode`, and the store: `list()`,
  `save(theme, oldName?)`, `remove(name)`, `importFile(path)`, `exportFile(name, path)`. IPC `themes:list`, `themes:save`,
  `themes:delete`, `themes:import` (open dialog, or a given path for drops), `themes:export` (save dialog),
  `themes:decode`; preload `cdp.themes.*`.
- `src/renderer/js/theme-editor.js` — the editor panel's contents and `shrinkImage(blob)` (needs the DOM).
- Pure helpers live in `theme.js` so node tests can load them: `contrast(a, b)`, `sceneOf(theme)`, `sceneModes(scene)`,
  `fromFile`/`toFile`, `draftFrom`, `startFrom`, `hex`/`fromHex`, `drawThemeImage`.
- `theme.js` — built-in themes get `scene`; `visualizerModeFor`/`particleModeFor` take a theme (its `scene`);
  `setUserThemes(list)` rebuilds `THEMES` as built-in + user themes (user themes carry `user: true`).
- `app.js` — `switchTheme` applies the backdrop; launch looks the theme up by name; drop of `.cdtheme`; the mini
  player gets its visualizer mode from the theme.
- `panels.js` — the theme menu as above.
- `share-card.js`, `share-video.js` — background from the theme's image.

## Errors

- A file that isn't a theme → status `NOT A CDPLAYER THEME`; a bad code → `THAT CODE ISN'T A THEME`.
- An image that can't be read or made small enough → `IMAGE TOO BIG` / `CAN'T READ THAT IMAGE`; the editor keeps the
  rest.
- A theme file removed from disk while chosen → RED at next launch.

## Testing

- `test/user-themes.test.js`: `parseTheme` on a good theme and each kind of bad input (wrong version, missing color,
  out-of-range value, bad scene, non-data image, oversized image, bad name characters); `uniqueName`; code round trip;
  `encodeCode` refusing an image; `decodeCode` on garbage; store save/list/remove/import/export under a temp `CDPLAYER_HOME`
  (never the real `~/.cdplayer`).
- `test/user-theme-tools.test.mjs`: `contrast` (black/white 21, equal 1), `sceneModes` for every scene, built-in
  scenes, `fromFile`/`toFile` round trip, `setUserThemes`, the built-in names matching `user-themes.js`.
- By hand in a test profile: make a theme with an image → restart → it's on with its background; export and import in a
  second profile; code round trip; the video card with the theme's background.

## Out of scope

Custom fonts, per-theme visualizer settings beyond the six scenes, an online theme gallery.
