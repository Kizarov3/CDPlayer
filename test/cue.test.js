'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const cue = require('../src/main/cue');
const library = require('../src/main/library');
const store = require('../src/main/store');
const { describeFormat } = require('../src/main/audio-format');

const music = path.join(home, 'music');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const SHEET = `REM GENRE Rock
PERFORMER "The Band"
TITLE "Live at the "Hall""
FILE "Album.wav" WAVE
  TRACK 01 AUDIO
    TITLE "Opening"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Second Song"
    PERFORMER "Guest Singer"
    INDEX 00 03:58:00
    INDEX 01 04:00:37
  TRACK 03 AUDIO
    TITLE "Encore"
    INDEX 01 09:12:74
`;

function album(name, sheet = SHEET, audioName = 'Album.flac') {
  const dir = path.join(music, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, audioName), 'not really audio');
  fs.writeFileSync(path.join(dir, 'Album.cue'), sheet);
  return dir;
}

test('parses titles, performers and CD-frame INDEX times', () => {
  const s = cue.parseCue(SHEET);
  assert.strictEqual(s.title, 'Live at the "Hall"');
  assert.strictEqual(s.performer, 'The Band');
  assert.deepStrictEqual(s.tracks.map((t) => [t.number, t.title, t.performer, t.file]), [
    [1, 'Opening', null, 'Album.wav'], [2, 'Second Song', 'Guest Singer', 'Album.wav'], [3, 'Encore', null, 'Album.wav'],
  ]);
  assert.strictEqual(s.tracks[1].start, 4 * 60 + 37 / 75); // INDEX 01, not the pregap's INDEX 00
  assert.strictEqual(s.tracks[2].start, 9 * 60 + 12 + 74 / 75);
});

test('skips data tracks; unquoted FILE names and CRLF line endings work', () => {
  const s = cue.parseCue('FILE disc.bin BINARY\r\n  TRACK 01 MODE1/2352\r\n    INDEX 01 00:00:00\r\nFILE song.flac WAVE\r\n  TRACK 02 AUDIO\r\n    INDEX 01 00:00:00\r\n');
  assert.deepStrictEqual(s.tracks.map((t) => [t.number, t.file]), [[2, 'song.flac']]);
});

test('reads cue sheets saved as UTF-8, Windows-1251 Cyrillic, Windows-1252 and UTF-16', () => {
  const cyrillic = 'TITLE "Кино"';
  assert.strictEqual(cue.decodeText(Buffer.from(cyrillic, 'utf8')), cyrillic);
  const cp1251 = Buffer.from([...Buffer.from('TITLE "'), 0xca, 0xe8, 0xed, 0xee, 0x22]);
  assert.strictEqual(cue.decodeText(cp1251), cyrillic);
  const cp1252 = Buffer.from([...Buffer.from('TITLE "Beyonc'), 0xe9, 0x22]);
  assert.strictEqual(cue.decodeText(cp1252), 'TITLE "Beyoncé"');
  assert.strictEqual(cue.decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(cyrillic, 'utf16le')])), cyrillic);
});

test('tracks run from their INDEX 01 to the next one; the last runs to the end of the file', async () => {
  const dir = album('one');
  const tracks = await cue.readCueSheet(path.join(dir, 'Album.cue'));
  // The sheet says Album.wav, but the album was re-encoded to FLAC since: that file is found instead.
  assert.ok(tracks.every((t) => t.file === path.join(dir, 'Album.flac')));
  assert.deepStrictEqual(tracks.map((t) => [t.ref, t.start, t.end]), [
    [`${path.join(dir, 'Album.cue')}#1`, 0, 240 + 37 / 75],
    [`${path.join(dir, 'Album.cue')}#2`, 240 + 37 / 75, 552 + 74 / 75],
    [`${path.join(dir, 'Album.cue')}#3`, 552 + 74 / 75, null],
  ]);
  assert.strictEqual(tracks[1].performer, 'Guest Singer');
  assert.strictEqual(tracks[2].performer, 'The Band');
  assert.strictEqual(tracks[0].album, 'Live at the "Hall"');
  assert.strictEqual((await cue.resolveRef(`${path.join(dir, 'Album.cue')}#2`)).title, 'Second Song');
  assert.strictEqual(await cue.resolveRef(`${path.join(dir, 'Album.cue')}#9`), null);
});

test('a cue sheet whose audio is missing yields no tracks', async () => {
  const dir = path.join(music, 'orphan');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Other.cue'), SHEET);
  assert.deepStrictEqual(await cue.readCueSheet(path.join(dir, 'Other.cue')), []);
});

test('dropping a folder queues the cue tracks instead of the album-length file', async () => {
  const dir = album('two');
  fs.writeFileSync(path.join(dir, 'bonus.mp3'), 'x');
  const labels = {};
  const found = await library.collectAudio([dir], labels);
  const sheet = path.join(dir, 'Album.cue');
  assert.deepStrictEqual(found.sort(library.byName), [`${sheet}#1`, `${sheet}#2`, `${sheet}#3`, path.join(dir, 'bonus.mp3')]);
  assert.strictEqual(labels[`${sheet}#2`], 'Album · 02 Second Song');
  // Picking the .cue and the .flac together is the same thing.
  const picked = await library.collectAudio([sheet, path.join(dir, 'Album.flac')]);
  assert.deepStrictEqual(picked, [`${sheet}#1`, `${sheet}#2`, `${sheet}#3`]);
});

test('library search index labels cue tracks by name', async () => {
  const dir = album('three');
  const { files, labels } = await library.scanLibrary(dir);
  assert.strictEqual(files.length, 3);
  assert.strictEqual(labels[`${path.join(dir, 'Album.cue')}#3`], 'Album · 03 Encore');
});

