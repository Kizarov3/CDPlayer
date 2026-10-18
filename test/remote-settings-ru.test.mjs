// Settings → PHONE REMOTE in Russian: the page's dictionary is read as i18n.js loads, so it's handed over (as the
// preload does) before the modules are imported.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

globalThis.window = { cdp: { i18nDict: () => ({ code: 'ru', dict: JSON.parse(fs.readFileSync('src/locales/ru.json', 'utf8')) }) } };
const { phoneLine, phoneTagTitle } = await import('../src/renderer/js/remote-settings.js');

test('a phone named by its browser is named in the interface\'s language; iPhone and Android stay as they are', () => {
  const since = new Date(2026, 9, 17, 23, 10).getTime();
  assert.match(phoneLine({ name: 'Browser', since }), /^Браузер /);
  assert.match(phoneLine({ name: 'iPhone', since }), /^iPhone /);
  assert.strictEqual(phoneTagTitle([{ name: 'Browser' }, { name: 'Browser' }, { name: 'Android' }]), 'Браузер ×2, Android');
});
