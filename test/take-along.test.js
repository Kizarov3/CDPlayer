'use strict';
// TAKE ALONG: albums copied (or made MP3) onto a player's folder — named as RIP names them, only what's new written,
// nothing of anyone else's written over, and a cancel or a full card leaving no half files.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const { takeAlong, plan, readManifest, MANIFEST } = require('../src/main/take-along');
const { readWav, readFlac, toCdAudio, resample } = require('../src/main/encoders/pcm');
const { encodeFlac } = require('../src/main/encoders/flac');
const { encodeWav } = require('../src/main/encoders/mp3');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const FIXTURES = path.join(__dirname, 'fixtures');
const COVER = `data:image/jpeg;base64,${fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.png')).toString('base64')}`;
const tone = (seconds, f) => { const n = Math.round(44100 * seconds), p = new Int16Array(n * 2); for (let i = 0; i < n; i++) { p[i * 2] = Math.round(9000 * Math.sin(i * f)); p[i * 2 + 1] = Math.round(7000 * Math.sin(i * f * 1.5)); } return p; };
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `take-${name}-`));
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)).map((f) => `${e.name}/${f}`) : [e.name])).sort();

// A music folder with an album of an MP3 and two FLACs, and the shelf's album for it.
function library() {
  const music = tmp('music');
  fs.copyFileSync(path.join(FIXTURES, 'smoke.mp3'), path.join(music, 'a.mp3'));
  fs.writeFileSync(path.join(music, 'b.flac'), encodeFlac(tone(1, 0.03)));
  fs.writeFileSync(path.join(music, 'c.flac'), encodeFlac(tone(0.5, 0.05)));
  const album = {
    title: 'Significant Other', artist: 'Limp Bizkit', year: '1999', genre: 'Nu Metal', discs: 1,
    tracks: [
      { path: path.join(music, 'a.mp3'), title: 'Just Like This', artist: 'Limp Bizkit', track: 1, disc: 1, duration: 1 },
      { path: path.join(music, 'b.flac'), title: 'Nookie', artist: 'Limp Bizkit', track: 2, disc: 1, duration: 1 },
      { path: path.join(music, 'c.flac'), title: 'Re-Arranged', artist: 'Limp Bizkit', track: 3, disc: 1, duration: 0.5 },
      { path: 'https://music.youtube.com/watch?v=x', title: 'Streamed', track: 4, disc: 1 },
    ],
  };
  return { music, album };
}
const FOLDER = path.join('Limp Bizkit', 'Significant Other (1999)');

// ---- Audio brought to CD audio -----------------------------------------------------------------------------------

test('a CD-quality FLAC goes through sample for sample', () => {
  const pcm = tone(0.3, 0.02);
  const out = toCdAudio(readFlac(encodeFlac(pcm)));
  assert.deepStrictEqual(Array.from(out), Array.from(pcm));
});

test('24-bit and mono WAVs become 16-bit stereo; a cut takes only its seconds', () => {
  for (const name of ['ref24.wav', 'refmono.wav']) {
    const audio = readWav(fs.readFileSync(path.join(FIXTURES, name)));
    const out = toCdAudio(audio);
    assert.ok(out instanceof Int16Array && out.length > 1000 && out.length % 2 === 0, name);
    if (audio.channels && audio.channels.length === 1) for (let i = 0; i < 200; i += 2) assert.strictEqual(out[i], out[i + 1], 'mono on both sides');
  }
  const cd = readFlac(encodeFlac(tone(2, 0.02)));
  assert.strictEqual(toCdAudio(cd, { from: 0.5, to: 1.5 }).length, 44100 * 2);
});

test('48 kHz brought to 44.1 kHz keeps its pitch and its level', () => {
  const n = 48000, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
  const y = resample(x, 48000, 44100);
  assert.strictEqual(y.length, 44100);
  let crossings = 0, peak = 0;
  for (let i = 1000; i < 43000; i++) { if (y[i - 1] < 0 && y[i] >= 0) crossings++; peak = Math.max(peak, Math.abs(y[i])); }
  assert.ok(Math.abs(crossings - 1000 * (42000 / 44100)) <= 2, `1 kHz still (${crossings})`);
  assert.ok(Math.abs(peak - 0.5) < 0.01, `same level (${peak})`);
});

