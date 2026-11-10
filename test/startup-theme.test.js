'use strict';
// The theme the window opens in, from main (startup-theme.js), and themes of your own that a built-in name added later
// (WHITE) would hide: given a name of their own at startup, the saved choice following them.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-startup-theme-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const themes = require('../src/main/user-themes');
const store = require('../src/main/store');
const { lightPalette, paletteArg, hex, WHITE } = require('../src/main/startup-theme');

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const colors = (bg) => ({ bg, card: [20, 20, 20], accent: [200, 40, 40], accent2: [150, 150, 150], text: [240, 240, 240], muted: [150, 150, 150] });
const theme = (name, bg) => ({ cdtheme: 1, name, scene: 'BARS', image: null, blur: 0, dim: 30, colors: colors(bg) });
// (a file as an older version left it: a theme of its own called WHITE, before WHITE was built in)
const writeOld = (name, bg) => {
  fs.mkdirSync(path.join(home, 'themes'), { recursive: true });
  fs.writeFileSync(path.join(home, 'themes', `old-${name.replace(/\W/g, '')}.cdtheme`), JSON.stringify(theme(name, bg)));
};

test('lightPalette: WHITE, or a theme of your own with a light background; a dark one, AUTO, RED or none is null', () => {
  const mine = [theme('PAPER', [240, 236, 228]), theme('INK', [12, 12, 30])];
  assert.deepStrictEqual(lightPalette('WHITE', mine), WHITE);
  assert.deepStrictEqual(lightPalette('PAPER', mine), colors([240, 236, 228]));
  for (const name of ['INK', 'RED', 'AUTO', 'MISSING', undefined]) assert.strictEqual(lightPalette(name, mine), null, String(name));
  // a built-in name is the built-in theme, as the page picks it, even if a theme of your own has it too
  assert.strictEqual(lightPalette('RED', [theme('RED', [250, 250, 250])]), null);
  assert.deepStrictEqual(lightPalette('WHITE', [theme('WHITE', [10, 10, 10])]), WHITE);
});

test('paletteArg and hex: digits, commas and semicolons only, in bg card accent accent2 text muted order', () => {
  assert.strictEqual(paletteArg(WHITE), '251,251,252;255,255,255;224,68,46;112,116,123;42,44,48;112,116,123');
  assert.strictEqual(hex(WHITE.bg), '#fbfbfc');
  assert.strictEqual(hex([17, 17, 19]), '#111113');
});

test('a theme of your own called WHITE from before is kept as WHITE 2, its colours and all; the others are left alone', () => {
  writeOld('WHITE', [30, 10, 40]);
  themes.save(theme('MINE', [5, 5, 5]));
  const renamed = themes.freeBuiltinNames();
  assert.deepStrictEqual(renamed, { WHITE: 'WHITE 2' });
  const names = themes.list().map((t) => t.name);
  assert.deepStrictEqual(names, ['MINE', 'WHITE 2']);
  assert.deepStrictEqual(themes.list().find((t) => t.name === 'WHITE 2').colors, colors([30, 10, 40]));
  assert.deepStrictEqual(themes.freeBuiltinNames(), {}, 'done once: nothing left to rename next time');
  assert.deepStrictEqual(themes.list().map((t) => t.name), ['MINE', 'WHITE 2']);
});

test('the next free number when WHITE 2 is taken already', () => {
  writeOld('WHITE', [1, 2, 3]);
  assert.deepStrictEqual(themes.freeBuiltinNames(), { WHITE: 'WHITE 3' });
  themes.remove('WHITE 3');
});

test('the saved choice follows the theme to its new name (as main does at startup), and reads back from settings.txt', () => {
  writeOld('WHITE', [200, 220, 240]);
  store.writeSettings({ ...store.readSettings(), theme: 'WHITE' });
  let settings = store.readSettings();
  assert.strictEqual(settings.theme, 'WHITE');
  const renamed = themes.freeBuiltinNames();
  if (renamed[settings.theme]) { settings = { ...settings, theme: renamed[settings.theme] }; store.writeSettings(settings); }
  assert.strictEqual(store.readSettings().theme, 'WHITE 3');
  assert.strictEqual(fs.readFileSync(path.join(home, 'settings.txt'), 'utf8').split(/\r?\n/)[4], 'WHITE 3');
  // a light theme of your own: the window opens light in its colours, not WHITE's
  assert.deepStrictEqual(lightPalette(store.readSettings().theme, themes.list()), colors([200, 220, 240]));
});
