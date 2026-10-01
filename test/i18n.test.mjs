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

test('the same English in two places: "TEXT|context" shows as TEXT, and is translated on its own', () => {
  const d = { _locale: 'ru', NEXT: 'СЛЕДУЮЩАЯ', 'NEXT|step': 'ДАЛЕЕ' };
  assert.strictEqual(format(d, 'NEXT|step'), 'ДАЛЕЕ');
  assert.strictEqual(format(d, 'NEXT'), 'СЛЕДУЮЩАЯ');
  assert.strictEqual(format({}, 'NEXT|step'), 'NEXT');
  assert.strictEqual(format({}, '{n} OF|step', { n: 2 }), '2 OF');
  assert.strictEqual(require('../src/main/i18n-format.js').format({}, 'NEXT|step'), 'NEXT');
});
