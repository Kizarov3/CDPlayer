import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { SETTING_ROWS, matchesName, findCommands } from '../src/renderer/js/search-commands.js';

test('the settings the search knows are the Settings panel’s rows, in its sections and its order', () => {
  const src = fs.readFileSync('src/renderer/js/panels.js', 'utf8');
  // (from its first section on — SPATIAL AUDIO's SPACE is made before it — and not CROSSFADE's LENGTH, only there with
  // it: both found with the row they belong to)
  const build = src.slice(src.indexOf("section(t('SOUND'))", src.indexOf('function buildSettings(')), src.indexOf('// ---- Drop-down menus'));
  const rows = [], phone = src.slice(src.indexOf('function phoneRemoteRows('), src.indexOf('function presetName('));
  let section = null;
  for (const m of build.matchAll(/section\(t\('([^']+)'\)\)|(?:row|sliderRow)\(t\('([^']+)'\)|\.\.\.phoneRemoteRows/g)) {
    if (m[1]) section = m[1];
    else if (m[2]) { if (m[2] !== 'LENGTH') rows.push([section, m[2]]); } else for (const p of phone.matchAll(/row\(t\('([^']+)'\)/g)) rows.push([section, p[1]]);
  }
  assert.deepStrictEqual(rows, SETTING_ROWS.map(([s, r]) => [s, r]));
});

test('found by the start of a word of its name, or of a word it goes by, every word typed', () => {
  assert.ok(matchesName('spat', ['SPATIAL AUDIO']));
  assert.ok(matchesName('aud spa', ['SPATIAL AUDIO']));
  assert.ok(matchesName('crossf', ['SPATIAL AUDIO', 'crossfeed headphones']));
  assert.ok(matchesName('объём', ['ПРОСТРАНСТВЕННЫЙ ЗВУК', 'кроссфид объёмный']));
  assert.ok(matchesName('обьем'.replace('ь', 'ъ'), ['объём']));
  assert.ok(!matchesName('tial', ['SPATIAL AUDIO'])); // not inside a word
  assert.ok(!matchesName('s', ['SPATIAL AUDIO'])); // one letter finds nothing
  assert.ok(!matchesName('', ['SPATIAL AUDIO']));
});

test('actions first, then settings, four at most', () => {
  const run = () => {};
  const actions = [{ label: 'SHUFFLE', also: 'random', run }, { label: 'MINI MODE', key: 'M', run }];
  assert.deepStrictEqual(findCommands('mini', actions).map((c) => [c.kind, c.label]), [['action', 'MINI MODE'], ['setting', 'MINI MODE']]);
  assert.deepStrictEqual(findCommands('random', actions).map((c) => c.label), ['SHUFFLE']);
  assert.deepStrictEqual(findCommands('crossfeed', actions)[0], { kind: 'setting', label: 'SPATIAL AUDIO', section: 'SOUND', row: 'SPATIAL AUDIO' });
  assert.strictEqual(findCommands('disc', actions).length, 4);
  assert.deepStrictEqual(findCommands('nirvana', actions), []);
});