// ---- Taking albums along -----------------------------------------------------------------------------------------

test('AS THEY ARE: each file copied to artist / album (year) / NN Title, with cover.jpg; streams left out', async () => {
  const { album } = library(), dest = tmp('dest');
  const progress = [];
  const r = await takeAlong({ albums: [album], dest, format: 'COPY', coverFor: async () => COVER, onProgress: (p) => progress.push(p) });
  assert.deepStrictEqual(walk(path.join(dest, FOLDER)), ['01 Just Like This.mp3', '02 Nookie.flac', '03 Re-Arranged.flac', 'cover.jpg']);
  assert.deepStrictEqual([r.written, r.there, r.failed.length], [3, 0, 0]);
  assert.ok(fs.readFileSync(path.join(dest, FOLDER, '02 Nookie.flac')).equals(fs.readFileSync(album.tracks[1].path)), 'the same file');
  const last = progress[progress.length - 1];
  assert.deepStrictEqual([last.done, last.total, last.percent], [3, 3, 100]);
  assert.strictEqual(Object.keys(readManifest(dest)).length, 3);
});

test('taken again: only what changed is written, and a file someone else put there is left alone', async () => {
  const { album } = library(), dest = tmp('dest');
  await takeAlong({ albums: [album], dest, format: 'COPY' });
  let r = await takeAlong({ albums: [album], dest, format: 'COPY' });
  assert.deepStrictEqual([r.written, r.there], [0, 3]);
  // The FLAC re-tagged at home: written again. Another file of the name of a song's: kept.
  fs.writeFileSync(album.tracks[1].path, encodeFlac(tone(1.2, 0.03)));
  fs.utimesSync(album.tracks[1].path, new Date(), new Date(Date.now() + 5000));
  const theirs = path.join(dest, FOLDER, '03 Re-Arranged.flac');
  fs.writeFileSync(theirs, 'mine');
  const m = readManifest(dest); delete m['Limp Bizkit/Significant Other (1999)/03 Re-Arranged.flac'];
  fs.writeFileSync(path.join(dest, MANIFEST), JSON.stringify({ version: 1, files: m }));
  const p = await plan([album], { dest, format: 'COPY' });
  assert.deepStrictEqual([p.albums, p.songs, p.toWrite, p.there], [1, 3, 1, 2]);
  r = await takeAlong({ albums: [album], dest, format: 'COPY' });
  assert.deepStrictEqual([r.written, r.there], [1, 2]);
  assert.ok(fs.readFileSync(path.join(dest, FOLDER, '02 Nookie.flac')).equals(fs.readFileSync(album.tracks[1].path)));
  assert.strictEqual(fs.readFileSync(theirs, 'utf8'), 'mine');
});

test('planned before a folder is picked: counted, nothing there yet', async () => {
  const { album } = library();
  const p = await plan([album], { dest: null, format: 'COPY' });
  assert.deepStrictEqual([p.albums, p.songs, p.toWrite, p.there, p.free], [1, 3, 3, 0, null]);
});

