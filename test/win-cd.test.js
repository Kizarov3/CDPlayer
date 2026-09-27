'use strict';
// Windows audio CDs: the pieces that don't need a drive (TOC, the helper's frames, cdda:// paths, WAV and sectors).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const winCd = require('../src/main/win-cd');
const { discId } = require('../src/main/audio-cd');
const { tocBytes, THREE_DOLLAR_BILL } = require('./fixtures/cd-toc');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const userDisc = () => tocBytes(THREE_DOLLAR_BILL.lbas.map((lba, i) => ({ number: i + 1, lba })), THREE_DOLLAR_BILL.leadout);

test('the user\'s CD: its TOC gives the disc ID MusicBrainz knows', () => {
  const toc = winCd.parseToc(userDisc());
  assert.strictEqual(toc.first, 1);
  assert.strictEqual(toc.last, 13);
  assert.deepStrictEqual(toc.offsets.slice(0, 3), [150, 3785, 21225]);
  assert.strictEqual(toc.leadout, 276875);
  assert.strictEqual(discId(toc), THREE_DOLLAR_BILL.id);
});

test('an enhanced CD: the data track is left out, and the audio ends 11400 sectors before it', () => {
  const toc = winCd.parseToc(tocBytes([{ number: 1, lba: 0 }, { number: 2, lba: 20000 }, { number: 3, lba: 50000, data: true }], 90000));
  assert.deepStrictEqual(toc.tracks, [1, 2]);
  assert.strictEqual(toc.leadout, 50150 - 11400);
  assert.strictEqual(winCd.parseToc(tocBytes([{ number: 1, lba: 0, data: true }], 1000)), null);
});

test('frames: a header line then its bytes, however the pipe splits them; stray lines skipped', () => {
  const got = [];
  const p = new winCd.FrameParser((h, payload) => got.push([h.id, payload.toString()]));
  const wire = Buffer.from('WARNING: something\n{"id":1,"ok":true,"bytes":3}\nabc{"id":2,"ok":true,"bytes":0}\n\n{"id":3,"ok":true,"bytes":2}\nxy');
  for (let i = 0; i < wire.length; i += 3) p.push(wire.subarray(i, i + 3));
  assert.deepStrictEqual(got, [[1, 'abc'], [2, ''], [3, 'xy']]);
  const all = [];
  new winCd.FrameParser((h) => all.push(h.id)).push(wire);
  assert.deepStrictEqual(all, [1, 2, 3]);
});

test('cdda paths, and a track\'s place on the disc', () => {
  assert.strictEqual(winCd.trackPath('F:', 3), 'cdda://F/3');
  assert.deepStrictEqual(winCd.parseTrackPath('cdda://f/12'), { drive: 'F:', number: 12 });
  assert.strictEqual(winCd.parseTrackPath('/Volumes/Audio CD/1 Audio Track.aiff'), null);
  winCd.remember('F:', winCd.parseToc(userDisc()));
  assert.deepStrictEqual(winCd.trackInfo('cdda://F/2'), { drive: 'F:', number: 2, lba: 3635, sectors: 17440, duration: 17440 / 75 });
  assert.strictEqual(winCd.trackInfo('cdda://F/13').sectors, 276725 - 202733);
  assert.strictEqual(winCd.trackInfo('cdda://F/14'), null);
  winCd.keepOnly(new Set());
  assert.strictEqual(winCd.trackInfo('cdda://F/2'), null, 'a disc taken out is forgotten');
});

test('the WAV header, and which sectors cover a byte range', () => {
  const h = winCd.wavHeader(2352 * 10);
  assert.strictEqual(h.length, 44);
  assert.strictEqual(h.toString('ascii', 0, 4), 'RIFF');
  assert.strictEqual(h.readUInt32LE(4), 36 + 23520);
  assert.strictEqual(h.readUInt32LE(24), 44100);
  assert.strictEqual(h.readUInt16LE(34), 16);
  assert.strictEqual(h.readUInt32LE(40), 23520);
  assert.strictEqual(winCd.sectorSpan(0, 43), null); // only the header
  assert.deepStrictEqual(winCd.sectorSpan(0, 44), { first: 0, count: 1, skip: 0 });
  assert.deepStrictEqual(winCd.sectorSpan(44 + 2352 + 10, 44 + 2352 * 3), { first: 1, count: 3, skip: 10 });
});
test('the helper: drives, table of contents, sectors and eject, over the pipe', async () => {
  process.env.CDPLAYER_WIN_CD_HELPER = JSON.stringify([process.execPath, path.join(__dirname, 'fixtures', 'fake-cd-helper.js')]);
  assert.deepStrictEqual(await winCd.drives(), ['F:']);
  const toc = await winCd.readToc('F:');
  assert.strictEqual(discId(toc), THREE_DOLLAR_BILL.id);
  const bytes = await winCd.readSectors('F:', 3635, 3);
  assert.strictEqual(bytes.length, 3 * 2352);
  assert.deepStrictEqual([bytes[0], bytes[2352], bytes[4704]], [3635 & 0xff, 3636 & 0xff, 3637 & 0xff]);
  await assert.rejects(winCd.readToc('D:'), /error 21/);
  await winCd.eject('F:');
});

test('a drive that hangs: the request times out, the helper is restarted, and CDs stay on', async () => {
  winCd._setTimeout(300);
  await assert.rejects(winCd._send('hang'), /didn't answer/);
  assert.deepStrictEqual(await winCd.drives(), ['F:'], 'a fresh helper answers');
  assert.strictEqual(winCd.available(), true, 'a hang is not one of the two deaths');
  winCd._setTimeout(30000);
});

test('the helper dying: what was asked fails instead of hanging; twice, and CDs are off', async () => {
  await assert.rejects(winCd._send('die'), /stopped/);
  assert.deepStrictEqual(await winCd.drives(), ['F:'], 'started again after the first time');
  await assert.rejects(winCd._send('die'), /stopped/);
  assert.strictEqual(winCd.available(), false);
  await assert.rejects(winCd.drives(), /no CD helper/);
});

test('the drive list however PowerShell wraps it (Windows PowerShell 5.1 sent [["F:"]])', () => {
  assert.deepStrictEqual(winCd.driveList([['F:']]), ['F:']);
  assert.deepStrictEqual(winCd.driveList([['E:', 'F:']]), ['E:', 'F:']);
  assert.deepStrictEqual(winCd.driveList(['F:']), ['F:']);
  assert.deepStrictEqual(winCd.driveList('F:'), ['F:']);
  assert.deepStrictEqual(winCd.driveList(null), []);
});
