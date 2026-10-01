# User Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People make their own themes (six colors, a scene, an optional background image) in an editor, keep them,
and share them as `.cdtheme` files or a short `cdtheme:…` code.

**Architecture:** The main process owns theme files (`src/main/user-themes.js`: parse/validate, unique names, the code,
a one-file-per-theme store) behind `cdp.themes.*` IPC. The renderer appends user themes to `THEMES` (`theme.js`), shows
them through one `showTheme()` path in `app.js` that also paints the theme's image into `#backdrop`, and edits them in a
panel built by `theme-editor.js` with live preview.

**Tech Stack:** Electron 44 (castLabs), CommonJS main, ES-module renderer, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-30-user-themes-design.md`

## Global Constraints

- Theme file: `{ cdtheme: 1, name, colors: { bg, card, accent, accent2, text, muted }, scene, image, blur, dim }`.
- Names: trimmed, upper-cased, ≤ 16 characters, none of `/ \ : * ? " < > |` or control characters.
- Scenes: `BARS`, `SNOW`, `GALAXY`, `OCEAN`, `MATRIX`, `AUTUMN`; missing → `BARS`.
- Image: `null` or `data:image/(jpeg|png|webp);base64,…`, ≤ 1.5 MB of text; the editor makes JPEG ≤ 1920 px, ≤ 1 MB
  (qualities 0.85, 0.75, 0.65, 0.55).
- `blur` 0–40 (default 0), `dim` 0–90 (default 30).
- Files: `<data dir>/themes/<first 16 hex of sha1(name)>.cdtheme`.
- Status texts (exact): `THEME ADDED`, `THEME SAVED`, `THEME DELETED`, `THEME EXPORTED`, `CODE COPIED · PASTE IT IN A CHAT`,
  `NOT A CDPLAYER THEME`, `THAT CODE ISN'T A THEME`, `IMAGE TOO BIG`, `CAN'T READ THAT IMAGE`, `COULDN'T SAVE THE THEME`.
- Tests never touch the real `~/.cdplayer`: set `CDPLAYER_HOME` to a temp dir before requiring main modules.
- Comments: match the codebase — plain sentences saying what something is for, no AI attribution anywhere.
- Commits: no `Co-Authored-By` / "Generated with" lines (user is sole contributor).

## Review Focus

1. A theme whose file was deleted or became unreadable while chosen → next launch shows RED, no crash (Task 2 test:
   `list()` skips a corrupt file; Task 4 launch uses `Math.max(0, findIndex)`).
2. Escape or CANCEL in the editor → the theme that was on before comes back, colors, scene and background (Task 6:
   `onClose` calls `restoreTheme`; manual check listed).
3. A huge or broken image dropped into the editor → status message, the rest of the draft kept (Task 6: `shrinkImage`
   throws `too big` / `unreadable`, mapped to statuses).
4. A pasted code from another app's clipboard garbage, or a code with an altered byte count → `THAT CODE ISN'T A THEME`
   (Task 1 tests: truncated code, bad prefix, bad scene index).
5. Importing a theme named like a built-in or an existing one → kept as `NAME 2` and never overwrites (Task 2 test).

---

### Task 1: Theme files — parse, unique names, the code

**Files:**
- Create: `src/main/user-themes.js`
- Test: `test/user-themes.test.js`

**Interfaces:**
- Produces: `parseTheme(json) → theme|null`, `uniqueName(name, takenNames) → string`, `encodeCode(theme) → string|null`,
  `decodeCode(text) → theme|null`, constants `BUILTIN`, `SCENES`, `COLOR_KEYS` (all exported from
  `src/main/user-themes.js`).

- [ ] **Step 1: Write the failing tests** — `test/user-themes.test.js`:

```js
'use strict';
// Themes people make: the .cdtheme file, its checks, the names they get, and the short code to share one in a chat.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-themes-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const themes = require('../src/main/user-themes');

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const good = () => ({
  cdtheme: 1, name: ' vapor ', scene: 'OCEAN', image: null, blur: 12, dim: 40,
  colors: { bg: [10, 0, 20], card: [20, 10, 30], accent: [255, 0, 170], accent2: [0, 220, 255], text: [250, 240, 255], muted: [150, 140, 170] },
});

test('a good theme comes back cleaned up', () => {
  const t = themes.parseTheme({ ...good(), extra: 'dropped' });
  assert.deepStrictEqual(t, { ...good(), name: 'VAPOR' });
});

test('missing scene, blur and dim get their defaults; out-of-range blur and dim are clamped', () => {
  const { scene, blur, dim, ...rest } = good();
  assert.deepStrictEqual([themes.parseTheme(rest).scene, themes.parseTheme(rest).blur, themes.parseTheme(rest).dim], ['BARS', 0, 30]);
  const t = themes.parseTheme({ ...good(), blur: 99, dim: -5 });
  assert.deepStrictEqual([t.blur, t.dim], [40, 0]);
});

test('anything that is not a theme is refused', () => {
  const bad = [
    null, 'text', { ...good(), cdtheme: 2 }, { ...good(), name: '' }, { ...good(), name: 'A/B' }, { ...good(), name: 'TAB\tHERE' },
    { ...good(), colors: { ...good().colors, muted: undefined } }, { ...good(), colors: { ...good().colors, bg: [0, 0, 256] } },
    { ...good(), colors: { ...good().colors, bg: [0, 0] } }, { ...good(), colors: { ...good().colors, bg: [0, 0, 1.5] } },
    { ...good(), scene: 'DISCO' }, { ...good(), image: 'https://example.com/a.jpg' }, { ...good(), image: 'data:image/gif;base64,AAAA' },
    { ...good(), image: `data:image/jpeg;base64,${'A'.repeat(1.6 * 1024 * 1024)}` },
  ];
  for (const b of bad) assert.strictEqual(themes.parseTheme(b), null, JSON.stringify(b).slice(0, 80));
});

test('a long name is cut to 16 characters', () => {
  assert.strictEqual(themes.parseTheme({ ...good(), name: 'abcdefghijklmnopqrstuvwxyz' }).name, 'ABCDEFGHIJKLMNOP');
});

test('a name already taken, or a built-in one, gets a number', () => {
  assert.strictEqual(themes.uniqueName('VAPOR', []), 'VAPOR');
  assert.strictEqual(themes.uniqueName('RED', []), 'RED 2');
  assert.strictEqual(themes.uniqueName('VAPOR', ['VAPOR', 'VAPOR 2']), 'VAPOR 3');
  assert.strictEqual(themes.uniqueName('ABCDEFGHIJKLMNOP', ['ABCDEFGHIJKLMNOP']), 'ABCDEFGHIJKLMN 2');
});

test('the code: a theme without its image there and back, short enough for the clipboard read', () => {
  const t = themes.parseTheme(good());
  const code = themes.encodeCode(t);
  assert.match(code, /^cdtheme:[A-Za-z0-9_-]+$/);
  assert.ok(code.length < 200, code);
  assert.deepStrictEqual(themes.decodeCode(`  ${code}\n`), { ...t, blur: 0, dim: 30 });
});

test('a theme with an image has no code', () => {
  assert.strictEqual(themes.encodeCode({ ...good(), image: 'data:image/jpeg;base64,AAAA' }), null);
});

