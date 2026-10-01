import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { collectStrings, sourceFiles, syncLocale, coverage, untranslated, hiddenT, CONVERTED, ALLOW } from '../scripts/i18n-collect.mjs';

test('collected: t() with a plain string in any quotes, and the pages\' marked text', () => {
  const keys = collectStrings([
    { path: 'a.js', text: "x(t('THEME')); t(\"SHELF\", { n }); t(`PLAY NEXT`); t(`A ${b}`); t(r.error); sqrt(2); t('IT\\'S')" },
    { path: 'p.html', text: '<span data-i18n>NOW PLAYING</span><button data-i18n-title title="Shuffle" id="s"></button><input placeholder="Find it" data-i18n-placeholder>' },
  ]);
  assert.deepStrictEqual(keys, ['Find it', "IT'S", 'NOW PLAYING', 'PLAY NEXT', 'SHELF', 'Shuffle', 'THEME']);
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

test('a t() hidden by a variable of the same name is found', () => {
  assert.deepStrictEqual(hiddenT("import { t } from './i18n.js';\nconst a = (t) => t('X');\nconst b = () => t('Y');\nfunction c(list) { for (const t of list) t('Z'); }"), [2, 4]);
  assert.deepStrictEqual(hiddenT("import { t } from './i18n.js';\nconst a = (t) => t + 1;\nt('X');"), []);
});

test('no t() in the code is hidden by a variable called t', () => {
  for (const file of sourceFiles('src').filter((f) => f.path.endsWith('.js') && /\bt\(['"`]/.test(f.text))) {
    assert.deepStrictEqual(hiddenT(file.text), [], file.path);
  }
});
