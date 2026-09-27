'use strict';
// Writing tags, covers and lyrics into every format the player plays — on copies of the fixtures, in a temp folder.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeTags, readTags, canWrite } = require('../src/main/tag-writer');
const { decodeToWav } = require('../src/main/decoders');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-tags-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const fixture = (name) => path.join(__dirname, 'fixtures', name);
function copy(name) { const p = path.join(dir, name); fs.copyFileSync(fixture(name), p); return p; }
function pcmOf(wav) {
  for (let p = 12; p < wav.length;) {
    const id = wav.toString('ascii', p, p + 4), size = wav.readUInt32LE(p + 4);
    if (id === 'data') return wav.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

// A 1×1 PNG, as the cover.
const COVER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const LYRICS = '[00:01.00]<00:01.00>Привет <00:01.50>world';
const CHANGES = { title: 'Ünïcode — Ω', artist: 'Nova Drift', album: 'Neon Skies', albumArtist: 'Nova Drift', year: 2019, track: 3, trackCount: 11, disc: 1, discCount: 2, genre: 'Synthwave', lyrics: LYRICS, cover: COVER };

const FORMATS = [
  // file, how to check the audio is untouched: a fallback decoder's output, or a WAV's own samples
  ['smoke.mp3'], ['smoke.flac'], ['smoke.ogg'], ['aac.m4a'],
  ['alac16.m4a', 'alac'], ['tone.aiff', 'aiff'], ['tone24.aiff', 'aiff'], ['ref16.wav', 'wav'], ['ref24.wav', 'wav'],
];
for (const [name, audio] of FORMATS) {
  test(`${name}: tags, cover and lyrics written, and read back by the player's reader`, async () => {
    const p = copy(name);
    const before = fs.readFileSync(p);
    const r = await writeTags(p, CHANGES);
    assert.deepStrictEqual(r, { ok: true });
    const { parseFile } = await import('music-metadata');
    const { extractLyrics } = require('../src/main/metadata');
    const m = await parseFile(p);
    const c = m.common;
    assert.strictEqual(c.title, CHANGES.title);
    assert.strictEqual(c.artist, 'Nova Drift');
    assert.strictEqual(c.album, 'Neon Skies');
    assert.strictEqual(c.albumartist, 'Nova Drift');
    assert.strictEqual(c.year, 2019);
    assert.deepStrictEqual([c.track.no, c.track.of, c.disk.no, c.disk.of], [3, 11, 1, 2]);
    assert.strictEqual(c.picture.length, 1);
    assert.strictEqual(extractLyrics(c), LYRICS);
    assert.strictEqual(readTags(p).hasCover, true);
    if (audio === 'wav') assert.ok(pcmOf(fs.readFileSync(p)).equals(pcmOf(before)), 'samples changed');
    else if (audio) assert.ok(pcmOf(decodeToWav(audio, fs.readFileSync(p))).equals(pcmOf(decodeToWav(audio, before))), 'samples changed');
    assert.deepStrictEqual(fs.readdirSync(dir).filter((n) => n.startsWith('.')), [], 'no temporary files left behind');
  });
}

test('a file that can\'t be written is left exactly as it was', async () => {
  const p = path.join(dir, 'broken.mp3');
  fs.writeFileSync(p, Buffer.from('this is not really an mp3 file, just some bytes'));
  const before = fs.readFileSync(p);
  const r = await writeTags(p, { title: 'x' });
  assert.strictEqual(r.ok, false);
  assert.ok(fs.readFileSync(p).equals(before));
  assert.deepStrictEqual(fs.readdirSync(dir).filter((n) => n.startsWith('.')), []);
});

test('cue sheet tracks and unknown formats are never written', async () => {
  assert.strictEqual(canWrite('/music/album.cue#3'), false);
  assert.strictEqual(canWrite('/music/song.wma'), false);
  assert.strictEqual(canWrite('/music/song.flac'), true);
  assert.strictEqual((await writeTags('/music/album.cue#3', { title: 'x' })).ok, false);
});

test('clearing a field removes it', async () => {
  const p = copy('smoke.flac');
  await writeTags(p, { title: 'Kept', genre: 'Rock' });
  await writeTags(p, { genre: null });
  const t = readTags(p);
  assert.strictEqual(t.title, 'Kept');
  assert.strictEqual(t.genre, null);
});
