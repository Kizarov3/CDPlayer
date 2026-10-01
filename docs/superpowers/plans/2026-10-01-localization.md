# Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CDPlayer's interface in the user's language — Russian shipped, others addable as one JSON file.

**Architecture:** One pure `format(dict, text, vars)` (English text as key, `{vars}`, `Intl.PluralRules` forms) used by
`t()` in the renderer (`i18n.js`, dictionary fetched synchronously from the preload at import) and the main process
(`src/main/i18n.js`, which also picks the locale). A collector script keeps `src/locales/*.json` in step with the code;
tests keep Russian complete and catch strings left unwrapped.

**Tech Stack:** Electron 44, ES-module renderer, CommonJS main, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-01-localization-design.md`

## Global Constraints

- English text is the key; no `en.json`. Empty/missing translation → English.
- Locale file keys starting with `_` are metadata: `_language`, `_locale`.
- Not translated: What's New, theme names, tag/online data, receipt shop names/addresses.
- Setting `settings.txt` line 18 (index 17): `AUTO` (default) | `en` | a locale code. Restart applies a change.
- Plural objects use `Intl.PluralRules(_locale)` category names and always include `other`.
- Tests never touch the real `~/.cdplayer` (`CDPLAYER_HOME` temp dir).
- No AI attribution in commits.

## Review Focus

1. A locale file with broken JSON or a wrong-typed value → the app starts in English, no crash (Task 2 test).
2. A system language list with region tags (`pt-BR`, `zh-Hant-TW`) → the most specific file that exists, else the
   language part, else English (Task 2 test).
3. A translation missing `{n}` or with a different placeholder → test failure, never a literal `{n}` on screen
   (Task 4 test).
4. Picking a language then quitting before RESTART → the choice is saved and used at next launch (Task 3 manual check).
5. Russian text longer than its English button → shortened translation, checked by screenshots (Tasks 6–10).

---

### Task 1: `format()` — lookup, `{vars}`, plural forms

**Files:** Create `src/renderer/js/i18n-format.js`, `src/main/i18n-format.js`; Test `test/i18n.test.mjs`

**Interfaces — Produces:** `format(dict, text, vars = {}) → string` (both files, same behaviour).

- [ ] Step 1: failing test `test/i18n.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { format } from '../src/renderer/js/i18n-format.js';

const require = createRequire(import.meta.url);
const ru = { _locale: 'ru', THEME: 'ТЕМА', EMPTY: '', 'HELLO {name}': 'ПРИВЕТ, {name}',
  '{n} albums': { one: '{n} альбом', few: '{n} альбома', many: '{n} альбомов', other: '{n} альбома' } };

test('a translation, or the English text when there is none', () => {
  assert.strictEqual(format(ru, 'THEME'), 'ТЕМА');
  assert.strictEqual(format(ru, 'SHELF'), 'SHELF');
  assert.strictEqual(format(ru, 'EMPTY'), 'EMPTY');
  assert.strictEqual(format({}, 'THEME'), 'THEME');
  assert.strictEqual(format(null, 'THEME'), 'THEME');
  assert.strictEqual(format(ru, '_locale'), '_locale');
});

test('{names} filled in; one with nothing to fill stays', () => {
  assert.strictEqual(format(ru, 'HELLO {name}', { name: 'Sam' }), 'ПРИВЕТ, Sam');
  assert.strictEqual(format({}, 'HELLO {name}'), 'HELLO {name}');
  assert.strictEqual(format({}, '{a} and {a}', { a: 1 }), '1 and 1');
});

test('Russian plural forms by n', () => {
  const at = (n) => format(ru, '{n} albums', { n });
  assert.deepStrictEqual([1, 2, 5, 11, 21, 22, 1.5].map(at),
    ['1 альбом', '2 альбома', '5 альбомов', '11 альбомов', '21 альбом', '22 альбома', '1.5 альбома']);
  assert.strictEqual(format({ _locale: 'ru', X: { other: 'x' } }, 'X', { n: 1 }), 'x');
  assert.strictEqual(format({ _locale: 'zz-bad!', X: { one: 'o', other: 'x' } }, 'X', { n: 1 }), 'o');
});