test('garbage is not a code', () => {
  const code = themes.encodeCode(themes.parseTheme(good()));
  for (const bad of [null, '', 'hello', 'cdtheme:', 'cdtheme:!!!', code.slice(0, 20), code.replace('cdtheme:', 'theme:'),
    `cdtheme:${Buffer.from([1, 9, ...new Array(18).fill(0), 65]).toString('base64url')}`]) {
    assert.strictEqual(themes.decodeCode(bad), null, String(bad));
  }
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/user-themes.test.js`
Expected: FAIL — `Cannot find module '../src/main/user-themes'`.

- [ ] **Step 3: Write `src/main/user-themes.js`**

```js
'use strict';
/**
 * Themes people make (Settings → THEME → + NEW THEME): six colors, a scene and maybe a background image. Each is kept
 * as one file in the data folder's themes/, in the same .cdtheme format it's shared in — or, without its image, as a
 * short "cdtheme:…" code to paste in a chat. Nothing read from a file or a code is used before parseTheme has checked it.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');

const BUILTIN = ['RED', 'BLUE', 'SUNSET', 'FOREST', 'GALAXY', 'OCEAN', 'MATRIX', 'AUTUMN', 'SNOW', 'AUTO'];
const SCENES = ['BARS', 'SNOW', 'GALAXY', 'OCEAN', 'MATRIX', 'AUTUMN'];
const COLOR_KEYS = ['bg', 'card', 'accent', 'accent2', 'text', 'muted'];
const MAX_IMAGE = 1.5 * 1024 * 1024;
const IMAGE_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
const clamp = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);

function cleanName(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim().toUpperCase().slice(0, 16).trim();
  return n && !/[\\/:*?"<>|\u0000-\u001f\u007f]/.test(n) ? n : null;
}

/** A theme as read from a file or a code → the theme, cleaned up, or null if it isn't one. */
function parseTheme(json) {
  if (!json || typeof json !== 'object' || json.cdtheme !== 1) return null;
  const name = cleanName(json.name);
  if (!name || !json.colors || typeof json.colors !== 'object') return null;
  const colors = {};
  for (const k of COLOR_KEYS) {
    const c = json.colors[k];
    if (!Array.isArray(c) || c.length !== 3 || !c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) return null;
    colors[k] = [...c];
  }
  const scene = json.scene == null ? 'BARS' : json.scene;
  if (!SCENES.includes(scene)) return null;
  const image = json.image == null ? null : json.image;
  if (image !== null && (typeof image !== 'string' || image.length > MAX_IMAGE || !IMAGE_URL.test(image))) return null;
  return { cdtheme: 1, name, colors, scene, image, blur: clamp(json.blur, 0, 40, 0), dim: clamp(json.dim, 0, 90, 30) };
}

/** `name`, or "NAME 2", "NAME 3"… if a built-in theme or one of `taken` already has it (still 16 characters at most). */
function uniqueName(name, taken) {
  const used = new Set([...BUILTIN, ...taken]);
  if (!used.has(name)) return name;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`, candidate = `${name.slice(0, 16 - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

// The code: version, scene, the 18 color values and the name, as bytes in base64url — about 50 characters.
const CODE_PREFIX = 'cdtheme:';
function encodeCode(theme) {
  const t = parseTheme(theme);
  if (!t || t.image) return null;
  const bytes = Buffer.concat([Buffer.from([1, SCENES.indexOf(t.scene)]), Buffer.from(COLOR_KEYS.flatMap((k) => t.colors[k])), Buffer.from(t.name, 'utf8')]);
  return CODE_PREFIX + bytes.toString('base64url');
}
function decodeCode(text) {
  if (typeof text !== 'string') return null;
  const s = text.replace(/\s+/g, '');
  if (!s.toLowerCase().startsWith(CODE_PREFIX)) return null;
  const body = s.slice(CODE_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return null;
  const b = Buffer.from(body, 'base64url');
  if (b.length < 21 || b[0] !== 1 || b[1] >= SCENES.length) return null;
  const colors = Object.fromEntries(COLOR_KEYS.map((k, i) => [k, [...b.subarray(2 + i * 3, 5 + i * 3)]]));
  return parseTheme({ cdtheme: 1, name: b.subarray(20).toString('utf8'), colors, scene: SCENES[b[1]] });
}

module.exports = { BUILTIN, SCENES, COLOR_KEYS, parseTheme, uniqueName, encodeCode, decodeCode };
```

(`fs`, `path`, `crypto`, `store` are used by Task 2's store functions in this same file.)

- [ ] **Step 4: Run the tests**

Run: `node --test test/user-themes.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/user-themes.js test/user-themes.test.js
git commit -m "Theme files: checked when read, a number on a taken name, and a short code for a theme without an image"
```

---

### Task 2: Keeping themes — the store and its IPC

**Files:**
- Modify: `src/main/user-themes.js` (add store functions, extend `module.exports`)
- Modify: `src/main/main.js` (require, `state:load`, `themes:*` handlers — next to `dialog:saveVideo` ~line 239)
- Modify: `src/preload.js` (add `themes` object after `copyText`)
- Test: `test/user-themes.test.js` (append)

**Interfaces:**
- Consumes: `parseTheme`, `uniqueName` (Task 1); `store.dataDir()`.
- Produces: `list() → theme[]` (sorted by name), `save(theme, oldName = null) → theme|null` (name made unique; old file
  removed on rename), `remove(name) → bool`, `importFile(path) → theme|null`, `exportFile(name, target) → bool`.
  IPC/preload: `cdp.themes.list()`, `.save(theme, oldName)`, `.remove(name)`,
  `.importFile(path?) → { theme } | { canceled: true } | { error: 'NOT A CDPLAYER THEME' }`,
  `.exportFile(name) → bool`, `.encode(theme) → string|null`, `.decode(text) → theme|null`.
  `cdp.loadState()` result gains `themes: theme[]`.

- [ ] **Step 1: Append the failing tests**

```js
test('kept: saved, listed by name, renamed, removed', () => {
  const a = themes.save(good());
  assert.strictEqual(a.name, 'VAPOR');
  assert.strictEqual(themes.save({ ...good(), name: 'ACID' }).name, 'ACID');
  assert.deepStrictEqual(themes.list().map((t) => t.name), ['ACID', 'VAPOR']);
  const renamed = themes.save({ ...a, name: 'VAPOR WAVE', dim: 50 }, 'VAPOR');
  assert.strictEqual(renamed.name, 'VAPOR WAVE');
  assert.deepStrictEqual(themes.list().map((t) => [t.name, t.dim]), [['ACID', 40], ['VAPOR WAVE', 50]]);
  assert.strictEqual(themes.save({ ...renamed, blur: 3 }, 'VAPOR WAVE').name, 'VAPOR WAVE'); // editing keeps its own name
  assert.strictEqual(themes.remove('ACID'), true);
  assert.strictEqual(themes.remove('ACID'), false);
  assert.deepStrictEqual(themes.list().map((t) => t.name), ['VAPOR WAVE']);
});

test('a new theme never overwrites another or takes a built-in name', () => {
  assert.strictEqual(themes.save({ ...good(), name: 'VAPOR WAVE' }).name, 'VAPOR WAVE 2');
  assert.strictEqual(themes.save({ ...good(), name: 'snow' }).name, 'SNOW 2');
});

test('a file that is not a theme is skipped, not fatal', () => {
  fs.writeFileSync(path.join(home, 'themes', 'broken.cdtheme'), '{ not json');
  fs.writeFileSync(path.join(home, 'themes', 'other.cdtheme'), JSON.stringify({ cdtheme: 1, name: 'X' }));
  assert.ok(themes.list().every((t) => t.colors));
});

test('exported and imported: the same theme, under a new name if that one is taken', () => {
  const out = path.join(home, 'shared.cdtheme');
  assert.strictEqual(themes.exportFile('VAPOR WAVE', out), true);
  assert.strictEqual(themes.exportFile('NOPE', out), false);
  const imported = themes.importFile(out);
  assert.strictEqual(imported.name, 'VAPOR WAVE 3');
  assert.strictEqual(themes.importFile(path.join(home, 'themes', 'broken.cdtheme')), null);
  assert.strictEqual(themes.importFile(path.join(home, 'missing.cdtheme')), null);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/user-themes.test.js`
Expected: FAIL — `themes.save is not a function`.

- [ ] **Step 3: Add the store to `src/main/user-themes.js`** (before `module.exports`), and export it:

```js
// ---- Where they're kept: <data dir>/themes/, a file per theme named after a hash of its name ----------------------

const MAX_FILE = 4 * 1024 * 1024;
const themesDir = () => path.join(store.dataDir(), 'themes');
const fileFor = (name) => path.join(themesDir(), `${crypto.createHash('sha1').update(name).digest('hex').slice(0, 16)}.cdtheme`);

function readThemeFile(p) {
  try {
    if (fs.statSync(p).size > MAX_FILE) return null;
    return parseTheme(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch { return null; }
}
/** Every theme kept, by name. Files that aren't themes are left out. */
function list() {
  let files;
  try { files = fs.readdirSync(themesDir()).filter((f) => f.endsWith('.cdtheme')); } catch { return []; }
  return files.map((f) => readThemeFile(path.join(themesDir(), f))).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}
/** Keeps a theme — a new one under a name nothing else has, or `oldName` edited (renamed: the old file goes). */
function save(theme, oldName = null) {
  const t = parseTheme(theme);
  if (!t) return null;
  t.name = uniqueName(t.name, list().map((x) => x.name).filter((n) => n !== oldName));
  try {
    fs.mkdirSync(themesDir(), { recursive: true });
    const target = fileFor(t.name), tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(t));
    fs.renameSync(tmp, target);
  } catch { return null; }
  if (oldName && oldName !== t.name) remove(oldName);
  return t;
}
function remove(name) {
  try { fs.unlinkSync(fileFor(name)); return true; } catch { return false; }
}
/** A .cdtheme someone shared → kept (under a new name if needed), or null if it isn't one. */
function importFile(p) {
  const t = readThemeFile(p);
  return t ? save(t) : null;
}
function exportFile(name, target) {
  const t = list().find((x) => x.name === name);
  if (!t) return false;
  try { fs.writeFileSync(target, JSON.stringify(t, null, 1)); return true; } catch { return false; }
}

module.exports = { BUILTIN, SCENES, COLOR_KEYS, parseTheme, uniqueName, encodeCode, decodeCode, list, save, remove, importFile, exportFile };
```

(Replace Task 1's `module.exports` line with this one.)

- [ ] **Step 4: Run the tests**

Run: `node --test test/user-themes.test.js`
Expected: PASS (12 tests).

- [ ] **Step 5: IPC in `src/main/main.js`**

Add `const userThemes = require('./user-themes');` next to `const store = require('./store');` (line 16). In the
`state:load` handler add `themes: userThemes.list(),` after `lastVersion`. After the `dialog:saveCard` handler add:

```js
// Themes people make (user-themes.js): kept, imported from a .cdtheme (chosen, or dropped on the window), exported, and
// turned into or read from the short code.
handle('themes:list', () => userThemes.list());
handle('themes:save', (theme, oldName) => userThemes.save(theme, oldName || null));
handle('themes:delete', (name) => userThemes.remove(name));
handle('themes:import', async (source) => {
  if (typeof source !== 'string') {
    const r = await dialog.showOpenDialog(win, { title: 'Import a Theme', defaultPath: app.getPath('downloads'), properties: ['openFile'], filters: [{ name: 'CDPlayer theme', extensions: ['cdtheme'] }] });
    if (r.canceled || !r.filePaths.length) return { canceled: true };
    source = r.filePaths[0];
  }
  const theme = userThemes.importFile(source);
  return theme ? { theme } : { error: 'NOT A CDPLAYER THEME' };
});
handle('themes:export', async (name) => {
  const safe = String(name || 'Theme').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Theme';
  const r = await dialog.showSaveDialog(win, { title: 'Export the Theme', defaultPath: path.join(app.getPath('documents'), `${safe}.cdtheme`), filters: [{ name: 'CDPlayer theme', extensions: ['cdtheme'] }] });
  if (r.canceled || !r.filePath) return false;
  return userThemes.exportFile(name, /\.cdtheme$/i.test(r.filePath) ? r.filePath : `${r.filePath}.cdtheme`);
});
handle('themes:encode', (theme) => userThemes.encodeCode(theme));
handle('themes:decode', (text) => userThemes.decodeCode(text));
```

- [ ] **Step 6: Preload** — in `src/preload.js`, after `copyText: invoke('clipboard:write'),`:

```js
  themes: {
    list: invoke('themes:list'), save: invoke('themes:save'), remove: invoke('themes:delete'),
    importFile: invoke('themes:import'), exportFile: invoke('themes:export'),
    encode: invoke('themes:encode'), decode: invoke('themes:decode'),
  },
```

- [ ] **Step 7: Full test run, then commit**

Run: `npm test`
Expected: all pass.

```bash
git add src/main/user-themes.js src/main/main.js src/preload.js test/user-themes.test.js
git commit -m "Themes kept one file each in the data folder, with import, export and the code over IPC"
```

---

### Task 3: `theme.js` — user themes in the list, scenes by theme, pure helpers

**Files:**
- Modify: `src/renderer/js/theme.js`
- Modify: `src/renderer/js/app.js:1066-1070` (`applyThemeModes`), `:1076` (its call), `:1239` (`pushMini` visMode)
- Test: `test/user-theme-tools.test.mjs`

**Interfaces:**
- Produces (all exported from `theme.js`):
  `SCENES`, `sceneOf(theme) → scene`, `sceneModes(scene) → { visualizer, particles }`,
  `visualizerModeFor(theme)`, `particleModeFor(theme)` (now take a theme object, not a name),
  `contrast(a, b) → number`, `hex([r,g,b]) → '#rrggbb'`, `fromHex('#rrggbb') → [r,g,b]`,
  `fromFile(file) → theme` (flat, `user: true`), `toFile(theme) → file`,
  `setUserThemes(files)`, `BUILTIN_COUNT`,
  `draftFrom(base, name) → theme` (a fresh editable copy), `startFrom(draft, source, { keepScene })`,
  `drawThemeImage(g, w, h, img, { blur, dim })`.
  A flat theme is `{ name, bg, card, accent, accent2, text, muted, scene?, image?, blur?, dim?, user? }`.

- [ ] **Step 1: Write the failing tests** — `test/user-theme-tools.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import {
  THEMES, BUILTIN_COUNT, SCENES, sceneOf, sceneModes, visualizerModeFor, particleModeFor, contrast, hex, fromHex,
  fromFile, toFile, setUserThemes, draftFrom, startFrom,
} from '../src/renderer/js/theme.js';

const require = createRequire(import.meta.url);
const main = require('../src/main/user-themes.js');

const file = { cdtheme: 1, name: 'VAPOR', scene: 'OCEAN', image: null, blur: 0, dim: 30,
  colors: { bg: [10, 0, 20], card: [20, 10, 30], accent: [255, 0, 170], accent2: [0, 220, 255], text: [250, 240, 255], muted: [150, 140, 170] } };

test('the built-in themes and scenes are the ones the main process knows', () => {
  assert.deepStrictEqual(THEMES.slice(0, BUILTIN_COUNT).map((t) => t.name), main.BUILTIN);
  assert.deepStrictEqual(SCENES, main.SCENES);
});

test('every scene: its visualizer and what falls behind the player', () => {
  assert.deepStrictEqual(SCENES.map(sceneModes), [
    { visualizer: 'BARS', particles: 'NONE' }, { visualizer: 'TREE', particles: 'SNOW' },
    { visualizer: 'CONSTELLATION', particles: 'GALAXY' }, { visualizer: 'WAVES', particles: 'OCEAN' },
    { visualizer: 'MATRIX_RAIN', particles: 'MATRIX' }, { visualizer: 'LEAVES', particles: 'AUTUMN' },
  ]);
});

test('built-in themes keep their scenes; a theme of your own has the one you picked', () => {
  const byName = (n) => THEMES.find((t) => t.name === n);
  assert.deepStrictEqual(['RED', 'SNOW', 'AUTO', 'OCEAN'].map((n) => sceneOf(byName(n))), ['BARS', 'SNOW', 'BARS', 'OCEAN']);
  assert.strictEqual(visualizerModeFor({ name: 'SNOW 2', scene: 'MATRIX' }), 'MATRIX_RAIN');
  assert.strictEqual(particleModeFor({ name: 'MINE', scene: 'BARS' }), 'NONE');
});

test('contrast, as WCAG measures it', () => {
  assert.strictEqual(Math.round(contrast([0, 0, 0], [255, 255, 255])), 21);
  assert.strictEqual(contrast([90, 90, 90], [90, 90, 90]), 1);
  assert.ok(contrast([138, 142, 148], [17, 17, 19]) >= 4.5);
});

test('hex there and back', () => {
  assert.strictEqual(hex([255, 0, 170]), '#ff00aa');
  assert.deepStrictEqual(fromHex('#FF00AA'), [255, 0, 170]);
});

test('a file theme and the list theme are the same theme', () => {
  const t = fromFile(file);
  assert.strictEqual(t.user, true);
  assert.deepStrictEqual(t.accent, [255, 0, 170]);
  assert.deepStrictEqual(toFile(t), file);
});

test('your themes come after the built-in ones, and replace the last lot', () => {
  setUserThemes([file, { ...file, name: 'ACID' }]);
  assert.deepStrictEqual(THEMES.slice(BUILTIN_COUNT).map((t) => t.name), ['VAPOR', 'ACID']);
  setUserThemes([]);
  assert.strictEqual(THEMES.length, BUILTIN_COUNT);
});

test('a draft is a copy to change freely; START FROM takes colors and scene, not the image or name', () => {
  const base = fromFile({ ...file, image: 'data:image/jpeg;base64,AAAA', blur: 5 });
  const d = draftFrom(base, 'MY THEME');
  d.bg[0] = 99;
  assert.strictEqual(base.bg[0], 10);
  assert.deepStrictEqual([d.name, d.image, d.blur, d.scene, d.user], ['MY THEME', base.image, 5, 'OCEAN', true]);
  startFrom(d, THEMES.find((t) => t.name === 'SNOW'));
  assert.deepStrictEqual([d.name, d.image, d.scene, d.accent], ['MY THEME', base.image, 'SNOW', [214, 44, 54]]);
  startFrom(d, THEMES[0], { keepScene: true });
  assert.strictEqual(d.scene, 'SNOW');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/user-theme-tools.test.mjs`
Expected: FAIL — `does not provide an export named 'BUILTIN_COUNT'`.

- [ ] **Step 3: Implement in `theme.js`**

Right after the `const KEYS = …` line add `export const BUILTIN_COUNT = THEMES.length;`.

Replace the two `visualizerModeFor` / `particleModeFor` lines at the end with:

```js
// ---- Scenes: the visualizer's shape and what falls behind the player ----------------------------------------------

export const SCENES = ['BARS', 'SNOW', 'GALAXY', 'OCEAN', 'MATRIX', 'AUTUMN'];
const VISUALIZERS = { BARS: 'BARS', SNOW: 'TREE', GALAXY: 'CONSTELLATION', OCEAN: 'WAVES', MATRIX: 'MATRIX_RAIN', AUTUMN: 'LEAVES' };
export const sceneModes = (scene) => ({ visualizer: VISUALIZERS[scene] || 'BARS', particles: scene in VISUALIZERS && scene !== 'BARS' ? scene : 'NONE' });
/** A theme's scene: the one picked for a theme of your own, the built-in theme's by its name. */
export const sceneOf = (theme) => theme.scene || (SCENES.includes(theme.name) ? theme.name : 'BARS');
export const visualizerModeFor = (theme) => sceneModes(sceneOf(theme)).visualizer;
export const particleModeFor = (theme) => sceneModes(sceneOf(theme)).particles;

// ---- Themes people make (theme-editor.js; kept by the main process's user-themes.js) ------------------------------

const luminance = (c) => {
  const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** How far apart two colors are to read, as WCAG measures it: 1 (the same) to 21 (black on white). */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
export const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
export const fromHex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** A theme file (.cdtheme) → a theme for the list, and back. */
export function fromFile(f) {
  return { name: f.name, ...Object.fromEntries(KEYS.map((k) => [k, [...f.colors[k]]])), scene: f.scene, image: f.image || null, blur: f.blur, dim: f.dim, user: true };
}
export function toFile(t) {
  return { cdtheme: 1, name: t.name, colors: Object.fromEntries(KEYS.map((k) => [k, [...t[k]]])), scene: sceneOf(t), image: t.image || null, blur: t.blur ?? 0, dim: t.dim ?? 30 };
}
/** The list is the built-in themes, then these (files, as the main process keeps them). */
export function setUserThemes(files) { THEMES.splice(BUILTIN_COUNT, Infinity, ...files.map(fromFile)); }

/** A copy of `base` to change in the editor, named `name`. */
export function draftFrom(base, name) {
  return { ...fromFile(toFile(base)), name };
}
/** START FROM: another theme's colors (and its scene, unless `keepScene`) into the draft; its image and name stay. */
export function startFrom(draft, source, { keepScene = false } = {}) {
  for (const k of KEYS) draft[k] = [...source[k]];
  if (!keepScene) draft.scene = sceneOf(source);
}

/** A theme's background image over w×h of a canvas: filling it, blurred and dimmed as the theme says. */
export function drawThemeImage(g, w, h, img, { blur = 0, dim = 30 } = {}) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.max(w / iw, h / ih) * (blur ? 1.08 : 1), dw = iw * s, dh = ih * s;
  g.save();
  if (blur) g.filter = `blur(${Math.round((blur * w) / 1280)}px)`;
  g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  g.restore();
  g.fillStyle = `rgba(0,0,0,${dim / 100})`;
  g.fillRect(0, 0, w, h);
}
```

(`sceneOf` must be defined before `toFile` is called, which it is — all are module-level `const`/`function` used at
call time.)

- [ ] **Step 4: Run the tests**

Run: `node --test test/user-theme-tools.test.mjs`
Expected: PASS (8 tests).

- [ ] **Step 5: Callers in `app.js` pass the theme, not its name**

```js
function applyThemeModes(theme) {
  particles.setMode(particleModeFor(theme));
  visualizer.setMode(visualizerModeFor(theme));
  bigVisualizer.setMode(visualizerModeFor(theme));
  panels.updateThemeButton(app, theme.name);
}
```

In `switchTheme` change `applyThemeModes(theme.name);` to `applyThemeModes(theme);`. In `pushMini` change
`visMode: visualizerModeFor(THEMES[state.themeIndex].name)` to `visMode: visualizerModeFor(THEMES[state.themeIndex])`.
(Task 4 replaces both again with `shownTheme`.)

- [ ] **Step 6: Full tests and a launch check**

Run: `npm test` — all pass. Run the app in a test profile (`CDPLAYER_HOME=$CLAUDE_JOB_DIR/tmp/prof-themes npm start`,
with `lastversion.txt` set to the current version so What's New doesn't block input) and switch SNOW → OCEAN → RED:
scenery changes as before.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/js/theme.js src/renderer/js/app.js test/user-theme-tools.test.mjs
git commit -m "Scenes picked by theme rather than its name, and the pieces themes of your own are made from"
```

---

### Task 4: `app.js` — your themes on screen, the background image, import/paste/export/delete

**Files:**
- Modify: `src/renderer/index.html:10` (backdrop)
- Modify: `src/renderer/styles.css:40-41` (backdrop image rules)
- Modify: `src/renderer/js/app.js` — `onCoverChanged` (~588), `refreshAutoTheme`/`switchTheme` (~1061-1080),
  `pushMini` (~1239), `setupDragAndDrop` (~1471), startup theme lookup (~1641), `app` object (~1573)
- Modify: `src/renderer/js/panels.js` — AMBIENT BACKGROUND hint in `buildSettings`

**Interfaces:**
- Consumes: `cdp.themes.*`, `cdp.clipboardText()`, `cdp.copyText(text)` (Task 2); `setUserThemes`, `toFile`,
  `visualizerModeFor`, `particleModeFor` (Task 3).
- Produces on `app`: `previewTheme(theme)`, `restoreTheme()`, `shownTheme() → theme`,
  `saveTheme(theme, oldName|null) → Promise<file|null>`, `importTheme(path?)`, `pasteThemeCode()`,
  `exportTheme(name)`, `copyThemeCode(theme)`, `deleteTheme(name)`.

- [ ] **Step 1: Backdrop element and CSS**

`index.html`: `<div id="backdrop"><img id="backdrop-theme" alt=""><canvas id="backdrop-art"></canvas></div>`

`styles.css`, after the `#backdrop.has-art #backdrop-art` rule:

```css
/* A theme's own background image (themes people make), blurred and dimmed by the theme; it replaces the cover's glow. */
#backdrop-theme { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 400ms; }
#backdrop.has-theme-image #backdrop-theme { opacity: 1; }
```

- [ ] **Step 2: One way a theme gets on screen**

Import `setUserThemes, toFile` from `./theme.js` in addition to what's there. Split the backdrop half out of
`onCoverChanged` and route every theme change through `showTheme`:

```js
let shownTheme = THEMES[0]; // the theme on screen: the one chosen, or the one being made in the editor
function paintCoverGlow() {
  const backdrop = $('backdrop'), art = $('backdrop-art');
  if (!shownTheme.image && state.ambient && state.cover) {
    // A 48×48 center crop, stretched to fill the window — the browser's bilinear upscale makes it a soft glow.
    art.width = art.height = 48;
    const g = art.getContext('2d');
    const iw = state.cover.naturalWidth, ih = state.cover.naturalHeight, s = Math.min(iw, ih);
    g.drawImage(state.cover, (iw - s) / 2, (ih - s) / 2, s, s, 0, 0, 48, 48);
    art.style.objectFit = 'cover';
    backdrop.classList.add('has-art');
  } else backdrop.classList.remove('has-art');
}
// A theme's own image is the background while it's on, in place of the cover's glow.
function applyBackdrop(theme) {
  const backdrop = $('backdrop'), img = $('backdrop-theme');
  if (theme.image) {
    if (img.getAttribute('src') !== theme.image) img.src = theme.image;
    const blur = theme.blur || 0;
    img.style.filter = `blur(${blur}px) brightness(${1 - (theme.dim ?? 30) / 100})`;
    img.style.transform = blur ? 'scale(1.06)' : ''; // so the blur's soft edge stays off screen
    backdrop.classList.add('has-theme-image');
  } else backdrop.classList.remove('has-theme-image');
}
function onCoverChanged() {
  paintCoverGlow();
  if (shownTheme.name === 'AUTO') { shownTheme = refreshAutoTheme(); setColors(shownTheme, anim.enabled); }
}
function showTheme(theme, animate) {
  const hadImage = !!shownTheme.image;
  shownTheme = theme;
  applyThemeModes(theme);
  applyBackdrop(theme);
  paintCoverGlow();
  setColors(theme, animate);
  if (hadImage !== !!theme.image) panels.refreshSettingsIfOpen(app); // AMBIENT BACKGROUND's note
}
function switchTheme(index, { instant = false } = {}) {
  if (index === state.themeIndex && !instant) return;
  state.themeIndex = index;
  let theme = THEMES[index];
  if (theme.name === 'AUTO') theme = refreshAutoTheme();
  showTheme(theme, anim.enabled && !instant);
  saveSettingsSoon();
}
// The editor's live preview, and putting the chosen theme back when it's cancelled.
const previewTheme = (theme) => showTheme(theme, false);
function restoreTheme() { const i = state.themeIndex; state.themeIndex = -1; switchTheme(i, { instant: true }); }
```

Delete the old `onCoverChanged` and old `switchTheme`. In `pushMini`: `visMode: visualizerModeFor(shownTheme)`.

- [ ] **Step 3: Your themes — kept, added, shared, deleted**

Below `restoreTheme`:

```js
// ---- Themes people make (theme-editor.js; the files are the main process's user-themes.js) ------------------------

// Reads the kept themes into the list again, and puts on `select` (or the theme that was on; RED if it's gone).
async function reloadUserThemes(select = null) {
  const name = select || THEMES[state.themeIndex].name;
  setUserThemes(await cdp.themes.list());
  state.themeIndex = -1;
  switchTheme(Math.max(0, THEMES.findIndex((t) => t.name === name)));
}
async function saveTheme(theme, oldName = null) {
  const saved = await cdp.themes.save(toFile(theme), oldName);
  if (!saved) { setStatus("COULDN'T SAVE THE THEME"); return null; }
  await reloadUserThemes(saved.name);
  setStatus('THEME SAVED');
  return saved;
}
async function importTheme(path = null) {
  const r = await cdp.themes.importFile(path);
  if (r.canceled) return;
  if (r.error) { setStatus(r.error); return; }
  await reloadUserThemes(r.theme.name);
  setStatus('THEME ADDED');
}
async function pasteThemeCode() {
  const theme = await cdp.themes.decode(await cdp.clipboardText());
  if (!theme) { setStatus("THAT CODE ISN'T A THEME"); return; }
  const saved = await cdp.themes.save(theme, null);
  if (!saved) { setStatus("COULDN'T SAVE THE THEME"); return; }
  await reloadUserThemes(saved.name);
  setStatus('THEME ADDED');
}
async function exportTheme(name) { if (await cdp.themes.exportFile(name)) setStatus('THEME EXPORTED'); }
async function copyThemeCode(theme) {
  const code = await cdp.themes.encode(toFile(theme));
  if (!code) return;
  await cdp.copyText(code);
  setStatus('CODE COPIED · PASTE IT IN A CHAT');
}
async function deleteTheme(name) {
  await cdp.themes.remove(name);
  await reloadUserThemes(THEMES[state.themeIndex].name === name ? 'RED' : null);
  setStatus('THEME DELETED');
}
```

Add to the `app` object: `previewTheme, restoreTheme, shownTheme: () => shownTheme, saveTheme, importTheme, pasteThemeCode, exportTheme, copyThemeCode, deleteTheme,`.

- [ ] **Step 4: Startup and drops**

At startup, right before `const themeIndex = Math.max(0, THEMES.findIndex(...))`, add
`setUserThemes(saved.themes || []);`.

In `setupDragAndDrop`'s `drop` handler replace the last line with:

```js
    const isTheme = (p) => /\.cdtheme$/i.test(p);
    for (const p of paths.filter(isTheme)) importTheme(p);
    const songs = paths.filter((p) => !isTheme(p));
    if (songs.length) addToQueue(songs).catch(() => setStatus("COULDN'T LOAD THAT FILE"));
```

- [ ] **Step 5: AMBIENT BACKGROUND's note** — in `panels.js` `buildSettings`, after `row('AMBIENT BACKGROUND', ambient),`:

```js
    app.shownTheme().image ? hint('The theme’s own image is the background while it’s on.') : null,
```

- [ ] **Step 6: Check by hand** (test profile as in Task 3). Put a theme file in `<profile>/themes/` by running in the
DevTools console:
`await cdp.themes.save({cdtheme:1,name:'TEST',colors:{bg:[10,0,20],card:[20,10,30],accent:[255,0,170],accent2:[0,220,255],text:[250,240,255],muted:[150,140,170]},scene:'OCEAN'})`,
then `app`-level reload by restarting. Expect: no visible change until chosen (menu comes in Task 5), and choosing it
from the console with `(await import('./js/app.js')).app.switchTheme(10)` shows its colors and waves. Drop the
exported file onto the window → `THEME ADDED`, `TEST 2` is on. Restart → `TEST 2` still on. Delete its file and
restart → RED.

- [ ] **Step 7: Full tests, commit**

Run: `npm test` — all pass.

```bash
git add src/renderer/index.html src/renderer/styles.css src/renderer/js/app.js src/renderer/js/panels.js
git commit -m "Themes of your own on screen, their image behind the player in place of the cover's glow; a .cdtheme dropped on the window is added"
```

---

### Task 5: The theme menu

**Files:**
- Modify: `src/renderer/js/panels.js` — `showMenu` (~253), `showThemeMenu` (~272), `ESC_ORDER` (line 16)
- Modify: `src/renderer/styles.css` (menu rules ~349-357)

**Interfaces:**
- Consumes: `app.importTheme`, `app.pasteThemeCode`, `app.exportTheme`, `app.copyThemeCode`, `app.deleteTheme` (Task 4);
  `showThemeEditor(app, theme?)` (Task 6 — until then make `+ NEW THEME` and `EDIT` call
  `app.setStatus('COMING UP')`, replaced in Task 6).
- Produces: `showMenu(anchor, items)` where `anchor` is an element or a DOMRect and items may be
  `{ divider: true }` or `{ label, swatch?, current?, pick, more?(rect) }`.

- [ ] **Step 1: `showMenu` — dividers, ✎ / right-click, anchors that may be gone**

```js
/**
 * A small menu under `anchor` (an element, or where one was); items are { label, swatch (CSS background, optional),
 * current, pick, more (optional: ✎ and right-click, given where the item is) } or { divider: true }.
 */
function showMenu(anchor, items) {
  const box = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
  closeMenu();
  const menu = el('div', { class: 'theme-menu' }, items.map((item) => {
    if (item.divider) return el('div', { class: 'menu-divider' });
    const swatch = item.swatch ? el('span', { class: 'swatch' }) : null;
    if (swatch) swatch.style.background = item.swatch;
    const openMore = (e) => { e.preventDefault(); e.stopPropagation(); item.more(node.getBoundingClientRect()); };
    const node = el('div', { class: `theme-item${item.current ? ' current' : ''}`, onClick: () => { closeMenu(); item.pick(); },
      onContextmenu: (e) => { if (item.more) openMore(e); } },
    swatch, el('span', { class: 'grow' }, item.label),
    item.more ? el('span', { class: 'menu-more', title: 'Edit, share or delete', onClick: openMore }, '✎') : null);
    return node;
  }));
  const layerNode = el('div', { class: 'theme-menu-layer', onMousedown: (e) => { if (e.target === layerNode) closeMenu(); } }, menu);
  layer().append(layerNode);
  const m = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(box.left, window.innerWidth - m.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(box.bottom + 6, window.innerHeight - m.height - 4))}px`;
  menuLayer = layerNode;
}
```

(The click now closes before `pick()`, so a pick may open another menu.)

- [ ] **Step 2: The theme menu and a theme's own menu**

```js
const themeSwatch = (t) => (t.image ? `center / cover url("${t.image}")` : `linear-gradient(135deg, rgb(${t.accent}), rgb(${t.accent2}))`);
function showThemeMenu(app) {
  const item = (t) => {
    const i = THEMES.indexOf(t);
    return { label: t.name, swatch: themeSwatch(t), current: i === app.state.themeIndex, pick: () => app.switchTheme(i), more: t.user ? (box) => showThemeActions(app, t, box) : null };
  };
  showMenu(themeButton, [
    ...THEMES.filter((t) => !t.user).map(item),
    { divider: true },
    ...THEMES.filter((t) => t.user).map(item),
    { label: '+ NEW THEME', pick: () => showThemeEditor(app) },
    { label: 'IMPORT…', pick: () => app.importTheme() },
    { label: 'PASTE CODE', pick: () => app.pasteThemeCode() },
  ]);
}
// ✎ or right-click on a theme of your own.
function showThemeActions(app, theme, box) {
  showMenu(box, [
    { label: 'EDIT', pick: () => showThemeEditor(app, theme) },
    { label: 'EXPORT…', pick: () => app.exportTheme(theme.name) },
    theme.image ? null : { label: 'COPY CODE', pick: () => app.copyThemeCode(theme) },
    { label: 'DELETE…', pick: () => showMenu(box, [
      { label: `DELETE ${theme.name}`, pick: () => app.deleteTheme(theme.name) },
      { label: 'KEEP IT', pick: () => {} },
    ]) },
  ].filter(Boolean));
}
```

- [ ] **Step 3: CSS** — after the `.theme-item.current` rule; also add `max-height: calc(100vh - 16px); overflow-y: auto;`
to `.theme-menu`:

```css
.menu-divider { height: 1px; margin: 4px 0; background: rgba(255, 255, 255, .118); }
.menu-more { opacity: 0; padding: 0 2px 0 10px; color: rgb(var(--muted)); }
.theme-item:hover .menu-more { opacity: 1; }
.menu-more:hover { color: rgb(var(--accent)); }
```

- [ ] **Step 4: Escape** — in `ESC_ORDER` put `'theme'` right after `'menu'` (the editor panel's name, Task 6).

- [ ] **Step 5: Check by hand** (test profile with `TEST` from Task 4): Settings → THEME shows ten built-ins, a line,
`TEST` with ✎ on hover, then `+ NEW THEME`, `IMPORT…`, `PASTE CODE`. ✎ → EDIT / EXPORT… / COPY CODE / DELETE….
COPY CODE → status `CODE COPIED · PASTE IT IN A CHAT`; PASTE CODE → `TEST 2` added and on. EXPORT… → file saved;
IMPORT… it → `TEST 3`. DELETE… → DELETE TEST 3 → RED if it was on, `THEME DELETED`. Right-click on a built-in does
nothing. Escape closes a menu first, then Settings.

- [ ] **Step 6: Full tests, commit**

Run: `npm test` — all pass.

```bash
git add src/renderer/js/panels.js src/renderer/styles.css
git commit -m "The theme menu: your themes under the built-in ones, + NEW THEME, IMPORT…, PASTE CODE, and EDIT, EXPORT…, COPY CODE, DELETE on each"
```

---

### Task 6: The editor

**Files:**
- Create: `src/renderer/js/theme-editor.js`
- Modify: `src/renderer/js/panels.js` (add `showThemeEditor`, import `buildThemeEditor`; replace Task 5's
  `COMING UP` stand-ins)
- Modify: `src/renderer/styles.css` (color well, warning)

**Interfaces:**
- Consumes: `app.previewTheme`, `app.restoreTheme`, `app.saveTheme`, `app.shownTheme`, `app.setStatus`,
  `app.state.cover` (Task 4); `THEMES`, `SCENES`, `contrast`, `hex`, `fromHex`, `draftFrom`, `startFrom`,
  `deriveAutoTheme` (Task 3); panels' `title`, `row`, `hint`, `gap`, `sliderRow`, `showMenu`, `refreshPanel`,
  `closePanel`.
- Produces: `buildThemeEditor(app, ctx, ui) → nodes` with `ctx = { draft, editing, saved }`,
  `ui = { title, row, hint, gap, sliderRow, menu, refresh, close }`; `shrinkImage(blob) → Promise<dataUrl>` throwing
  `Error('unreadable')` / `Error('too big')`; panels' `showThemeEditor(app, editing = null)`.

- [ ] **Step 1: `src/renderer/js/theme-editor.js`**

```js
// The theme editor (Settings → THEME → + NEW THEME, or EDIT on one of yours): six colors, a scene, and a picture behind
// the player — the player itself recolored as you go. The panel is opened and closed by panels.js.
import { el, pill, Slider } from './widgets.js';
import { THEMES, SCENES, contrast, hex, fromHex, startFrom, deriveAutoTheme } from './theme.js';

const COLOR_ROWS = [['BACKGROUND', 'bg'], ['CARDS', 'card'], ['ACCENT', 'accent'], ['ACCENT 2', 'accent2'], ['TEXT', 'text'], ['MUTED', 'muted']];
const MAX_SIDE = 1920, MAX_BYTES = 1024 * 1024, QUALITIES = [0.85, 0.75, 0.65, 0.55];

const asDataUrl = (blob) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
const loadImage = (src) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });

/** A picture for a theme: at most 1920 px and 1 MB, as a JPEG data URL. Throws 'unreadable' or 'too big'. */
export async function shrinkImage(blob) {
  let bitmap;
  try { bitmap = await createImageBitmap(blob); } catch { throw new Error('unreadable'); }
  const s = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * s)), Math.max(1, Math.round(bitmap.height * s)));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of QUALITIES) {
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    if (out.size <= MAX_BYTES) return asDataUrl(out);
  }
  throw new Error('too big');
}

/** The editor's contents. ctx: { draft (the theme being made), editing (the theme of yours being changed, or null), saved }. */
export function buildThemeEditor(app, ctx, ui) {
  const d = ctx.draft, preview = () => app.previewTheme(d);
  const swatchOf = (t) => `linear-gradient(135deg, rgb(${t.accent}), rgb(${t.accent2}))`;

  const startButton = pill('START FROM…', () => ui.menu(startButton, [
    ...THEMES.filter((t) => !t.user && t.name !== 'AUTO').map((t) => ({ label: t.name, swatch: swatchOf(t), pick: () => { startFrom(d, t); ui.refresh(); preview(); } })),
    { label: 'THIS ALBUM', pick: () => { startFrom(d, deriveAutoTheme(app.state.cover)); ui.refresh(); preview(); } },
  ]), 'Take the colors and scene of a theme, or the colors of the album playing');

  const warning = el('span', { class: 'theme-warning' });
  const checkContrast = () => { warning.textContent = contrast(d.text, d.bg) < 4.5 ? 'HARD TO READ' : ''; };
  checkContrast();
  const colorRow = ([label, key]) => {
    const code = el('span', { class: 'row-value' }, hex(d[key]).toUpperCase());
    const well = el('input', { type: 'color', class: 'color-well', value: hex(d[key]), title: `Pick the ${label.toLowerCase()} color`,
      onInput: (e) => { d[key] = fromHex(e.target.value); code.textContent = e.target.value.toUpperCase(); checkContrast(); preview(); } });
    return ui.row(label, el('div', { class: 'row-pills' }, key === 'text' ? warning : null, code, well));
  };

  const sceneButton = pill(d.scene, () => ui.menu(sceneButton, SCENES.map((s) => ({
    label: s, current: s === d.scene, pick: () => { d.scene = s; sceneButton.textContent = s; preview(); },
  }))), 'The visualizer, and what falls behind the player');

  const useImage = async (blob) => {
    try { d.image = await shrinkImage(blob); } catch (err) { app.setStatus(err.message === 'too big' ? 'IMAGE TOO BIG' : "CAN'T READ THAT IMAGE"); return; }
    ui.refresh(); preview();
  };
  const picker = el('input', { type: 'file', accept: 'image/*', hidden: true, onChange: (e) => { if (e.target.files[0]) useImage(e.target.files[0]); e.target.value = ''; } });
  let imageRows;
  if (d.image) {
    const blurValue = el('span', { class: 'row-value' }, `${d.blur}PX`), dimValue = el('span', { class: 'row-value' }, `${d.dim}%`);
    const blur = new Slider({ min: 0, max: 40, value: d.blur, onInput: (v) => { d.blur = v; blurValue.textContent = `${v}PX`; preview(); } });
    const dim = new Slider({ min: 0, max: 90, value: d.dim, onInput: (v) => { d.dim = v; dimValue.textContent = `${v}%`; preview(); } });
    imageRows = [
      ui.row('IMAGE', el('div', { class: 'row-pills' },
        pill('COLORS FROM IMAGE', async () => { startFrom(d, deriveAutoTheme(await loadImage(d.image)), { keepScene: true }); ui.refresh(); preview(); }, 'Colors to go with the picture'),
        pill('CHANGE…', () => picker.click()), pill('REMOVE', () => { d.image = null; ui.refresh(); preview(); }))),
      ui.sliderRow('BLUR', blur, blurValue), ui.sliderRow('DIM', dim, dimValue),
    ];
  } else {
    imageRows = [ui.row('IMAGE', pill('CHOOSE…', () => picker.click(), 'A picture behind the player')),
      ui.hint('Or drop a picture here. It’s kept inside the theme, so it travels with it.')];
  }

  const name = el('input', { class: 'theme-name', value: d.name, maxlength: 16, spellcheck: 'false',
    onInput: (e) => { const at = e.target.selectionStart; e.target.value = e.target.value.toUpperCase(); e.target.setSelectionRange(at, at); d.name = e.target.value; } });
  const save = async () => {
    if (!d.name.trim()) { name.focus(); return; }
    if (await app.saveTheme(d, ctx.editing ? ctx.editing.name : null)) { ctx.saved = true; ui.close(); }
  };

  const body = el('div', { class: 'scroll settings-body',
    onDragover: (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; },
    onDrop: (e) => { e.preventDefault(); e.stopPropagation(); const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/')); if (f) useImage(f); } },
  ui.row('START FROM', startButton), ui.gap(10),
  ...COLOR_ROWS.map(colorRow), ui.gap(10),
  ui.row('SCENE', sceneButton), ...imageRows, ui.gap(10),
  ui.row('NAME', name), picker);
  return [ui.title(ctx.editing ? `EDIT ${ctx.editing.name}` : 'NEW THEME'), ui.gap(14), body,
    el('div', { class: 'close-row split' }, pill('CANCEL', ui.close), el('button', { class: 'pill on', onClick: save }, 'SAVE'))];
}
```

- [ ] **Step 2: `showThemeEditor` in `panels.js`**

Add `import { buildThemeEditor } from './theme-editor.js';` and `draftFrom` to the `./theme.js` import. Then, after
`showThemeActions`:

```js
// ---- Theme editor (theme-editor.js) -------------------------------------------------------------------------------

/** A new theme (starting from the one on), or `editing`, one of yours. Closed without SAVE, the theme that was on is back. */
export function showThemeEditor(app, editing = null) {
  const ctx = { draft: editing ? draftFrom(editing, editing.name) : draftFrom(app.shownTheme(), 'MY THEME'), editing, saved: false };
  const ui = { title, row, hint, gap, sliderRow, menu: showMenu, refresh: () => refreshPanel('theme'), close: () => closePanel('theme') };
  const p = openPanel('theme', () => buildThemeEditor(app, ctx, ui), { width: 460 });
  p.onClose = () => { if (!ctx.saved) app.restoreTheme(); };
  app.previewTheme(ctx.draft);
}
```

Replace Task 5's two `app.setStatus('COMING UP')` stand-ins with `showThemeEditor(app)` and
`showThemeEditor(app, theme)`.

- [ ] **Step 3: CSS**

```css
.color-well { width: 34px; height: 22px; padding: 0; border: 1px solid rgba(255, 255, 255, .2); border-radius: 4px; background: none; cursor: pointer; }
.color-well::-webkit-color-swatch-wrapper { padding: 2px; }
.color-well::-webkit-color-swatch { border: none; border-radius: 2px; }
.theme-warning { color: rgb(var(--accent)); font-size: 10px; font-weight: bold; }
.theme-name { width: 170px; background: rgba(255, 255, 255, .06); border: 1px solid rgba(255, 255, 255, .118); color: rgb(var(--text)); font: inherit; font-size: 12px; padding: 5px 8px; }
```

- [ ] **Step 4: Check by hand** (test profile):
  1. `+ NEW THEME` → panel `NEW THEME`, name `MY THEME`, colors of the theme that was on.
  2. Drag ACCENT's color → player recolors live; TEXT near BACKGROUND → `HARD TO READ`.
  3. SCENE → SNOW → snow falls behind the panel.
  4. CHOOSE… a 4000×3000 photo → image behind the player; BLUR/DIM sliders move it; COLORS FROM IMAGE recolors.
  5. Drop a `.txt` renamed `.png` on the panel → `CAN'T READ THAT IMAGE`, draft unchanged.
  6. Escape → the old theme is back (colors, scene, no image).
  7. Again, name `VAPOR`, SAVE → `THEME SAVED`, `VAPOR` on and in the menu with the picture as its swatch; AMBIENT
     BACKGROUND shows its note.
  8. Restart → `VAPOR` on with its image. EDIT → rename `VAPOR 2000`, SAVE → only `VAPOR 2000` in the menu.
  9. Check the saved file in `<profile>/themes/` is ≤ ~1.4 MB.

- [ ] **Step 5: Full tests, commit**

Run: `npm test` — all pass.

```bash
git add src/renderer/js/theme-editor.js src/renderer/js/panels.js src/renderer/styles.css
git commit -m "The theme editor: six colors, a scene and a picture behind the player, the player recolored as you go; START FROM a theme or the album playing"
```

---

### Task 7: The Now Playing card and video use the theme's image

**Files:**
- Modify: `src/renderer/js/share-card.js:96-108` (`drawCard`)
- Modify: `src/renderer/js/share-video.js:54-62` (`backdrop`)
- Modify: `src/renderer/js/app.js` `shareCard()` (~540-560)

**Interfaces:**
- Consumes: `drawThemeImage(g, w, h, img, { blur, dim })` (Task 3); `shownTheme` (Task 4).
- Produces: `song.backdrop` — `{ image: HTMLImageElement, blur, dim } | null` on the song object passed to `drawCard`
  and `recordVideo`.

- [ ] **Step 1: `share-card.js`** — import `drawThemeImage` from `./theme.js`; in `drawCard` replace the
`if (song.cover) { … }` block with:

```js
  if (song.backdrop) drawThemeImage(g, W, H, song.backdrop.image, song.backdrop);
  else if (song.cover) {
    g.save(); g.filter = 'blur(60px) saturate(1.3)'; g.globalAlpha = 0.45;
    g.drawImage(song.cover, -100, -100, W + 200, H + 200);
    g.restore();
  }
```

- [ ] **Step 2: `share-video.js`** — import `drawThemeImage`; in `backdrop()` replace the `if (song.cover) { … }` line:

```js
  if (song.backdrop) drawThemeImage(g, L.w, L.h, song.backdrop.image, song.backdrop);
  else if (song.cover) { g.save(); g.filter = 'blur(80px) saturate(1.3)'; g.globalAlpha = 0.5; g.drawImage(song.cover, -150, -150, L.w + 300, L.h + 300); g.restore(); }
```

- [ ] **Step 3: `app.js` `shareCard()`** — the song gets the theme's picture (the `<img>` already showing it):

```js
  const themeImage = shownTheme.image ? $('backdrop-theme') : null;
  const song = { cover: state.cover, title: state.titleText, artist: state.artistText, subtitle: cardSubtitle(state.details),
    backdrop: themeImage && themeImage.complete ? { image: themeImage, blur: shownTheme.blur, dim: shownTheme.dim } : null };
```

- [ ] **Step 4: Check by hand** — with `VAPOR 2000` on, `P` → the card preview has the picture behind the case; SAVE…
→ PNG has it. With RED on → the blurred cover as before. Record VIDEO 1:1 via the test script
(`$CLAUDE_JOB_DIR/tmp/grab-video.mjs` pattern: call `recordVideo` with `song.backdrop` set) and extract a frame with
`ffmpeg -ss 4 -i out.mp4 -frames:v 1 f.png` → the picture is the background.

- [ ] **Step 5: Full tests, commit**

Run: `npm test` — all pass.

```bash
git add src/renderer/js/share-card.js src/renderer/js/share-video.js src/renderer/js/app.js
git commit -m "The Now Playing card and video are set on the theme's picture when it has one"
```

---

### Task 8: README and a last full check

**Files:**
- Modify: `README.md` (themes bullet ~line 173; shortcuts unchanged)

- [ ] **Step 1: README** — after the "Ten themes — …" bullet add:

```markdown
- **Themes of your own** — Settings → THEME → **+ NEW THEME**: six colors (with a warning if the text gets hard to read), a scene (snow, stars, waves, rain of code, leaves or plain bars) and a picture behind the player, blurred and dimmed as you like; start from any theme or from the album playing. Share one as a `.cdtheme` file (**EXPORT…**, then drop it on anyone's CDPlayer) or, without a picture, as a one-line code (**COPY CODE** / **PASTE CODE**)
```

- [ ] **Step 2: Full check** — `npm test` all pass; launch the real build in a fresh test profile: first launch → RED;
make, save, restart, edit, export, import in a second profile (`CDPLAYER_HOME=…/prof-themes-2`), paste a code, delete;
Mini Mode with an OCEAN-scene theme shows waves.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "README: themes of your own — colors, a scene and a picture, shared as a file or a one-line code"
```
