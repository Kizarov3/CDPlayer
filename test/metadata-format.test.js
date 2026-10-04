'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const metadata = require('../src/main/metadata');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const fixture = (name) => path.join(__dirname, 'fixtures', name);

test('a song\'s sample rate, bit depth and whether it\'s lossless come with its details', async () => {
  const flac = await metadata.getDetails(fixture('smoke.flac'), { withCover: false });
  assert.strictEqual(flac.format.lossless, true);
  assert.ok(flac.format.sampleRate > 0);
  assert.ok(flac.format.bitsPerSample > 0);
  const alac = await metadata.getDetails(fixture('alac24.m4a'), { withCover: false });
  assert.deepStrictEqual([alac.format.lossless, alac.format.bitsPerSample], [true, 24]);
  const mp3 = await metadata.getDetails(fixture('smoke.mp3'), { withCover: false });
  assert.strictEqual(mp3.format.lossless, false);
});

test('ReplayGain tags come with a song\'s details', async () => {
  const rg = (await metadata.getDetails(fixture('replaygain.flac'), { withCover: false })).replayGain;
  assert.ok(Math.abs(rg.trackGain - -6.5) < 1e-9);
  assert.ok(Math.abs(rg.trackPeak - 0.988) < 1e-6);
  assert.ok(Math.abs(rg.albumGain - -7.25) < 1e-9);
  assert.ok(Math.abs(rg.albumPeak - 0.999) < 1e-6);
  assert.strictEqual((await metadata.getDetails(fixture('smoke.mp3'), { withCover: false })).replayGain, null);
});

test('R128 gains (Q7.8 dB from -23 LUFS) are turned into ReplayGain\'s -18', async () => {
  const rg = (await metadata.getDetails(fixture('r128.ogg'), { withCover: false })).replayGain;
  assert.ok(Math.abs(rg.trackGain - (-512 / 256 + 5)) < 1e-9);
  assert.ok(Math.abs(rg.albumGain - (256 / 256 + 5)) < 1e-9);
  assert.strictEqual(rg.trackPeak, null);
});