test('the main process formats the same way', () => {
  const main = require('../src/main/i18n-format.js');
  for (const [text, vars] of [['THEME'], ['SHELF'], ['HELLO {name}', { name: 'A' }], ['{n} albums', { n: 3 }], ['{n} albums', { n: 25 }]]) {
    assert.strictEqual(main.format(ru, text, vars), format(ru, text, vars));
  }
});
```

- [ ] Step 2: run `node --test test/i18n.test.mjs` → FAIL (module not found).
- [ ] Step 3: `src/renderer/js/i18n-format.js`:

```js
// Translating a piece of the interface: the English text is the key into a language's dictionary
// (src/locales/<code>.json); {names} are filled in, and a text that changes with a number has a form per plural category.
// src/main/i18n-format.js is the same code for the main process (a test keeps them alike).

const rules = new Map();
function pluralRules(locale) {
  if (!rules.has(locale)) {
    let r;
    try { r = new Intl.PluralRules(locale); } catch { r = new Intl.PluralRules('en'); }
    rules.set(locale, r);
  }
  return rules.get(locale);
}
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));

/** `text` in the dictionary's language (or as it is), with `vars` filled in; `vars.n` picks a plural form. */
export function format(dict, text, vars = {}) {
  let out = dict && !text.startsWith('_') && Object.prototype.hasOwnProperty.call(dict, text) ? dict[text] : null;
  if (out && typeof out === 'object') {
    const category = typeof vars.n === 'number' ? pluralRules(dict._locale || 'en').select(vars.n) : 'other';
    out = out[category] || out.other || null;
  }
  return fill(typeof out === 'string' && out ? out : text, vars);
}
```

  `src/main/i18n-format.js`: the same body with `'use strict';` on top, `function format` (no `export`), and
  `module.exports = { format };` at the end.
- [ ] Step 4: run → PASS (4 tests).
- [ ] Step 5: commit `"Translating a piece of the interface: the English text as the key, names filled in, plural forms"`.

---

### Task 2: Main — which language, the setting, IPC

**Files:** Create `src/main/i18n.js`; Modify `src/main/store.js` (settings line 18), `src/main/main.js`
(startup, IPC), `src/preload.js`; Create `src/locales/ru.json` (metadata only for now); Test `test/i18n-main.test.js`,
`test/state.test.js` (settings round trip).

**Interfaces — Produces:** `resolveLocale(choice, systemLanguages, available) → code`, `listLocales(dir?) →
[{ code, name }]`, `loadLocale(choice, systemLanguages, dir?) → { code, dict }`, `t(text, vars)`, `current() →
{ code, dict }`. Settings field `language`. IPC: sync `i18n:dict` → `{ code, dict }`; `i18n:list` →
`{ locales: [{code,name}], auto: code }`; `app:relaunch`. Preload: `i18nDict()`, `listLanguages()`, `relaunch()`.

- [ ] Step 1: failing tests `test/i18n-main.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const i18n = require('../src/main/i18n');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-locales-'));
fs.writeFileSync(path.join(dir, 'ru.json'), JSON.stringify({ _language: 'Русский', _locale: 'ru', THEME: 'ТЕМА' }));
fs.writeFileSync(path.join(dir, 'pt-BR.json'), JSON.stringify({ _language: 'Português (Brasil)', _locale: 'pt-BR' }));
fs.writeFileSync(path.join(dir, 'broken.json'), '{ nope');
fs.writeFileSync(path.join(dir, 'odd.json'), '[1,2]');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('the languages there are files for, by name', () => {
  assert.deepStrictEqual(i18n.listLocales(dir), [{ code: 'pt-BR', name: 'Português (Brasil)' }, { code: 'ru', name: 'Русский' }]);
});

test('AUTO: the first system language with a file, the most specific first; else English', () => {
  const have = ['ru', 'pt-BR'];
  assert.strictEqual(i18n.resolveLocale('AUTO', ['ru-RU', 'en-US'], have), 'ru');
  assert.strictEqual(i18n.resolveLocale('AUTO', ['en-US', 'ru-RU'], have), 'en');
  assert.strictEqual(i18n.resolveLocale('AUTO', ['pt-BR'], have), 'pt-BR');
  assert.strictEqual(i18n.resolveLocale('AUTO', ['pt-PT'], have), 'en');
  assert.strictEqual(i18n.resolveLocale('AUTO', ['de-DE'], have), 'en');
  assert.strictEqual(i18n.resolveLocale('AUTO', [], have), 'en');
});

