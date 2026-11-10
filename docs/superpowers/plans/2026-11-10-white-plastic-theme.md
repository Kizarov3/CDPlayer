# WHITE PLASTIC Light Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A built-in light theme, WHITE, that turns every screen and look into a glossy white player, picked on a new install when the system is light.

**Architecture:** A theme is "light" when its `bg` is light (computed in `theme.js`). The renderer puts `html.light` on the root for a light theme; the dark material hard-coded in `styles.css`/`mini.css`/`remote.css` becomes CSS variables whose `:root` defaults are today's exact values and whose `html.light` values are the white plastic. Canvases ask `theme.js` whether the shown theme is light. The main process picks the first theme from the system preference when `settings.txt` doesn't exist, and keeps `nativeTheme.themeSource` in step with the theme shown.

**Tech Stack:** Electron (castLabs 44), plain ES modules in the renderer, CommonJS in main, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-10-white-plastic-theme-design.md`

## Global Constraints

- Theme name `WHITE`, saved as `WHITE` on line 5 of `settings.txt`; Russian `"WHITE|theme": "БЕЛАЯ"` (like `"RED|theme": "КРАСНАЯ"`).
- WHITE palette (`bg card accent accent2 text muted`): `[251,251,252] [255,255,255] [224,68,46] [139,143,150] [42,44,48] [139,143,150]`; placed in `THEMES` right before AUTO.
- Mockup reference values: body `#fbfbfc`→`#eef0f2`, LCD `#b9c6b2`, LCD digits `#1f2a1c` (no glow), key shadow `0 2px 6px rgba(0,0,0,.10), 0 0 0 1px rgba(0,0,0,.04)`.
- Light = relative luminance of `bg` > `0.5` (use `theme.js`'s existing `luminance`).
- Dark themes must not change: every `:root` default equals the value it replaces, character for character.
- First launch only: no `settings.txt` → system light gives `WHITE`, dark gives `RED`. Existing `settings.txt` is never overridden. No following later system changes.
- AUTO stays dark; no other theme gets a light variant; no layout moves.
- Body text contrast ≥ 4.5:1 on its background in WHITE (check `text` and `muted` on `bg` and on `card`; `muted` may be darkened from the mockup to reach it).
- Tests never touch a real `~/.cdplayer`: set `process.env.CDPLAYER_HOME` to a `fs.mkdtempSync` dir before requiring `store` (see `test/edge-store.test.js`).
- Commits: no AI attribution lines (user's rule). Nothing is pushed.

## Review Focus

- **A theme switch in the middle of the colour animation** (WHITE → RED while `setColors` is animating): no frame where light material sits on dark colours long enough to flash; the class follows the *target* theme. Test in Task 2.
- **A light theme made in the theme editor** (bg e.g. `[240,236,228]`): gets the light material too, and the editor's live preview switches material as the bg slider crosses the threshold. Test in Task 2.
- **The mini window and the phone remote** while WHITE is on: both follow (`mini.css`, `remote.css`); the remote gets the flag over its existing state channel. Covered in Tasks 6 and 7 by screenshot.
- **First launch with `settings.txt` present but short** (the Java app's 3-line file, no theme line): it is *not* a first launch; keep `RED` (the default) — never re-pick. Test in Task 3.
- **Cover glow / theme background image on WHITE** (`#backdrop.has-art`, `has-theme-image`): the blurred wash must be lightened (a white veil) rather than the dark veil, so the screen stays light enough for the catalog check. Covered in Task 4 shots with a cover loaded.

---

### Task 1: Theme screenshots tool and the RED baseline

Before any look changes, a way to capture every look and screen, so RED can be proven unchanged and WHITE judged by eye.

**Files:**
- Create: `src/main/theme-shots.js`
- Modify: `src/main/main.js` (a `--theme-shots=<outdir>` switch next to `--smoke-test=`, same isolation: temp `CDPLAYER_HOME`)
- Create: `test/theme-shots.test.js` (only the pure parts)

**Interfaces:**
- Produces: `node_modules/.bin/electron . --theme-shots=<outdir> [--themes=RED,WHITE] [--audio=<folder>]` writes `<outdir>/<THEME>/<screen>.png` and exits 0.
- Produces (pure, in `theme-shots.js`): `darkCheck(gray: Uint8Array, w, h) -> { dark: boolean, darkShare: number, mean: number }` — the AppImage catalog's rule on a grey copy downscaled to ≤ 200 px wide: `dark = darkShare >= 0.60 && mean < 0.35`, a pixel being dark when `< 0.35 * 255`.
- Produces: `diffShare(a: Buffer, b: Buffer) -> number` — share of pixels whose RGBA differ by more than 8 in any channel (for the RED before/after check).

- [ ] **Step 1: Write the failing tests** in `test/theme-shots.test.js`: `darkCheck` on an all-black 10×10 → `dark: true, darkShare: 1`; all `#fbfbfc` → `dark: false`; 50 % black / 50 % white → `dark: false` (share 0.5). `diffShare` of identical buffers → 0; one pixel of 4 changed by 20 → 0.25; changed by 5 → 0.
- [ ] **Step 2: Run** `node --test test/theme-shots.test.js` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `darkCheck`, `diffShare` and the capture run. Settings for the run are written to the temp `settings.txt` with animations off (line 4 `0`) and the theme on line 5; the screens, each opened through `win.webContents.executeJavaScript` clicking the same buttons a person would: every look in `LOOKS` (`CLASSIC VISUALIZER LYRICS HIFI ALBUM CASE TERMINAL`), then on CLASSIC: SHELF, a case pulled out, HISTORY, SETTINGS, CD VIEW, EQ, LYRICS, KARAOKE, TAGS, the theme menu, ? ALL KEYS, What's New, a booklet; then mini mode. With `--audio`, the first file is loaded so cover art, disc and glow appear. Each shot via `win.webContents.capturePage()` after two animation frames + 300 ms. Also write `<outdir>/<THEME>/darkcheck.json` with `darkCheck` of the first CLASSIC shot.
- [ ] **Step 4: Run** the tests — Expected: PASS. Run `npx electron . --theme-shots=$CLAUDE_JOB_DIR/tmp/shots-before --themes=RED --audio=<a test album folder>` — Expected: exit 0, ≈ 25 PNGs, opened and looked at once to see each screen really opened.
- [ ] **Step 5: Commit** `src/main/theme-shots.js src/main/main.js test/theme-shots.test.js`. Keep `shots-before/` outside the repo.

### Task 2: Light themes in `theme.js`, the WHITE palette

**Files:**
- Modify: `src/renderer/js/theme.js:5-17` (WHITE before AUTO), add exports
- Modify: `src/main/user-themes.js:12` (`BUILTIN` gains `'WHITE'` before `'AUTO'`)
- Modify: `src/locales/ru.json` (`"WHITE|theme": "БЕЛАЯ"`, alphabetical position)
- Create: `test/light-theme.test.mjs`

**Interfaces:**
- Produces: `export function isLight(bg: number[3]) -> boolean` (luminance > 0.5); `export const shown = { light: false }` — set by `setColors(target, …)` to `isLight(target.bg)` at the *start* of a transition, before any frame; `onColorsChanged` listeners fire then too.

- [ ] **Step 1: Write the failing tests**: `isLight([251,251,252])` true; `isLight([17,17,19])` false; every built-in except WHITE → false; `THEMES.at(-2).name === 'WHITE'` and `THEMES.at(-1).name === 'AUTO'`; WHITE `text` and `muted` each have `contrast(…, bg) >= 4.5` and `contrast(…, card) >= 4.5`; a user theme `fromFile({ name:'PAPER', colors:{ bg:[240,236,228], … } })` → `isLight(t.bg)` true; after `setColors(WHITE, true)` then immediately `setColors(RED, true)`, `shown.light === false` with no frame run in between.
- [ ] **Step 2: Run** `node --test test/light-theme.test.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** (darken `muted` from `[139,143,150]` only as far as the contrast test needs; record the final value in the palette).
- [ ] **Step 4: Run** `npm test` — Expected: all PASS (`user-themes.test.js` included: a user can't name a theme WHITE).
- [ ] **Step 5: Commit.**

### Task 3: First launch picks the theme; native theme follows

**Files:**
- Create: `src/main/first-theme.js`
- Modify: `src/main/main.js:59-60` (remove the fixed `'dark'`), `:95` (first-launch pick), IPC `ui:setNativeLight`
- Modify: `src/preload.js` (expose `setNativeLight`)
- Create: `test/first-theme.test.js`

**Interfaces:**
- Produces: `initialTheme({ hasSettings: boolean, systemDark: boolean }) -> 'WHITE' | 'RED' | null` (`null` = keep what was read).
- Produces: renderer API `window.cdp.setNativeLight(light: boolean)` → main sets `nativeTheme.themeSource = light ? 'light' : 'dark'`.

- [ ] **Step 1: Write the failing tests**: `initialTheme({hasSettings:false, systemDark:false}) === 'WHITE'`; `{false,true} → 'RED'`; `{true,false} → null`; `{true,true} → null`. With a temp `CDPLAYER_HOME`: no `settings.txt` → `store.isFile(store.file(store.FILES.settings))` false; a 3-line `settings.txt` (`100\n0\n0\n`) → true and `readSettings().theme === 'RED'`.
- [ ] **Step 2: Run** `node --test test/first-theme.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.** In `main.js`, note `hasSettings` before `store.readSettings()`; read `nativeTheme.shouldUseDarkColors` inside `app.whenReady()` before the main window is created (Linux reads GTK/portal only once ready), apply `initialTheme`, then set `themeSource` from the chosen theme (`WHITE` → `'light'`; any other name → `'dark'` until the renderer reports). Until ready, set `themeSource = 'dark'` only if `hasSettings`, else leave `'system'` so the read is honest. Update the comment at line 59.
- [ ] **Step 4: Run** `npm test` — Expected: PASS. Run the app with an empty temp `CDPLAYER_HOME` on macOS in light mode: it opens with theme WHITE selected in Settings; restart: still WHITE; switch macOS to dark, restart: still WHITE.
- [ ] **Step 5: Commit.**

### Task 4: The renderer switches material; main screen and looks in white

**Files:**
- Modify: `src/renderer/js/app.js` `showTheme` (~2536): `document.documentElement.classList.toggle('light', isLight(theme.bg))`; `window.cdp.setNativeLight(…)`
- Modify: `src/renderer/styles.css:1-800` (`:root` variables; backdrop, main layout, looks, buttons, scrollbars), `body { background: #111113 }` included

**Interfaces:**
- Consumes: `isLight`, `shown` (Task 2); `setNativeLight` (Task 3).
- Produces: the `html.light` class and these variables, defined in `:root` with today's values and overridden under `html.light`: `--backdrop-top`, `--backdrop-bottom`, `--surface`, `--surface-edge`, `--shadow`, `--scrim`, `--key-face`, `--key-ink`, `--glass`, `--lcd`, `--lcd-ink`, `--lcd-glow`, `--art-veil`. Tasks 5–7 reuse these names and add their own only for material that fits none of them.

- [ ] **Step 1: Convert** each hard-coded dark value in lines 1–800 to a variable, one section (`/* ---- … ---- */`) at a time. `body[data-theme="RED"] #deck-display` keeps its smoked glass only when not light.
- [ ] **Step 2: Verify RED unchanged:** `--theme-shots=…/shots-after --themes=RED` and `diffShare` against `shots-before` per screen — Expected: 0 for every screen of this task's area (anything above 0.001 is a regression to fix, not to accept).
- [ ] **Step 3: Write the `html.light` values** from the Global Constraints and the mockup (`.superpowers/brainstorm/2724-1794293814/content/light-looks-v2.html`, card C); the deck display (DECK and VFD) becomes the LCD.
- [ ] **Step 4: Shots** `--themes=WHITE --audio=…` — Expected: all 7 looks read as the mockup's card C; no black patches; `darkcheck.json` → `dark: false` with and without a cover loaded.
- [ ] **Step 5: Commit.**

### Task 5: Overlays, panels, shelf, booklet, rip, take-along, mini

**Files:**
- Modify: `src/renderer/styles.css:800-1850`
- Modify: `src/renderer/mini.css`, `src/renderer/js/mini.js` (the mini window toggles `html.light` from the colours it already receives)

**Interfaces:**
- Consumes: the Task 4 variables and `isLight`.

- [ ] **Step 1: Convert** the dark values in lines 800–1850 and `mini.css` to the Task 4 variables (new ones only where none fits; same `:root`-equals-today rule).
- [ ] **Step 2: Verify RED unchanged** — `diffShare` 0 for every overlay/panel/mini screen.
- [ ] **Step 3: Light values**, then WHITE shots of every overlay, the shelf and a pulled-out case, booklet, mini mode — Expected: light everywhere; the jewel-case/booklet paper still reads as paper against the light backdrop (a soft shadow separates them).
- [ ] **Step 4: Commit.**

### Task 6: Canvases

**Files:**
- Modify: `src/renderer/js/disc.js` (drop shadow grey not black when `shown.light`), `deck-display.js` (LCD: dark un-glowing digits), `vu-meters.js`, `visualizer.js`, `particles.js`, `karaoke.js`, `widgets.js`, `shelf.js`, `dock-disc.js`, `look-terminal.js` + `tui.js` (dark characters on white), `theme-editor.js` (preview), `share-card.js` / `share-video.js` (a WHITE card is light)

**Interfaces:**
- Consumes: `shown.light` (Task 2), read in the draw path; redraw on `onColorsChanged` where a cache is keyed on colours (e.g. `look-terminal.js:85` key gains `shown.light`).

- [ ] **Step 1:** For each file, replace hard-coded black/near-black fills, shadows and glows with a light-aware value; RED/dark paths keep their exact current values.
- [ ] **Step 2: Verify RED unchanged** across all screens (`diffShare` 0, disc region included, cover loaded).
- [ ] **Step 3: WHITE shots** of CLASSIC, VISUALIZER, HIFI (VU), TERMINAL, KARAOKE, the shelf, a share card — Expected: no dark halos, TERMINAL reads as dark-on-paper.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 7: The phone remote

**Files:**
- Modify: `src/remote/remote.js` (~167, where colours arrive: toggle `html.light` via `isLight`), `src/remote/remote.css` (same variable approach; `:root` = today)

- [ ] **Step 1:** Implement; the remote already receives `colors` and `theme`.
- [ ] **Step 2: Verify** by opening the remote page in a browser against a running isolated player: RED looks as before (screenshot compare), WHITE is light.
- [ ] **Step 3: Commit.**

### Task 8: Whole-app check

- [ ] **Step 1:** `npm test` — Expected: all PASS.
- [ ] **Step 2:** Full shots, RED vs `shots-before`: every screen `diffShare` 0 (list any non-zero with the reason; only animation noise is acceptable, and then re-shoot).
- [ ] **Step 3:** Full WHITE shots looked at screen by screen against the anti-goals (black patches, washed-out text). First-launch CLASSIC `darkcheck.json` → `dark: false`.
- [ ] **Step 4:** Settings → theme menu: WHITE listed, switching RED ↔ WHITE animates without a flash of the wrong material; the title bar/menus follow on macOS.
- [ ] **Step 5:** Report to the user with WHITE screenshots of every look. No release, tag or push until asked.
