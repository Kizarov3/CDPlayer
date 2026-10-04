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
    waveform: false, miniMode: false, bounds: { x: 10, y: 20, width: 1200, height: 900 }, ambient: false, discord: true,
    discNoise: false, saveFound: false, lyricsOffset: 0, shelfSort: 'ARTIST', discWear: true, output: null, language: 'AUTO', quality: 'HIGH', spatial: false, spatialAmount: 50, discShine: true, taskbarDisc: process.platform !== 'win32', soundCheck: 'OFF',
  });
});

test('SOUND CHECK is off unless turned on, and survives a save', () => {
  fs.writeFileSync(path.join(home, 'settings.txt'), '70\n5\n1\n0\nOCEAN\n0,0,0,0,0,0,0,0,0,0\n0\n0\n\n0\n1\n');
  assert.strictEqual(store.readSettings().soundCheck, 'OFF');
  for (const mode of ['ALBUM', 'TRACK', 'OFF']) {
    store.writeSettings({ ...store.readSettings(), soundCheck: mode });
    assert.strictEqual(store.readSettings().soundCheck, mode);
  }
  store.writeSettings({ ...store.readSettings(), soundCheck: 'LOUD' });
  assert.strictEqual(store.readSettings().soundCheck, 'OFF');
});

test('disc noise is off unless turned on, and survives a save', () => {
  fs.writeFileSync(path.join(home, 'settings.txt'), '70\n5\n1\n0\nOCEAN\n0,0,0,0,0,0,0,0,0,0\n0\n0\n\n0\n1\n');
  assert.strictEqual(store.readSettings().discNoise, false);
  store.writeSettings({ ...store.readSettings(), discNoise: true });
  assert.strictEqual(store.readSettings().discNoise, true);
});

test('old, shorter settings files keep defaults for the newer lines', () => {
  fs.writeFileSync(path.join(home, 'settings.txt'), '40\n0\n0\n');
  const s = store.readSettings();
  assert.strictEqual(s.volume, 40);
  assert.strictEqual(s.animations, true);
  assert.strictEqual(s.waveform, true);
  assert.strictEqual(s.ambient, true);
  assert.strictEqual(s.discord, true);
  assert.strictEqual(s.theme, 'RED');
});