test('a language picked in Settings, if its file is there', () => {
  assert.strictEqual(i18n.resolveLocale('ru', ['en-US'], ['ru']), 'ru');
  assert.strictEqual(i18n.resolveLocale('en', ['ru-RU'], ['ru']), 'en');
  assert.strictEqual(i18n.resolveLocale('de', ['ru-RU'], ['ru']), 'ru'); // gone: as AUTO
});

test('loaded: its dictionary; English and broken files: none', () => {
  assert.deepStrictEqual(i18n.loadLocale('ru', [], dir).code, 'ru');
  assert.strictEqual(i18n.t('THEME'), 'ТЕМА');
  assert.deepStrictEqual(i18n.loadLocale('en', ['ru-RU'], dir), { code: 'en', dict: {} });
  assert.strictEqual(i18n.t('THEME'), 'THEME');
  assert.deepStrictEqual(i18n.loadLocale('broken', ['xx'], dir), { code: 'en', dict: {} });
});
```

  Append to `test/state.test.js`:

```js
test('the language: AUTO unless set, kept, odd values back to AUTO', () => {
  fs.writeFileSync(path.join(home, 'settings.txt'), '70\n5\n1\n0\nOCEAN\n');
  assert.strictEqual(store.readSettings().language, 'AUTO');
  store.writeSettings({ ...store.readSettings(), language: 'ru' });
  assert.strictEqual(store.readSettings().language, 'ru');
  store.writeSettings({ ...store.readSettings(), language: 'ru/../x' });
  assert.strictEqual(store.readSettings().language, 'AUTO');
});
```

  and add `language: 'AUTO'` to the expected object of the "reads a settings.txt written by the Java version" test.
- [ ] Step 2: run both → FAIL.
- [ ] Step 3: `src/main/i18n.js`:

```js
'use strict';
/**
 * Which language the interface is in (Settings → LANGUAGE, or the system's), and t() for the main process's own text:
 * dialog titles, menus. The dictionaries are src/locales/<code>.json; English is the code itself.
 */
const fs = require('fs');
const path = require('path');
const { format } = require('./i18n-format');

const LOCALES = path.join(__dirname, '..', 'locales');
const CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

function readLocale(dir, code) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), 'utf8'));
    return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
  } catch { return null; }
}
/** The languages there are files for: [{ code, name }], by code. */
function listLocales(dir = LOCALES) {
  let files;
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  return files.map((f) => f.slice(0, -5)).filter((c) => CODE.test(c)).sort()
    .map((code) => { const d = readLocale(dir, code); return d && typeof d._language === 'string' && d._language ? { code, name: d._language } : null; })
    .filter(Boolean);
}
/** The language to use: the one picked (if its file is there), else the first system language with a file. */
function resolveLocale(choice, systemLanguages, available) {
  const lower = new Map(available.map((c) => [c.toLowerCase(), c]));
  if (choice === 'en') return 'en';
  if (choice && choice !== 'AUTO' && lower.has(choice.toLowerCase())) return lower.get(choice.toLowerCase());
  for (const tag of systemLanguages || []) {
    const parts = String(tag).toLowerCase().split(/[-_]/);
    if (parts[0] === 'en') return 'en';
    for (let i = parts.length; i > 0; i--) {
      const c = parts.slice(0, i).join('-');
      if (lower.has(c)) return lower.get(c);
    }
  }
  return 'en';
}

let loaded = { code: 'en', dict: {} };
function loadLocale(choice, systemLanguages, dir = LOCALES) {
  const code = resolveLocale(choice, systemLanguages, listLocales(dir).map((l) => l.code));
  const dict = code === 'en' ? null : readLocale(dir, code);
  loaded = dict ? { code, dict } : { code: 'en', dict: {} };
  return loaded;
}
const t = (text, vars) => format(loaded.dict, text, vars);
const current = () => loaded;

