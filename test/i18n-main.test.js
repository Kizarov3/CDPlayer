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
  // a system with a script in its tag still finds a file named by language and region
  assert.strictEqual(i18n.resolveLocale('AUTO', ['zh-Hant-TW'], ['zh-TW', 'zh']), 'zh-TW');
  assert.strictEqual(i18n.resolveLocale('AUTO', ['zh-Hans-CN'], ['zh-TW', 'zh']), 'zh');
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

test('the Spotify wizard\'s advice comes in the interface\'s language', () => {
  const spotify = require('../src/main/spotify');
  i18n.loadLocale('ru', []);
  try {
    for (const code of ['BAD_KEYS', 'NO_ANSWER', 'NOT_REGISTERED', 'NO_PREMIUM', 'ANYTHING']) assert.match(spotify.diagnose(code).text, /[а-я]/, code);
  } finally { i18n.loadLocale('en', []); }
  assert.match(spotify.diagnose('BAD_KEYS').text, /^Spotify doesn’t know/);
});
