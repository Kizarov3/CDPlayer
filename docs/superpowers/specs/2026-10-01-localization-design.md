# Localization — design

## Goal

CDPlayer's interface in the user's language. Russian ships with it, written and proofread here; any other language
can be added by the community as one file, with a tool that shows what's left to translate.

## Decisions (agreed)

- Languages: the mechanism plus Russian; other languages from the community (C).
- Scope: the whole interface — buttons, statuses, hints, menus, the first-run guide, FAQ, shortcuts, dialogs, the main
  process's dialog titles and menus, and text drawn on canvases (the Now Playing card and video, the booklet's pen, the
  receipt's labels). **Not** translated: the What's New window (changes every release), theme names (RED, OCEAN, and
  themes people name), anything from tags or online sources (song, album, artist names, lyrics), the made-up shop names
  and addresses on receipts.
- Choosing: AUTO (the system's language when there's a file for it, else English) or a language picked in Settings →
  LOOK → LANGUAGE; a change takes effect after a restart (RESTART button).
- Mechanism: the English text is the key.

## Locale files

`src/locales/<code>.json`, e.g. `ru.json`:

```json
{ "_language": "Русский", "_locale": "ru",
  "THEME": "ТЕМА",
  "{n} albums": { "one": "{n} альбом", "few": "{n} альбома", "many": "{n} альбомов", "other": "{n} альбома" } }
```

- Keys starting with `_` are the file's own data: `_language` (the name shown in the LANGUAGE menu, in that language)
  and `_locale` (a BCP-47 tag, used for plural rules).
- Every other key is the English text exactly as in the code. The value is a string, or — for text with `{n}` that
  changes with the number — an object of plural forms named as `Intl.PluralRules(_locale)` names them.
- An empty string, a missing key or a missing plural form → the English text is shown.
- There is no `en.json`: English is the code.

## `t(text, vars)`

- Looks `text` up; a plural object picks the form by `vars.n` with `Intl.PluralRules(_locale).select(n)`, falling back
  to `other`, then to the English text.
- Replaces every `{name}` with `vars.name` (left as is when `vars` has no such key).
- Same behaviour in the renderer (`src/renderer/js/i18n.js`) and the main process (`src/main/i18n.js`); the lookup and
  formatting are one pure function, `format(dict, text, vars)`, in `src/renderer/js/i18n-format.js`, which the main
  process `require`s through a CommonJS twin `src/main/i18n-format.js` exporting the same code (kept identical by a test).

## Loading

- Main: `loadLocale(choice)` — `choice` is the setting (`AUTO`, `en` or a code). AUTO walks
  `app.getPreferredSystemLanguages()` and takes the first whose language part (`ru-RU` → `ru`) has a file. The result
  is `{ code, dict }` (`en` → empty dict). Read once at startup.
- Renderer: `preload.js` exposes `i18nDict()` (`ipcRenderer.sendSync('i18n:dict')`), so `i18n.js` has the dictionary
  at import time — module-level constants (GUIDE, FAQ, SHORTCUTS, hints) can call `t()`. Under node (tests) there's no
  `window.cdp`: English.
- `index.html` and `mini.html`: `data-i18n` marks an element whose own (English) text is translated, `data-i18n-title`
  one whose `title` is — the English stays in the page once, as the key — by `translatePage(document)` before the app
  builds anything.
- `<html lang>` is set to the active code.

## Setting

- `settings.txt` line 18 (index 17): `AUTO` (default), `en`, or a locale code. Unknown values → AUTO.
- Settings → LOOK → **LANGUAGE**: a pill with the current language's name opening a menu: AUTO (with the system
  language it resolves to), ENGLISH, then every locale file's `_language`, sorted. Picking one saves it and shows a hint
  "Takes effect after a restart" with **RESTART** (`app.relaunch()` + `app.exit()` from main, after the queue is saved
  the way it is on quit).
- `listLocales()` (main) → `[{ code, name }]` from the files that parse.

## Converting the code

- Every user-visible string goes through `t()`; strings built by concatenation become templates with `{vars}`
  (`${n} MISSING` → `t('+{n} MISSING', { n })`).
- Error codes the main process sends to the renderer (e.g. `NOT A CDPLAYER THEME`) stay English there and are
  translated where shown: `setStatus(t(r.error))`.
- Canvas text is translated at draw time.
- Strings that are data rather than interface (theme names, MusicBrainz release types used as identifiers, shop
  names) are not wrapped.

## Handwriting

Marker Felt and Bradley Hand have no Cyrillic on macOS. Bundle **Caveat** (SIL OFL 1.1, Cyrillic and Latin) as
`src/renderer/fonts/Caveat.woff2` with its licence, declared with `@font-face` (`font-src` falls under `default-src
'self'`), and put `"Caveat"` right after `"Marker Felt"` in the marker font lists (CSS and `MARKER_FONT` in disc.js and
share-card.js). Latin keeps its look; Cyrillic falls through to Caveat. Canvas text waits for `document.fonts.load` of
Caveat before the first draw that needs it.

## Tooling

`npm run i18n -- <code>` (`scripts/i18n.mjs`):
- collects every `t('…')` / `t("…")` / `` t(`…`) `` without `${` and every `data-i18n` / `data-i18n-title` value
  under `src/`;
- updates `src/locales/<code>.json` (creating it with `_language: ""`, `_locale: <code>`): adds missing keys with `""`,
  removes keys no longer in the code, keeps the rest, writes sorted by key with `_` keys first;
- prints `<code>: <translated>/<total> (<percent>%)`.

`docs/TRANSLATING.md` explains this for contributors; README gets a short "Languages" section linking to it.

## Testing

`test/i18n.test.mjs`:
- `format`: fallback, `{vars}`, missing var left as is, plural forms for ru at 1, 2, 5, 11, 21, 22, and an empty
  string falling back to English.
- The renderer and main `format` files are the same code.
- `ru.json` is complete: every key collected from the code is there with a non-empty value; no key is there that the
  code doesn't use.
- Every translation (all locale files) has the same set of `{…}` names as its key; plural objects use only categories
  `Intl.PluralRules(_locale)` has, and include `other`.
- Untranslated-text check: string literals of two or more upper-case words passed directly to `setStatus(`, `pill(`,
  `title(`, `row(`, `hint(`, `section(` in `src/renderer/js/*.js` fail the test unless listed in the test's allow-list.
- Other locales: coverage printed, never failing.
- `loadLocale`: AUTO picks `ru` for `['ru-RU','en-US']`, English for `['de-DE']` with no `de.json`; an unknown setting
  is AUTO.

By hand: a test profile in Russian; screenshots of every panel (Settings, EQ, Lyrics, Tags, History, Search, Spotify
wizard, Library Check, guide, FAQ, shortcuts, theme editor), the shelf (sort dividers, missing boxes, receipt, notes),
the booklet, the card and video, the mini player and the main window's statuses. Text that doesn't fit is shortened in
the translation first, CSS only when that can't work.

## Out of scope

Right-to-left languages, translating What's New, per-language fonts beyond the handwriting fallback, translating data
from tags or online sources.