test('Discord status is the 11th settings line', () => {
  store.writeSettings({ ...store.DEFAULT_SETTINGS, discord: false });
  assert.strictEqual(fs.readFileSync(path.join(home, 'settings.txt'), 'utf8').split('\n')[10], '0');
  assert.strictEqual(store.readSettings().discord, false);
  store.writeSettings({ ...store.DEFAULT_SETTINGS });
  assert.strictEqual(store.readSettings().discord, true);
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

test('lyrics offset is the 14th settings line, in steps of 50 ms within ±500', () => {
  store.writeSettings({ ...store.DEFAULT_SETTINGS, lyricsOffset: -150 });
  assert.strictEqual(fs.readFileSync(path.join(home, 'settings.txt'), 'utf8').split('\n')[13], '-150');
  assert.strictEqual(store.readSettings().lyricsOffset, -150);
  fs.writeFileSync(path.join(home, 'settings.txt'), '70\n0\n0\n1\nRED\n0,0,0,0,0,0,0,0,0,0\n1\n0\n\n1\n1\n0\n0\n9000\n');
  assert.strictEqual(store.readSettings().lyricsOffset, 500);
  fs.writeFileSync(path.join(home, 'settings.txt'), '70\n0\n0\n1\nRED\n0,0,0,0,0,0,0,0,0,0\n1\n0\n\n1\n1\n0\n0\n130\n');
  assert.strictEqual(store.readSettings().lyricsOffset, 150);
});

test('how the shelf is sorted is the 15th settings line; anything unknown is by artist', () => {
  store.writeSettings({ ...store.DEFAULT_SETTINGS, shelfSort: 'YEAR' });
  assert.strictEqual(fs.readFileSync(path.join(home, 'settings.txt'), 'utf8').split('\n')[14], 'YEAR');
  assert.strictEqual(store.readSettings().shelfSort, 'YEAR');
  fs.writeFileSync(path.join(home, 'settings.txt'), '70\n0\n0\n1\nRED\n0,0,0,0,0,0,0,0,0,0\n1\n0\n\n1\n1\n0\n0\n0\nWHATEVER\n');
  assert.strictEqual(store.readSettings().shelfSort, 'ARTIST');
});

test('disc wear is the 16th settings line, on unless turned off', () => {
  fs.writeFileSync(path.join(home, 'settings.txt'), '70\n0\n0\n1\nRED\n0,0,0,0,0,0,0,0,0,0\n1\n0\n\n1\n1\n0\n0\n0\nARTIST\n');
  assert.strictEqual(store.readSettings().discWear, true);
  store.writeSettings({ ...store.DEFAULT_SETTINGS, discWear: false });
  assert.strictEqual(fs.readFileSync(path.join(home, 'settings.txt'), 'utf8').split('\n')[15], '0');
  assert.strictEqual(store.readSettings().discWear, false);
});

test('when each track was last played, newest last, in lastplayed.txt', () => {
  store.writeLastPlayed(new Map([['/m/a.mp3', 1000], ['/m/b.flac', 2000]]));
  assert.strictEqual(fs.readFileSync(path.join(home, 'lastplayed.txt'), 'utf8'), '1000\t/m/a.mp3\n2000\t/m/b.flac\n');
  assert.deepStrictEqual([...store.readLastPlayed()], [['/m/a.mp3', 1000], ['/m/b.flac', 2000]]);
  fs.writeFileSync(path.join(home, 'lastplayed.txt'), 'junk\n5\t\nx\t/m/c.mp3\n3000\t/m/d.mp3\n');
  assert.deepStrictEqual([...store.readLastPlayed()], [['/m/d.mp3', 3000]]);
});

test('dust.txt: since when dust has gathered, and when each album was wiped', () => {
  fs.rmSync(path.join(home, 'dust.txt'), { force: true });
  assert.deepStrictEqual(store.readDust(), { since: null, wiped: new Map() });
  const id = 'korn\nfollow the leader\n';
  store.writeDust({ since: 500, wiped: new Map([[id, 900]]) });
  assert.deepStrictEqual(store.readDust(), { since: 500, wiped: new Map([[id, 900]]) });
});

test('notes.txt: a note per album, any text in it; an empty note takes it off', () => {
  const id = 'tool\nlateralus\n', other = 'korn\nissues\n';
  store.writeNotes(new Map([[id, 'For the long drive\n\tnorth — «ночью»'], [other, 'lend to Sam']]));
  assert.deepStrictEqual(store.readNotes(), new Map([[id, 'For the long drive\n\tnorth — «ночью»'], [other, 'lend to Sam']]));
  store.writeNotes(new Map([[id, ''], [other, 'lend to Sam']]));
  assert.deepStrictEqual(store.readNotes(), new Map([[other, 'lend to Sam']]));
  fs.writeFileSync(path.join(home, 'notes.txt'), 'garbage\n"x"\t\n');
  assert.deepStrictEqual(store.readNotes(), new Map());
});

test('missing-hidden.txt: the release groups said NOT INTERESTED to, one per line, only real IDs', () => {
  const a = 'b1392450-e666-3926-a536-22c65f834433', b = '163339ab-813b-3d29-bba8-e1d5acf63cab';
  store.writeHiddenMissing(new Set([a, b, 'junk', `${a}\nevil`]));
  assert.strictEqual(fs.readFileSync(path.join(home, 'missing-hidden.txt'), 'utf8'), `${a}\n${b}\n`);
  assert.deepStrictEqual(store.readHiddenMissing(), new Set([a, b]));
  fs.writeFileSync(path.join(home, 'missing-hidden.txt'), `\n  ${b}  \nrg-3\n\n`);
  assert.deepStrictEqual(store.readHiddenMissing(), new Set([b]));
});

test('wrap.txt: since when new albums come shrink-wrapped, and the ones unwrapped by hand', () => {
  fs.rmSync(path.join(home, 'wrap.txt'), { force: true });
  assert.deepStrictEqual(store.readWrap(), { since: null, torn: new Set() });
  const id = 'korn\nissues\n';
  store.writeWrap({ since: 700, torn: new Set([id]) });
  assert.deepStrictEqual(store.readWrap(), { since: 700, torn: new Set([id]) });
});

test('firstplayed.txt: when each track was first played, kept like lastplayed.txt', () => {
  store.writeFirstPlayed(new Map([['/m/a.mp3', 1000], ['/m/b.flac', 2000]]));
  assert.strictEqual(fs.readFileSync(path.join(home, 'firstplayed.txt'), 'utf8'), '1000\t/m/a.mp3\n2000\t/m/b.flac\n');
  assert.deepStrictEqual([...store.readFirstPlayed()], [['/m/a.mp3', 1000], ['/m/b.flac', 2000]]);
});

test('the shelf can be sorted by colour, and that is remembered', () => {
  store.writeSettings({ ...store.DEFAULT_SETTINGS, shelfSort: 'COLOR' });
  assert.strictEqual(store.readSettings().shelfSort, 'COLOR');
});

test('shelf-colors.json: each album\'s spine and sorting colours, with the cover they came from', () => {
  fs.rmSync(path.join(home, 'shelf-colors.json'), { force: true });
  assert.deepStrictEqual(store.readShelfColors(), {});
  const colors = { 'korn\nissues\n': { key: 123, spine: [1, 2, 3], main: [200, 30, 30] } };
  store.writeShelfColors(colors);
  assert.deepStrictEqual(store.readShelfColors(), colors);
  fs.writeFileSync(path.join(home, 'shelf-colors.json'), 'not json');
  assert.deepStrictEqual(store.readShelfColors(), {});
});

test('the audio output is the 17th settings line: its id and name; none by default', () => {
  fs.writeFileSync(path.join(home, 'settings.txt'), '70\n0\n0\n1\nRED\n0,0,0,0,0,0,0,0,0,0\n1\n0\n\n1\n1\n0\n0\n0\nARTIST\n1\n');
  assert.strictEqual(store.readSettings().output, null);
  store.writeSettings({ ...store.DEFAULT_SETTINGS, output: { id: 'air2', label: 'AirPods Pro' } });
  assert.strictEqual(fs.readFileSync(path.join(home, 'settings.txt'), 'utf8').split('\n')[16], 'air2\tAirPods Pro');
  assert.deepStrictEqual(store.readSettings().output, { id: 'air2', label: 'AirPods Pro' });
});

test('the language: AUTO unless set, kept, odd values back to AUTO', () => {
  fs.writeFileSync(path.join(home, 'settings.txt'), '70\n5\n1\n0\nOCEAN\n');
  assert.strictEqual(store.readSettings().language, 'AUTO');
  store.writeSettings({ ...store.readSettings(), language: 'ru' });
  assert.strictEqual(store.readSettings().language, 'ru');
  store.writeSettings({ ...store.readSettings(), language: 'ru/../x' });
  assert.strictEqual(store.readSettings().language, 'AUTO');
});

test('the sound quality: HIGH unless set, kept, odd values back to HIGH', () => {
  store.writeSettings({ ...store.DEFAULT_SETTINGS });
  assert.strictEqual(store.readSettings().quality, 'HIGH');
  store.writeSettings({ ...store.readSettings(), quality: 'HIRES' });
  assert.strictEqual(store.readSettings().quality, 'HIRES');
  store.writeSettings({ ...store.readSettings(), quality: 'ULTRA' });
  assert.strictEqual(store.readSettings().quality, 'HIGH');
});

test('spatial audio: off and 50 unless set, kept, the amount held to 0–100', () => {
  store.writeSettings({ ...store.DEFAULT_SETTINGS });
  assert.deepStrictEqual([store.readSettings().spatial, store.readSettings().spatialAmount], [false, 50]);
  store.writeSettings({ ...store.readSettings(), spatial: true, spatialAmount: 80 });
  assert.deepStrictEqual([store.readSettings().spatial, store.readSettings().spatialAmount], [true, 80]);
  store.writeSettings({ ...store.readSettings(), spatialAmount: 400 });
  assert.strictEqual(store.readSettings().spatialAmount, 100);
});

test('the disc\'s shine is on unless turned off, and survives a save', () => {
  fs.writeFileSync(path.join(home, 'settings.txt'), '70\n5\n1\n0\nOCEAN\n0,0,0,0,0,0,0,0,0,0\n0\n0\n\n0\n1\n');
  assert.strictEqual(store.readSettings().discShine, true);
  store.writeSettings({ ...store.readSettings(), discShine: false });
  assert.strictEqual(store.readSettings().discShine, false);
  store.writeSettings({ ...store.readSettings(), discShine: true });
  assert.strictEqual(store.readSettings().discShine, true);
});

test('the disc on the app\'s icon: on unless turned off, but off on Windows (where it costs a working pin); kept either way', () => {
  fs.writeFileSync(path.join(home, 'settings.txt'), '70\n5\n1\n0\nOCEAN\n0,0,0,0,0,0,0,0,0,0\n0\n0\n\n0\n1\n');
  assert.strictEqual(store.readSettings().taskbarDisc, process.platform !== 'win32');
  store.writeSettings({ ...store.readSettings(), taskbarDisc: true });
  assert.strictEqual(store.readSettings().taskbarDisc, true);
  store.writeSettings({ ...store.readSettings(), taskbarDisc: false });
  assert.strictEqual(store.readSettings().taskbarDisc, false);
  assert.strictEqual(store.readSettings().discShine, true); // the line before it is untouched
});
