// COPY REPORT: what a bug report needs, without the music's paths.
import test from 'node:test';
import assert from 'node:assert';
import { scrub, note, recent, buildReport } from '../src/renderer/js/report.js';

test('paths and web addresses go; CDPlayer’s own code keeps its file and line', () => {
  assert.strictEqual(scrub('TypeError: x is undefined at load (cdp://app/js/app.js:1234:5)'), 'TypeError: x is undefined at load (app.js:1234)');
  assert.strictEqual(scrub("ENOENT: open '/Users/sam/Music/Björk/01 Joga.flac'"), "ENOENT: open '<path>'");
  assert.strictEqual(scrub('C:\\Users\\Sam\\Music\\a.mp3 failed'), '<path>'); // (unquoted: up to the next ·, spaces and all)
  assert.strictEqual(scrub('fetch https://music.youtube.com/watch?v=abc failed'), 'fetch <address> failed');
  assert.strictEqual(scrub('/home/sam/a.flac and ~/Music/b.flac'), '<path>');
  assert.strictEqual(scrub('NOW SPINNING'), 'NOW SPINNING');
  assert.strictEqual(scrub('RIP FAILED · /USERS/SAM/MUSIC/SOME ARTIST/A.FLAC'), 'RIP FAILED · <path>');
  assert.strictEqual(scrub('read /data/Music/Some Artist/Song.mp3 · then'), 'read <path>· then');
  assert.strictEqual(scrub('\\\\nas\\music\\a.flac'), '<path>');
  assert.strictEqual(scrub("ENOENT: open '/Users/sam/Music/Guns N' Roses/01 Welcome.flac'"), "ENOENT: open '<path>'");
  assert.strictEqual(scrub('TRACK 1 / 14 · J/L'), 'TRACK 1 / 14 · J/L');
});

test('the report: the system, the sound, what is in, and the last things said', () => {
  note('status', 'NOW SPINNING', Date.parse('2026-10-25T10:00:00Z'));
  note('status', 'NOW SPINNING', Date.parse('2026-10-25T10:00:01Z')); // said again: once
  note('error', 'Error at cdp://app/js/audio.js:10:2', Date.parse('2026-10-25T10:00:02Z'));
  assert.strictEqual(recent().length, 2);
  const text = buildReport({
    version: '2.20.0', os: 'darwin 15.1 arm64', electron: '38.0.0', chrome: '140', language: 'ru', folders: 2, streaming: true, ytdlp: '2026.10.21',
    output: 'MACBOOK AIR SPEAKERS', rate: { fileRate: 44100, aimed: 44100, deviceRate: 48000, switched: false, bluetooth: false },
    quality: 'HIGH', transition: 'GAPLESS', eq: true, mono: false, spatial: true, spatialAmount: 50, soundCheck: 'OFF', discNoise: false,
    playing: { kind: 'file', format: 'FLAC · 16-BIT · 44.1 KHZ', state: 'playing' },
  });
  assert.strictEqual(text, [
    'CDPlayer 2.20.0 · darwin 15.1 arm64 · Electron 38.0.0 (Chrome 140)',
    'Language: ru · Music folders: 2 · Streaming: on (yt-dlp 2026.10.21)',
    'Output: MACBOOK AIR SPEAKERS · song 44.1 kHz → aimed 44.1 kHz · device 48 kHz',
    'Quality: HIGH · Transition: GAPLESS · EQ: on · Mono: off · Spatial: on 50% · Sound check: OFF · Disc noise: off',
    'In: file · FLAC · 16-BIT · 44.1 KHZ · playing',
    '', 'Lately:', '10:00:00 NOW SPINNING', '10:00:02 ERROR Error at audio.js:10',
  ].join('\n'));
});

test("the person's names — an output's, who's signed in where — are taken out", () => {
  const text = buildReport({ output: 'system default', names: ["Sam's AirPods", 'sam_listens', null] },
    [{ at: 0, kind: 'status', text: "PLAYING ON SAM'S AIRPODS" }, { at: 0, kind: 'status', text: 'SCROBBLING TO LAST.FM AS sam_listens' }]);
  assert.ok(text.includes('PLAYING ON <name>') && text.includes('LAST.FM AS <name>'), text);
  assert.ok(!/sam/i.test(text), text);
});
