'use strict';
// Playing Windows audio-CD tracks (cdda://): WAV bytes for any range, and their details, without a drive.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const electron = require.resolve('electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { nativeImage: {} } };
const winCd = require('../src/main/win-cd');
const media = require('../src/main/media-protocol');
const metadata = require('../src/main/metadata');
const { tocBytes, THREE_DOLLAR_BILL } = require('./fixtures/cd-toc');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

winCd.remember('F:', winCd.parseToc(tocBytes(THREE_DOLLAR_BILL.lbas.map((lba, i) => ({ number: i + 1, lba })), THREE_DOLLAR_BILL.leadout)));
// A drive whose sector n is filled with the byte n & 0xff.
const fakeRead = async (drive, lba, count) => {
  const b = Buffer.alloc(count * 2352);
  for (let s = 0; s < count; s++) b.fill((lba + s) & 0xff, s * 2352, (s + 1) * 2352);
  return b;
};
const req = (range) => ({ headers: new Headers(range ? { range } : {}) });
const bytes = async (res) => Buffer.from(await res.arrayBuffer());

test('a whole-track answer: a WAV the size of the track', async () => {
  const res = await media.serveCdda(req(null), 'cdda://F/2', fakeRead);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'audio/wav');
  assert.strictEqual(Number(res.headers.get('content-length')), 44 + 17440 * 2352);
});

test('a seek: exactly the bytes asked for, from the right sectors — mid-sector and across the header', async () => {
  const start = 44 + 2352 * 100 + 7, end = start + 2352 * 30; // 31 sectors, starting 7 bytes into sector 100
  const mine = []; // (its own log: an earlier answer's stream may still be reading ahead)
  const read = (drive, lba, count) => { mine.push([lba, count]); return fakeRead(drive, lba, count); };
  const res = await media.serveCdda(req(`bytes=${start}-${end}`), 'cdda://F/2', read);
  assert.strictEqual(res.status, 206);
  const b = await bytes(res);
  assert.strictEqual(b.length, end - start + 1);
  assert.strictEqual(b[0], (3635 + 100) & 0xff);
  assert.strictEqual(b[b.length - 1], (3635 + 130) & 0xff);
  assert.deepStrictEqual(mine, [[3735, 25], [3760, 6]], 'read 25 sectors at a time');
  const head = await bytes(await media.serveCdda(req('bytes=40-47'), 'cdda://F/2', fakeRead));
  assert.strictEqual(head.length, 8);
  assert.strictEqual(head.readUInt32LE(0), 17440 * 2352); // the data size, the header's last 4 bytes
  assert.deepStrictEqual([...head.subarray(4)], [3635 & 0xff, 3635 & 0xff, 3635 & 0xff, 3635 & 0xff]);
});

test('a track of a disc that\'s gone: not found', async () => {
  assert.strictEqual((await media.serveCdda(req(null), 'cdda://G/1', fakeRead)).status, 404);
});

test('a CD track\'s details come from the disc, never the file system', async () => {
  const d = await metadata.getDetails('cdda://F/2', { withCover: false });
  assert.strictEqual(d.title, 'Track 2');
  assert.strictEqual(d.duration, 17440 / 75);
  assert.strictEqual(d.quality, 'CD AUDIO · 16-BIT · 44.1 KHZ');
  assert.strictEqual(d.unnamed, true, 'an unnamed CD track is not looked up online');
});
