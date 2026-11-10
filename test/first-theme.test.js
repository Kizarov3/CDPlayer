'use strict';
// test/first-theme.test.js — a new install follows the system's light/dark once; an existing one keeps its theme
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-first-theme-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const store = require('../src/main/store');
const { initialTheme } = require('../src/main/first-theme');

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('no settings yet: a light system gives WHITE, a dark one RED', () => {
  assert.strictEqual(initialTheme({ hasSettings: false, systemDark: false }), 'WHITE');
  assert.strictEqual(initialTheme({ hasSettings: false, systemDark: true }), 'RED');
});

test('settings already there: the theme is never overridden', () => {
  assert.strictEqual(initialTheme({ hasSettings: true, systemDark: false }), null);
  assert.strictEqual(initialTheme({ hasSettings: true, systemDark: true }), null);
});

test('a fresh data folder has no settings.txt; the Java app\'s 3-line file counts and keeps RED', () => {
  const f = store.file(store.FILES.settings);
  assert.strictEqual(store.isFile(f), false);
  fs.writeFileSync(f, '100\n0\n0\n');
  assert.strictEqual(store.isFile(f), true);
  assert.strictEqual(store.readSettings().theme, 'RED');
});