module.exports = { listLocales, resolveLocale, loadLocale, t, current };
```

  `store.js`: comment line mentions "…the audio output ("id<TAB>name") and the language"; `DEFAULT_SETTINGS.language:
  'AUTO'`; read: `const lang = l.length >= 18 ? l[17].trim() : ''; s.language = /^(AUTO|[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)$/.test(lang) ? lang : 'AUTO';`;
  write: append `/^(AUTO|[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)$/.test(s.language || '') ? s.language : 'AUTO'` after the output entry.

  `src/locales/ru.json`: `{ "_language": "Русский", "_locale": "ru" }`.
- [ ] Step 4: run both → PASS.
- [ ] Step 5: `main.js`: `const i18n = require('./i18n');`; first line inside `app.whenReady().then(() => {`:
  `i18n.loadLocale(settings.language, app.getPreferredSystemLanguages());`. IPC after `state:saveQueueSync`:

```js
// The interface's language (i18n.js): the dictionary, read once by each window as it loads; the languages to pick from;
// and the restart a new pick needs (the window saves the queue on its way out, as on any quit).
ipcMain.on('i18n:dict', (e) => { e.returnValue = i18n.current(); });
handle('i18n:list', () => ({ locales: i18n.listLocales(), auto: i18n.resolveLocale('AUTO', app.getPreferredSystemLanguages(), i18n.listLocales().map((l) => l.code)) }));
handle('app:relaunch', () => { app.relaunch(); app.quit(); });
```

  Preload: `i18nDict: () => ipcRenderer.sendSync('i18n:dict'), listLanguages: invoke('i18n:list'), relaunch: invoke('app:relaunch'),`.
- [ ] Step 6: `npm test` → all pass; commit `"Which language: the one picked in Settings or the system's, from the locale files there are"`.

---

### Task 3: Renderer — `t()`, the page, LANGUAGE in Settings

**Files:** Create `src/renderer/js/i18n.js`; Modify `src/renderer/js/app.js` (state.language, snapshot, `translatePage`
call first in startup, `<html lang>`), `src/renderer/js/panels.js` (LANGUAGE row), `src/renderer/js/mini.js` (call
`translatePage(document)` first).

**Interfaces — Produces:** `t(text, vars)`, `locale` (code), `translatePage(root)` from `i18n.js`;
`app.setLanguage(code)`; `app.relaunch()`.

- [ ] Step 1: `src/renderer/js/i18n.js`:

```js
// The interface in the user's language: t('THEME') → 'ТЕМА'. The dictionary comes from the main process as this module
// loads (before anything is built), so module-level text can be translated too; under node (tests) it's English.
import { format } from './i18n-format.js';

const loaded = typeof window !== 'undefined' && window.cdp && window.cdp.i18nDict ? window.cdp.i18nDict() : { code: 'en', dict: {} };
export const locale = loaded.code;
export const t = (text, vars) => format(loaded.dict, text, vars);

/** index.html's and mini.html's own text: elements marked data-i18n (their text) and data-i18n-title (their title). */
export function translatePage(root) {
  for (const n of root.querySelectorAll('[data-i18n]')) n.textContent = t(n.textContent.trim());
  for (const n of root.querySelectorAll('[data-i18n-title]')) n.title = t(n.title);
  if (root.documentElement) root.documentElement.lang = locale;
}
```

  Ruling vs spec: `data-i18n` is a marker and the element's own English text is the key (no duplicated text); the
  spec's "Loading" section is updated in this task's commit to say so.
- [ ] Step 2: `app.js`: import `{ t, translatePage }`; `state.language = 'AUTO'` default; startup `state.language =
  s.language || 'AUTO';`; `settingsSnapshot()` gains `language: state.language`; very first line of the startup
  function: `translatePage(document);`. `app` gains
  `setLanguage: (code) => { state.language = code; cdp.saveSettings(settingsSnapshot()); }` and
  `relaunch: async () => { await cdp.saveSettings(settingsSnapshot()); cdp.relaunch(); }`.
- [ ] Step 3: `panels.js` Settings → LOOK, after THEME:

```js
  const languageButton = pill('…', async () => {
    const { locales, auto } = await app.cdp.listLanguages(), nameOf = (c) => (c === 'en' ? 'ENGLISH' : (locales.find((l) => l.code === c) || {}).name || c);
    showMenu(languageButton, [
      { label: `AUTO · ${nameOf(auto).toUpperCase()}`, current: s.language === 'AUTO', pick: () => pickLanguage('AUTO') },
      { label: 'ENGLISH', current: s.language === 'en', pick: () => pickLanguage('en') },
      ...locales.map((l) => ({ label: l.name.toUpperCase(), current: s.language === l.code, pick: () => pickLanguage(l.code) })),
    ]);
  }, t('The language of the interface'));
  const languageNote = el('div', { class: 'row-pills' });
  const pickLanguage = (code) => { app.setLanguage(code); languageNote.replaceChildren(hint(t('Takes effect after a restart.')), pill(t('RESTART'), () => app.relaunch())); refreshLanguageName(); };
  const refreshLanguageName = () => app.cdp.listLanguages().then(({ locales, auto }) => {
    const code = s.language === 'AUTO' ? auto : s.language, l = locales.find((x) => x.code === code);
    languageButton.textContent = s.language === 'AUTO' ? `AUTO · ${(code === 'en' ? 'ENGLISH' : l ? l.name : code).toUpperCase()}` : (code === 'en' ? 'ENGLISH' : l ? l.name.toUpperCase() : code);
  });
  refreshLanguageName();
```

  and rows `row(t('LANGUAGE'), languageButton), languageNote,` after `row('THEME', themeButton)`. (Language names are
  shown in their own language and are not wrapped in `t()`.)
- [ ] Step 4: `npm test` → pass. Manual: test profile, LANGUAGE → РУССКИЙ → note + RESTART → relaunches (still English
  text, nothing translated yet, but `<html lang="ru">` and setting line 18 `ru`). Quit without RESTART after picking → next
  launch is `ru` (Review Focus 4).
- [ ] Step 5: commit `"Settings → LANGUAGE: AUTO, English or a language there's a file for, after a restart"`.

---

### Task 4: The collector, `npm run i18n`, and the locale tests

**Files:** Create `scripts/i18n-collect.mjs`, `scripts/i18n.mjs`; Modify `package.json` (script `"i18n": "node
scripts/i18n.mjs"`); Test `test/i18n-locales.test.mjs`.

**Interfaces — Produces:** `collectStrings(files: [{ path, text }]) → string[]` (sorted), `sourceFiles(root) →
[{ path, text }]`, `syncLocale(existing, keys, code) → object`, `coverage(dict, keys) → { done, total }`,
`untranslated(files, allow) → [{ path, text }]`, constant `CONVERTED` (files whose literals are checked).

- [ ] Step 1: failing tests `test/i18n-locales.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { collectStrings, sourceFiles, syncLocale, coverage, untranslated, CONVERTED, ALLOW } from '../scripts/i18n-collect.mjs';

test('collected: t() with a plain string in any quotes, and the pages\' marked text', () => {
  const keys = collectStrings([
    { path: 'a.js', text: "x(t('THEME')); t(\"SHELF\", { n }); t(`PLAY NEXT`); t(`A ${b}`); t(r.error); sqrt(2); t('IT\\'S')" },
    { path: 'p.html', text: '<span data-i18n>NOW PLAYING</span><button data-i18n-title title="Shuffle" id="s"></button>' },
  ]);
  assert.deepStrictEqual(keys, ["IT'S", 'NOW PLAYING', 'PLAY NEXT', 'SHELF', 'Shuffle', 'THEME']);
});

test('a language file brought in step: new texts empty, gone ones dropped, the rest kept, metadata first', () => {
  const out = syncLocale({ _language: 'Русский', OLD: 'СТАРОЕ', THEME: 'ТЕМА' }, ['SHELF', 'THEME'], 'ru');
  assert.deepStrictEqual(Object.keys(out), ['_language', '_locale', 'SHELF', 'THEME']);
  assert.deepStrictEqual(out, { _language: 'Русский', _locale: 'ru', SHELF: '', THEME: 'ТЕМА' });
  assert.deepStrictEqual(coverage(out, ['SHELF', 'THEME']), { done: 1, total: 2 });
});

const keys = collectStrings(sourceFiles('src'));
const locales = fs.readdirSync('src/locales').filter((f) => f.endsWith('.json'));

test('Russian is complete: every text in the code, nothing else', () => {
  const ru = JSON.parse(fs.readFileSync('src/locales/ru.json', 'utf8'));
  const missing = keys.filter((k) => !ru[k] || (typeof ru[k] === 'object' && !ru[k].other));
  const extra = Object.keys(ru).filter((k) => !k.startsWith('_') && !keys.includes(k));
  assert.deepStrictEqual({ missing, extra }, { missing: [], extra: [] });
});

test('every translation keeps its {names}; plural forms are the language\'s', () => {
  const names = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const file of locales) {
    const d = JSON.parse(fs.readFileSync(`src/locales/${file}`, 'utf8'));
    const cats = new Intl.PluralRules(d._locale).resolvedOptions().pluralCategories;
    for (const [k, v] of Object.entries(d)) {
      if (k.startsWith('_') || v === '') continue;
      if (typeof v === 'object') {
        assert.ok(v.other, `${file}: ${k} has no "other"`);
        for (const [cat, form] of Object.entries(v)) {
          assert.ok(cats.includes(cat), `${file}: ${k} has "${cat}"`);
          assert.strictEqual(names(form), names(k), `${file}: ${k} [${cat}]`);
        }
      } else assert.strictEqual(names(v), names(k), `${file}: ${k}`);
    }
  }
});

test('no interface text left out of t() in the files converted so far', () => {
  assert.deepStrictEqual(untranslated(CONVERTED.map((p) => ({ path: p, text: fs.readFileSync(p, 'utf8') })), ALLOW), []);
});

test('other languages: how far along (never failing)', () => {
  for (const file of locales.filter((f) => f !== 'ru.json')) {
    const { done, total } = coverage(JSON.parse(fs.readFileSync(`src/locales/${file}`, 'utf8')), keys);
    console.log(`${file}: ${done}/${total}`);
  }
});
```

- [ ] Step 2: run → FAIL (module not found).
- [ ] Step 3: `scripts/i18n-collect.mjs`:

```js
// The interface's texts as the code has them (every t('…') and the pages' data-i18n), and the tools that keep a language
// file (src/locales/<code>.json) in step with them. Used by `npm run i18n -- <code>` and by the tests.
import fs from 'node:fs';
import path from 'node:path';

const unescape = (s) => s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c));

export function collectStrings(files) {
  const keys = new Set();
  for (const { path: p, text } of files) {
    if (p.endsWith('.html')) {
      for (const m of text.matchAll(/<[^>]*\bdata-i18n\b[^>]*>([^<]+)</g)) keys.add(m[1].trim());
      for (const m of text.matchAll(/<[^>]*\bdata-i18n-title\b[^>]*>/g)) { const tm = /\btitle="([^"]*)"/.exec(m[0]); if (tm) keys.add(tm[1]); }
    } else {
      for (const m of text.matchAll(/(?<![\w.$])t\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
        if (m[1] === '`' && m[2].includes('${')) continue;
        keys.add(unescape(m[2]));
      }
    }
  }
  return [...keys].sort();
}

/** Every source file whose text the interface shows: renderer and main JS, and the two pages. */
export function sourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['locales', 'decoders', 'encoders', 'fonts'].includes(e.name)) walk(p); }
      else if (/\.(js|html)$/.test(e.name)) out.push({ path: p, text: fs.readFileSync(p, 'utf8') });
    }
  };
  walk(root);
  return out;
}

