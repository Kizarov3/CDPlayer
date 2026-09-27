'use strict';
// Ripping a disc: files written, tagged and named; cancel and failures leave nothing half-written.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const { ripDisc, trackPcm, encodeChecked } = require('../src/main/rip');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const tone = (seconds, f) => { const n = Math.round(44100 * seconds), p = new Int16Array(n * 2); for (let i = 0; i < n; i++) { p[i * 2] = Math.round(9000 * Math.sin(i * f)); p[i * 2 + 1] = Math.round(7000 * Math.sin(i * f * 1.5)); } return p; };
const COVER = `data:image/jpeg;base64,${fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.png')).toString('base64')}`;
const disc = (n) => ({
  tracks: Array.from({ length: n }, (_, i) => ({ path: `cdda://F/${i + 1}`, title: i === 1 ? 'Pollution' : `Song ${i + 1}`, artist: 'Limp Bizkit', number: i + 1, disc: 1, discs: 1 })),
  album: { album: 'Three Dollar Bill, Yall$', albumArtist: 'Limp Bizkit', year: '1997', releaseId: 'rel-1', cover: COVER, discId: 'abc' },
});

test('encodeChecked: the worker\'s FLAC decodes back to the same audio', async () => {
  const flac = await encodeChecked(tone(0.5, 0.05));
  assert.strictEqual(flac.toString('ascii', 0, 4), 'fLaC');
});

test('a disc ripped: tagged FLAC files and cover.jpg in artist / album (year)', async () => {
  const music = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-music-'));
  const progress = [];
  const { folder, files } = await ripDisc({ ...disc(3), musicFolder: music, readPcm: async () => tone(1, 0.03), onProgress: (p) => progress.push(p) });
  assert.strictEqual(folder, path.join(music, 'Limp Bizkit', 'Three Dollar Bill, Yall$ (1997)'));
  assert.deepStrictEqual(fs.readdirSync(folder).sort(), ['01 Song 1.flac', '02 Pollution.flac', '03 Song 3.flac', 'cover.jpg']);
  assert.strictEqual(files.length, 3);
  const { parseFile } = await import('music-metadata');
  const m = await parseFile(path.join(folder, '02 Pollution.flac'));
  assert.strictEqual(m.common.title, 'Pollution');
  assert.strictEqual(m.common.album, 'Three Dollar Bill, Yall$');
  assert.strictEqual(m.common.albumartist, 'Limp Bizkit');
  assert.deepStrictEqual(m.common.track, { no: 2, of: 3 });
  assert.strictEqual(m.common.year, 1997);
  assert.ok(m.common.picture && m.common.picture.length, 'the cover is inside');
  assert.strictEqual(Math.round(m.format.duration), 1);
  assert.deepStrictEqual(progress[progress.length - 1], { done: 3, total: 3, percent: 100 });
  fs.rmSync(music, { recursive: true, force: true });
});

test('cancelled mid-disc: finished tracks kept, nothing half-written', async () => {
  const music = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-music-'));
  const ctl = new AbortController();
  let reads = 0;
  const readPcm = async () => { if (++reads === 2) ctl.abort(); return tone(0.5, 0.04); };
  await assert.rejects(ripDisc({ ...disc(3), musicFolder: music, signal: ctl.signal, readPcm }), (e) => e.reason === 'cancelled');
  const folder = path.join(music, 'Limp Bizkit', 'Three Dollar Bill, Yall$ (1997)');
  assert.deepStrictEqual(fs.readdirSync(folder).filter((f) => f.endsWith('.flac')), ['01 Song 1.flac']);
  assert.ok(!fs.readdirSync(folder).some((f) => f.startsWith('.')), 'no temp files');
  fs.rmSync(music, { recursive: true, force: true });
});

test('a write that fails stops with the reason; a disc that goes away says so', async () => {
  const music = fs.mkdtempSync(path.join(os.tmpdir(), 'rip-music-'));
  await assert.rejects(ripDisc({ ...disc(2), musicFolder: music, readPcm: async () => tone(0.2, 0.04), writeTags: async () => ({ ok: false, error: 'DISK FULL' }) }),
    (e) => e.reason === 'failed' && /DISK FULL/.test(e.message));
  assert.ok(!fs.readdirSync(path.join(music, 'Limp Bizkit', 'Three Dollar Bill, Yall$ (1997)')).some((f) => f.endsWith('.flac')));
  await assert.rejects(ripDisc({ ...disc(2), musicFolder: music, readPcm: async () => { const e = new Error('gone'); e.code = 'ENOENT'; throw e; } }), (e) => e.reason === 'disc-removed');
  fs.rmSync(music, { recursive: true, force: true });
});

test('trackPcm: a CD\'s AIFF track (macOS) as 16-bit stereo PCM', async () => {
  const pcm = await trackPcm(path.join(__dirname, 'fixtures', 'tone.aiff'));
  assert.ok(pcm instanceof Int16Array && pcm.length > 1000);
});