test('cue tracks survive the saved queue, history and M3U playlists', async () => {
  const dir = album('four');
  const ref = `${path.join(dir, 'Album.cue')}#2`;
  const plain = path.join(dir, 'Album.flac');
  store.writeQueue({ paths: [plain, ref], index: 1, positionMicros: 5e6 });
  assert.deepStrictEqual(store.readQueue(), { paths: [plain, ref], index: 1, positionMicros: 5e6 });
  store.writeHistory([ref, `${path.join(dir, 'Gone.cue')}#1`]);
  assert.deepStrictEqual(store.readHistory(), [ref]);
  const list = path.join(dir, 'list.m3u');
  fs.writeFileSync(list, library.formatM3u([{ path: ref, display: 'Second Song' }]) + 'Album.cue#3\n');
  assert.deepStrictEqual(library.parseM3u(fs.readFileSync(list, 'utf8'), list), [ref, `${path.join(dir, 'Album.cue')}#3`]);
});

test('queue references: only "<file>.cue#<number>" is a cue track', () => {
  assert.deepStrictEqual(cue.parseRef('/m/a.cue#12'), { cuePath: '/m/a.cue', number: 12 });
  assert.strictEqual(cue.parseRef('/m/Track #1.flac'), null);
  assert.strictEqual(cue.parseRef('/m/a.cue'), null);
});

test('audio quality readout', () => {
  assert.strictEqual(describeFormat({ codec: 'FLAC', container: 'FLAC', lossless: true, bitsPerSample: 24, sampleRate: 96000, numberOfChannels: 2 }, 'FLAC'), 'FLAC · 24-BIT · 96 KHZ');
  assert.strictEqual(describeFormat({ codec: 'ALAC', lossless: true, bitsPerSample: 16, sampleRate: 44100, numberOfChannels: 2 }, 'M4A'), 'ALAC · 16-BIT · 44.1 KHZ');
  assert.strictEqual(describeFormat({ codec: 'non-PCM (65534)', container: 'WAVE', lossless: true, bitsPerSample: 24, sampleRate: 48000 }, 'WAV'), 'WAV · 24-BIT · 48 KHZ');
  assert.strictEqual(describeFormat({ codec: 'MPEG 1 Layer 3', lossless: false, bitrate: 320000, numberOfChannels: 2 }, 'MP3'), 'MP3 · 320 KBPS');
  assert.strictEqual(describeFormat({ codec: 'MPEG-4/AAC', lossless: false, bitrate: 255_600, numberOfChannels: 1 }, 'M4A'), 'AAC · 256 KBPS · MONO');
  assert.strictEqual(describeFormat({ codec: 'Opus', sampleRate: 48000 }, 'OGG'), 'OPUS');
  assert.strictEqual(describeFormat(null, 'AU'), 'AU');
});

test('website tags and video-site noise come off track names; "Artist - Title" filenames are split', () => {
  const { cleanTrackName, parseFilename, searchVariants } = require('../src/main/track-names');
  assert.strictEqual(cleanTrackName('Got The Life (mp3.pm)'), 'Got The Life');
  assert.strictEqual(cleanTrackName('Numb [muzmo.ru]'), 'Numb');
  assert.strictEqual(cleanTrackName('Song www.zaycev.net'), 'Song');
  assert.strictEqual(cleanTrackName('Korn - Got The Life - mp3.pm'), 'Korn - Got The Life');
  assert.strictEqual(cleanTrackName('Freak On a Leash (Official Music Video) [HD]'), 'Freak On a Leash');
  assert.strictEqual(cleanTrackName('Blind (Lyrics) 320 kbps'), 'Blind');
  assert.strictEqual(cleanTrackName('Still D.R.E. (feat. Snoop Dogg)'), 'Still D.R.E. (feat. Snoop Dogg)');
  assert.strictEqual(cleanTrackName('Money (Pt.2)'), 'Money (Pt.2)');
  assert.strictEqual(cleanTrackName('Meet Me in St.Louis'), 'Meet Me in St.Louis');
  assert.strictEqual(cleanTrackName('Video Killed the Radio Star'), 'Video Killed the Radio Star');
  assert.strictEqual(cleanTrackName('(mp3.pm)'), '(mp3.pm)'); // never cleaned down to nothing
  assert.deepStrictEqual(parseFilename('/m/Korn - Got The Life (mp3.pm).mp3'), { artist: 'Korn', title: 'Got The Life' });
  assert.deepStrictEqual(parseFilename('/m/Korn Got The Life (mp3.pm).mp3'), { artist: null, title: 'Korn Got The Life' });
  assert.deepStrictEqual(parseFilename('/m/01 - Korn - Freak On a Leash.mp3'), { artist: 'Korn', title: 'Freak On a Leash' });
  assert.deepStrictEqual(parseFilename('/m/03 Blind.flac'), { artist: null, title: 'Blind' });
  assert.deepStrictEqual(parseFilename('/m/Twenty_One_Pilots_-_Heathens.mp3'), { artist: 'Twenty One Pilots', title: 'Heathens' });
  assert.deepStrictEqual(parseFilename('/m/korn-got-the-life-mp3.pm.mp3'), { artist: null, title: 'korn got the life' });
  assert.deepStrictEqual(searchVariants('Korn Got The Life (Remastered 2011) (mp3.pm)'), ['Korn Got The Life (Remastered 2011)', 'Korn Got The Life']);
  assert.deepStrictEqual(searchVariants('Eminem Stan feat. Dido'), ['Eminem Stan feat. Dido', 'Eminem Stan']);
});
