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