export function syncLocale(existing, keys, code) {
  const out = { _language: existing._language ?? '', _locale: existing._locale || code };
  for (const k of keys) out[k] = existing[k] ?? '';
  return out;
}
export function coverage(dict, keys) {
  const done = keys.filter((k) => (typeof dict[k] === 'object' ? dict[k] && dict[k].other : dict[k])).length;
  return { done, total: keys.length };
}

// Literal interface text handed straight to the helpers that put it on screen, without t(): two capitals in a row
// (the interface writes its labels in capitals) or a sentence in a hint.
const SHOWN = /\b(setStatus|pill|title|row|hint|section)\(\s*(['"`])((?:\\.|(?!\2)[^\\])*)\2/g;
export function untranslated(files, allow) {
  const out = [];
  for (const { path: p, text } of files) {
    for (const m of text.matchAll(SHOWN)) {
      const s = unescape(m[3]);
      if (!/[A-Z]{2}|[A-Za-z]{3,} [a-z]{3,}/.test(s) || allow.includes(s)) continue;
      out.push({ path: p, text: s });
    }
  }
  return out;
}
/** Files already converted (each conversion task adds its own). */
export const CONVERTED = [];
/** Literal text that is shown as it is in every language. */
export const ALLOW = [];
```

  `scripts/i18n.mjs`:

```js
// npm run i18n -- <code>: brings src/locales/<code>.json in step with the code (new texts added empty, gone ones
// removed) and says how much is translated. A translator fills in the empty strings.
import fs from 'node:fs';
import { collectStrings, sourceFiles, syncLocale, coverage } from './i18n-collect.mjs';

const code = process.argv[2];
if (!code || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code)) { console.error('usage: npm run i18n -- <language code, e.g. es or pt-BR>'); process.exit(1); }
const file = `src/locales/${code}.json`;
const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const keys = collectStrings(sourceFiles('src'));
const out = syncLocale(existing, keys, code);
fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
const { done, total } = coverage(out, keys);
console.log(`${code}: ${done}/${total} (${Math.round((done / total) * 100) || 0}%)`);
```

- [ ] Step 4: run → PASS (Russian complete holds trivially: no `t()` calls in the code yet except Task 3's, whose
  three texts get translated now: `npm run i18n -- ru`, then fill `LANGUAGE`, `RESTART`, `Takes effect after a restart.`,
  `The language of the interface`).
- [ ] Step 5: commit `"npm run i18n: a language file brought in step with the code; tests keep Russian complete and placeholders intact"`.

---

### Task 5: Handwriting with Cyrillic — Caveat

**Files:** Create `src/renderer/fonts/Caveat.woff2`, `src/renderer/fonts/OFL.txt`; Modify `src/renderer/styles.css`
(`@font-face` + marker lists), `src/renderer/js/disc.js:20`, `src/renderer/js/share-card.js:8`, and any other
`MARKER_FONT`/handwriting list (`grep -rn "Marker Felt" src/renderer`).

- [ ] Step 1: fetch Caveat (variable, OFL) from the google/fonts repo
  (`https://github.com/google/fonts/raw/main/ofl/caveat/Caveat%5Bwght%5D.ttf` and `.../OFL.txt`), convert to woff2
  (`npx --yes ttf2woff2 < Caveat.ttf > Caveat.woff2`; if unavailable, ship the `.ttf` and reference that).
- [ ] Step 2: CSS:

```css
/* Handwriting with Cyrillic (and Latin): after Marker Felt, so Latin keeps its look and Cyrillic is still written by hand. SIL OFL 1.1 — fonts/OFL.txt. */
@font-face { font-family: "Caveat"; src: url("fonts/Caveat.woff2") format("woff2"); font-weight: 400 700; font-display: swap; }
```

  Insert `"Caveat", ` right after `"Marker Felt", ` in every handwriting font list.
- [ ] Step 3: before canvas drawing that uses the marker font for the first time, `document.fonts.load('20px Caveat')`
  is awaited once at startup in `app.js` (`document.fonts.load('20px Caveat').catch(() => {});` before the first
  render; it resolves from the local file quickly).
- [ ] Step 4: manual: in DevTools draw `ctx.font = '40px "Marker Felt", "Caveat", cursive'; fillText('Ручка 1st spin')` →
  Latin in Marker Felt, Cyrillic in Caveat. `npm test` pass. Commit `"Handwriting that can write Cyrillic: Caveat after Marker Felt"`.

---

### Tasks 6–10: Converting the interface, area by area

Each of these tasks does the same steps for its files:

1. Wrap every user-visible string in `t()`, by these rules:
   - static text: `'THEME'` → `t('THEME')`;
   - built text → a template: `` `${n} MISSING` `` → `t('+{n} MISSING', { n })`, `` `PLAYED ${n} TIMES` `` →
     `t('PLAYED {n} TIMES', { n })` (any text with a count uses `n` so it can have plural forms);
   - text joined from pieces where word order may change → one template with all the pieces as `{vars}`;
   - error/status codes that arrive from the main process are translated where shown: `setStatus(t(r.error))`;
   - module-level constants (GUIDE, FAQ, SHORTCUTS, hint texts) wrap each text in `t()` at definition;
   - **not** wrapped: theme names, values from tags/online, receipt shop names/addresses, keyboard key names
     (`SPACE`, `J`), CSS/IDs, the What's New list (`showChangelogIfNeeded` content), log/console text.
2. Add the task's files to `CONVERTED` in `scripts/i18n-collect.mjs`; anything the untranslated check flags that must
   stay literal goes into `ALLOW` with the reason as a comment.
3. `npm run i18n -- ru`, then translate every empty value in `src/locales/ru.json`: natural Russian, interface labels in
   capitals as in English, as short as the English where it sits on a button; counts as plural objects
   (`one`/`few`/`many`/`other`).
4. `npm test` → all pass (Russian complete, placeholders intact, nothing untranslated in `CONVERTED`).
5. Test profile with `language` `ru`: screenshots of every screen the task touched; shorten translations that don't
   fit (CSS only if no wording fits). Switch back to English and screenshot one screen to check nothing changed there.
6. Commit.

### Task 6: The main window — `index.html`, `app.js`, `keys.js`, `widgets.js`

`index.html`: mark static labels `data-i18n`, buttons' titles `data-i18n-title`. `app.js`: statuses, track-source
labels, shortcut hints, empty-queue text, everything `setStatus(…)`. Screens: main window idle, playing, tray open,
queue, karaoke button states. Commit `"The main window in Russian"`.

### Task 7: Panels — Settings, EQ, lyrics, tags, history, search, rip, the card (`panels.js` up to `showSpotify`)

Screens: Settings (all sections), EQ, lyrics, tags, history, search, rip, Now Playing card. Commit
`"Settings and the panels in Russian"`.

### Task 8: Spotify wizard, Library Check, guide, FAQ, shortcuts, theme editor (`panels.js` rest, `help.js`, `theme-editor.js`, `spotify-deck.js`)

The FAQ and guide are full sentences; keep their tone. The README shortcuts test compares `SHORTCUTS` with README —
it compares the English source, so it keeps passing. Screens: wizard pages 1–4, Library Check, guide 1–5, FAQ,
shortcuts, theme editor and menu. Commit `"The Spotify setup, Library Check, the guide, FAQ and theme editor in Russian"`.

### Task 9: The shelf, the booklet, the disc, karaoke, mini player, card and video drawing (`shelf*.js`, `booklet*.js`, `disc*.js`, `karaoke.js`, `mini.js`, `mini.html`, `share-card.js`, `share-video.js`, `visualizer.js`, `particles.js`)

Canvas text through `t()` at draw time. Receipt: labels translated, shop names not. Screens: shelf (sort dividers,
missing boxes, a case with note and receipt), booklet (front, pen marks), disc back side, karaoke, mini player, card,
one video frame. Commit `"The shelf, the booklet, the disc and the mini player in Russian"`.

### Task 10: The main process (`src/main/*.js`)

Dialog titles and filter names, the disc's context menu, the application menu labels that aren't roles, Dock menu,
notifications — through `i18n.t()`. Error/status strings sent to the renderer stay English (the renderer translates
them, Task 6–9 rule); add any such code the renderer shows to its `t()` call sites. Screens: a save dialog title, the
disc menu, import dialog. Commit `"Dialogs and menus in Russian"`.

### Task 11: Contributors' guide and README

**Files:** Create `docs/TRANSLATING.md`; Modify `README.md`.

- [ ] `docs/TRANSLATING.md`: what a locale file is; `npm run i18n -- <code>`; fill `_language` (the language's own
  name), translate the empty strings (keep `{names}`, capitals where English has them, plural objects with the
  categories `Intl.PluralRules` lists for the language); check with `npm test` and by running the app with Settings →
  LANGUAGE; open a pull request with just the JSON file.
- [ ] README: a "Languages" section — English and Russian, Settings → LANGUAGE (AUTO follows the system), and
  "Add yours: see docs/TRANSLATING.md".
- [ ] Final: all `src/renderer/js/*.js` that show text are in `CONVERTED` (add a test assertion that `CONVERTED`
  contains every renderer JS file except `i18n*.js`, `audio*.js`, `theme.js`, `jog.js`, `play-next.js`, `output.js`,
  `disc-data.js`, `lyrics.js`, `same-name`-like pure modules — list them explicitly); `npm test` pass; full Russian run
  through every screen once more; commit `"How to translate CDPlayer, and the languages in the README"`.