test('MP3 320: the FLACs made tagged MP3s with the cover in them, the MP3 copied as it is', async () => {
  const { album } = library(), dest = tmp('dest');
  const p = await plan([album], { dest, format: 'MP3' });
  assert.deepStrictEqual([p.converting, p.keptLossy], [2, 1]);
  const r = await takeAlong({ albums: [album], dest, format: 'MP3', coverFor: async () => COVER });
  assert.deepStrictEqual(r.failed, []);
  assert.deepStrictEqual(walk(path.join(dest, FOLDER)), ['01 Just Like This.mp3', '02 Nookie.mp3', '03 Re-Arranged.mp3', 'cover.jpg']);
  assert.ok(fs.readFileSync(path.join(dest, FOLDER, '01 Just Like This.mp3')).equals(fs.readFileSync(album.tracks[0].path)));
  const { parseFile } = await import('music-metadata');
  const m = await parseFile(path.join(dest, FOLDER, '02 Nookie.mp3'));
  assert.strictEqual(m.format.codec, 'MPEG 1 Layer 3');
  assert.strictEqual(m.format.bitrate, 320000);
  assert.strictEqual(m.common.title, 'Nookie');
  assert.strictEqual(m.common.album, 'Significant Other');
  assert.strictEqual(m.common.albumartist, 'Limp Bizkit');
  assert.deepStrictEqual(m.common.track, { no: 2, of: 3 });
  assert.strictEqual(m.common.year, 1999);
  assert.ok(m.common.picture && m.common.picture.length, 'the cover is inside');
  assert.ok(Math.abs(m.format.duration - 1) < 0.05, `as long (${m.format.duration})`);
});

test('a cue sheet: cut into its songs for MP3; as they are, the album-length file goes with its sheet', async () => {
  const music = tmp('cue'), wav = path.join(music, 'album.wav'), sheet = path.join(music, 'album.cue');
  fs.writeFileSync(wav, encodeWav(tone(2, 0.03)));
  fs.writeFileSync(sheet, 'PERFORMER "Korn"\nTITLE "Issues"\nFILE "album.wav" WAVE\n  TRACK 01 AUDIO\n    TITLE "Dead"\n    INDEX 01 00:00:00\n  TRACK 02 AUDIO\n    TITLE "Falling Away from Me"\n    INDEX 01 00:01:00\n');
  const album = { title: 'Issues', artist: 'Korn', year: '1999', discs: 1, tracks: [
    { path: `${sheet}#1`, title: 'Dead', track: 1, disc: 1, duration: 1 }, { path: `${sheet}#2`, title: 'Falling Away from Me', track: 2, disc: 1, duration: 1 }] };
  const dest = tmp('dest');
  await takeAlong({ albums: [album], dest, format: 'MP3' });
  const folder = path.join(dest, 'Korn', 'Issues (1999)');
  assert.deepStrictEqual(walk(folder), ['01 Dead.mp3', '02 Falling Away from Me.mp3']);
  const { parseFile } = await import('music-metadata');
  assert.ok(Math.abs((await parseFile(path.join(folder, '02 Falling Away from Me.mp3'))).format.duration - 1) < 0.05);
  const copied = tmp('dest');
  await takeAlong({ albums: [album], dest: copied, format: 'COPY' });
  assert.deepStrictEqual(walk(path.join(copied, 'Korn', 'Issues (1999)')), ['album.cue', 'album.wav']);
});

test('cancelled part-way: what was finished stays, nothing half-written', async () => {
  const { album } = library(), dest = tmp('dest');
  const ctl = new AbortController();
  await assert.rejects(takeAlong({ albums: [album], dest, format: 'MP3', signal: ctl.signal, onProgress: (p) => { if (p.done === 1) ctl.abort(); } }), (e) => e.reason === 'cancelled');
  const files = walk(dest);
  assert.ok(!files.some((f) => path.basename(f).startsWith('.cdplayer-taking-')), `no temp files (${files})`);
  assert.deepStrictEqual(Object.keys(readManifest(dest)), ['Limp Bizkit/Significant Other (1999)/01 Just Like This.mp3']);
});

test('not room enough: says how much is needed before anything is written; a destination gone says so', async () => {
  const { album } = library(), dest = tmp('dest');
  await assert.rejects(takeAlong({ albums: [album], dest, format: 'COPY', statfs: async () => ({ bavail: 10, bsize: 512 }) }),
    (e) => e.reason === 'space' && e.need > e.free && e.free === 5120);
  assert.deepStrictEqual(fs.readdirSync(dest), []);
  await assert.rejects(takeAlong({ albums: [album], dest: path.join(dest, 'unplugged'), format: 'COPY' }), (e) => e.reason === 'gone');
});
