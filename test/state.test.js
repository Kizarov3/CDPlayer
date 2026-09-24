'use strict';
// State files must stay line-compatible with the original Java CDPlayer so existing users keep their data.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const store = require('../src/main/store');
const library = require('../src/main/library');
const { parseRange } = require('../src/main/media-protocol');

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('reads a settings.txt written by the Java version', () => {
  fs.writeFileSync(path.join(home, 'settings.txt'), '70\n5\n1\n0\nOCEAN\n6.0,5.0,4.0,2.0,0.0,0.0,0.0,0.0,0.0,0.0\n0\n0\n10,20,1200,900\n0\n');
  const s = store.readSettings();
  assert.deepStrictEqual(s, {
    volume: 70, crossfade: 5, mono: true, animations: false, theme: 'OCEAN', eq: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
    waveform: false, miniMode: false, bounds: { x: 10, y: 20, width: 1200, height: 900 }, ambient: false,
  });
});

test('old, shorter settings files keep defaults for the newer lines', () => {
  fs.writeFileSync(path.join(home, 'settings.txt'), '40\n0\n0\n');
  const s = store.readSettings();
  assert.strictEqual(s.volume, 40);
  assert.strictEqual(s.animations, true);
  assert.strictEqual(s.waveform, true);
  assert.strictEqual(s.ambient, true);
  assert.strictEqual(s.theme, 'RED');
});

test('settings round-trip in the Java line format', () => {
  const s = { ...store.DEFAULT_SETTINGS, volume: 55, theme: 'SNOW', eq: [1, 0, 0, 0, 0, 0, 0, 0, 0, -2.5] };
  store.writeSettings(s);
  const text = fs.readFileSync(path.join(home, 'settings.txt'), 'utf8').split('\n');
  assert.strictEqual(text[0], '55');
  assert.strictEqual(text[5], '1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,-2.5');
  assert.deepStrictEqual(store.readSettings().eq, s.eq);
});

test('queue restore drops missing files and keeps pointing at the same track', () => {
  const a = path.join(home, 'a.mp3'), c = path.join(home, 'c.mp3');
  fs.writeFileSync(a, ''); fs.writeFileSync(c, '');
  fs.writeFileSync(path.join(home, 'queue.txt'), `2,1500000\n${a}\n${path.join(home, 'missing.mp3')}\n${c}\n`);
  assert.deepStrictEqual(store.readQueue(), { paths: [a, c], index: 1, positionMicros: 1500000 });
  store.writeQueue({ paths: [c, a], index: 0, positionMicros: 42.4 });
  assert.deepStrictEqual(store.readQueue(), { paths: [c, a], index: 0, positionMicros: 42 });
});

test('EQ presets and history round-trip', () => {
  store.writeEqPresets([{ name: 'Mine | tweaked', gains: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }]);
  assert.deepStrictEqual(store.readEqPresets(), [{ name: 'Mine | tweaked', gains: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }]);
  const a = path.join(home, 'a.mp3');
  store.writeHistory([a, path.join(home, 'gone.mp3')]);
  assert.deepStrictEqual(store.readHistory(), [a]);
});

test('M3U save/load keeps order and resolves relative paths', () => {
  const dir = fs.mkdtempSync(path.join(home, 'pl-'));
  const one = path.join(dir, '1.mp3'), two = path.join(dir, 'sub', '2.flac');
  fs.mkdirSync(path.dirname(two)); fs.writeFileSync(one, ''); fs.writeFileSync(two, '');
  const m3u = library.formatM3u([{ path: two, display: 'B' }, { path: one, display: 'A' }]);
  assert.ok(m3u.startsWith('#EXTM3U\n#EXTINF:-1,B\n'));
  const pl = path.join(dir, 'list.m3u');
  assert.deepStrictEqual(library.parseM3u(m3u, pl), [two, one]);
  assert.deepStrictEqual(library.parseM3u('#EXTM3U\nsub/2.flac\n1.mp3\nnope.mp3\n', pl), [two, one]);
});

test('library imports: Spotify CSV and JSON, iTunes XML', () => {
  assert.deepStrictEqual(library.parseSpotifyCsv('"Track URI","Track Name","Artist Name(s)"\nx,"Hello, World","Ann, Bob"\ny,Solo,\n'),
    [{ title: 'Hello, World', artist: 'Ann' }, { title: 'Solo', artist: '' }]);
  assert.deepStrictEqual(library.parseSpotifyJson('{"tracks":[{"artist":"A","album":"B","track":"T","uri":"u"}]}'), [{ title: 'T', artist: 'A' }]);
  const song = path.join(home, 'a.mp3');
  const url = `file://localhost${song.split(path.sep).map(encodeURIComponent).join('/')}`.replace('localhost%3A', 'localhost/');
  if (process.platform !== 'win32') {
    const xml = `<plist><dict><key>Location</key><string>${url.replace(/&/g, '&amp;')}</string></dict></plist>`;
    assert.deepStrictEqual(library.parseItunesLibrary(xml), [song]);
  }
});

test('HTTP range parsing for seeking', () => {
  assert.deepStrictEqual(parseRange('bytes=0-', 100), { start: 0, end: 99 });
  assert.deepStrictEqual(parseRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepStrictEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepStrictEqual(parseRange('bytes=50-500', 100), { start: 50, end: 99 });
  assert.strictEqual(parseRange('bytes=200-', 100), 'invalid');
  assert.strictEqual(parseRange(null, 100), null);
});
