'use strict';
// The Windows CD helper only while there's a disc to read: PowerShell is ~125 MB kept running for nothing otherwise.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
process.env.CDPLAYER_WIN_CD_HELPER = JSON.stringify([process.execPath, path.join(__dirname, 'fixtures', 'fake-cd-helper.js')]);
const winCd = require('../src/main/win-cd');
const audioCd = require('../src/main/audio-cd');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('every CD drive, with a disc in it or not, from the helper', async () => {
  assert.deepStrictEqual(await winCd.opticalDrives(), ['D:', 'F:']);
});

test('the helper let go while idle: not counted as dying, and started afresh when asked again', async () => {
  await winCd.drives();
  assert.strictEqual(winCd.running(), true);
  winCd.release();
  assert.strictEqual(winCd.running(), false);
  winCd.release(); winCd.release(); // (more than twice: still not a death)
  assert.deepStrictEqual(await winCd.drives(), ['F:']);
  assert.strictEqual(winCd.available(), true);
});

test('no disc in any CD drive: no discs, and the helper is let go; a disc goes in: it is read as before', async () => {
  const none = await audioCd._findWinDiscs({ now: 1, mediaIn: async () => false });
  assert.deepStrictEqual(none, []);
  assert.strictEqual(winCd.running(), false);
  const asked = [];
  const found = await audioCd._findWinDiscs({ now: 2, mediaIn: async (d) => { asked.push(d); return d === 'F:'; } });
  assert.deepStrictEqual(asked, ['D:', 'F:']);
  assert.deepStrictEqual(found.map((d) => d.mount), ['F:']);
  assert.strictEqual(found[0].tracks.length > 0, true);
});

test('the CD drive list not to be had (an older or failing helper): the discs are looked for through the helper as before', async () => {
  await audioCd._findWinDiscs({ now: 98_000_000, mediaIn: async () => false }); // (nothing found before)
  const { opticalDrives } = winCd;
  winCd.opticalDrives = async () => { throw new Error('unknown op'); };
  try {
    const found = await audioCd._findWinDiscs({ now: 99_000_000, mediaIn: async () => false });
    assert.deepStrictEqual(found.map((d) => d.mount), ['F:'], 'the disc in F: is still found');
  } finally { winCd.opticalDrives = opticalDrives; }
});

test('the CD drives are asked for again only every few minutes, not on every look', async () => {
  winCd.release();
  await audioCd._findWinDiscs({ now: 10_000_000, mediaIn: async () => false }); // asks (it's been long enough)
  assert.strictEqual(winCd.running(), false);
  let starts = 0;
  const watch = setInterval(() => { if (winCd.running()) starts++; }, 1);
  for (let k = 1; k <= 20; k++) await audioCd._findWinDiscs({ now: 10_000_000 + k * 3000, mediaIn: async () => false });
  clearInterval(watch);
  assert.strictEqual(starts, 0, 'no PowerShell started for a minute of looks at empty drives');
});
