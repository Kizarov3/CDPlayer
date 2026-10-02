import test from 'node:test';
import assert from 'node:assert';
import { LEVELS, capRate, targetRate, badgeLabel, badgeText, badgeExact, levelName, khz } from '../src/renderer/js/quality.js';

test('three levels, as in Apple Music', () => {
  assert.deepStrictEqual(LEVELS, ['HIGH', 'LOSSLESS', 'HIRES']);
  assert.deepStrictEqual(LEVELS.map((l) => levelName(l)), ['HIGH', 'LOSSLESS', 'HI-RES LOSSLESS']);
  assert.strictEqual(levelName('HIRES', true), 'HI-RES LOSSLESS · UP TO 24-BIT / 192 KHZ');
  assert.strictEqual(levelName('LOSSLESS', true), 'LOSSLESS · UP TO 24-BIT / 48 KHZ');
  assert.strictEqual(levelName('nonsense'), 'HIGH');
});

test('above the cap, a rate is lowered within its family: a whole ratio', () => {
  assert.deepStrictEqual([44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000].map((r) => capRate(r, 48000)),
    [44100, 48000, 44100, 48000, 44100, 48000, 44100, 48000]);
  assert.deepStrictEqual([44100, 96000, 192000, 352800, 384000].map((r) => capRate(r, 192000)), [44100, 96000, 192000, 176400, 192000]);
  assert.strictEqual(capRate(22050, 48000), 22050);
});

test('the rate a song plays at, per level', () => {
  assert.strictEqual(targetRate('HIGH', 96000), null);
  assert.strictEqual(targetRate('LOSSLESS', 44100), 44100);
  assert.strictEqual(targetRate('LOSSLESS', 96000), 48000);
  assert.strictEqual(targetRate('HIRES', 96000), 96000);
  assert.strictEqual(targetRate('HIRES', 352800), 176400);
  assert.strictEqual(targetRate('HIRES', undefined), null);
  assert.strictEqual(targetRate('HIRES', 0), null);
});

test('the badge: lossless files only, hi-res above 48 kHz at 24-bit, by the rate actually aimed at', () => {
  const f = (sampleRate, bitsPerSample, lossless = true) => ({ sampleRate, bitsPerSample, lossless });
  assert.strictEqual(badgeLabel(f(44100, 16), 'HIGH'), null);
  assert.strictEqual(badgeLabel(f(44100, 16, false), 'HIRES'), null);
  assert.strictEqual(badgeLabel(null, 'HIRES'), null);
  assert.strictEqual(badgeLabel(f(44100, 16), 'HIRES'), '◈ LOSSLESS');
  assert.strictEqual(badgeLabel(f(96000, 24), 'HIRES'), '◈ HI-RES LOSSLESS');
  assert.strictEqual(badgeLabel(f(96000, 16), 'HIRES'), '◈ LOSSLESS');
  assert.strictEqual(badgeLabel(f(96000, 24), 'LOSSLESS'), '◈ LOSSLESS');
});

test('what reaches the output, said plainly', () => {
  assert.strictEqual(khz(44100), '44.1 KHZ');
  assert.strictEqual(khz(96000), '96 KHZ');
  const base = { fileRate: 96000, aimed: 96000, deviceRate: 96000, switched: true, bluetooth: false, eq: false, mono: false };
  assert.strictEqual(badgeText(base), 'OUTPUT: 96 KHZ — NOT RESAMPLED');
  assert.ok(badgeExact(base));
  assert.strictEqual(badgeText({ ...base, fileRate: 192000, aimed: 192000 }), "OUTPUT: 96 KHZ — RESAMPLED (THE DEVICE CAN'T PLAY 192 KHZ)");
  assert.strictEqual(badgeText({ ...base, deviceRate: 48000, switched: false }), 'OUTPUT: 48 KHZ — RESAMPLED (SET THE RATE IN YOUR SOUND SETTINGS)');
  assert.strictEqual(badgeText({ ...base, aimed: 48000, deviceRate: 48000 }), 'OUTPUT: 48 KHZ — LOWERED FROM 96 KHZ (HI-RES LOSSLESS PLAYS IT IN FULL)');
  assert.strictEqual(badgeText({ ...base, fileRate: 384000, aimed: 192000, deviceRate: 192000 }), 'OUTPUT: 192 KHZ — LOWERED FROM 384 KHZ (THE HIGHEST CDPLAYER PLAYS)');
  assert.ok(!badgeExact({ ...base, aimed: 48000, deviceRate: 48000 }));
  assert.strictEqual(badgeText({ ...base, bluetooth: true }), 'BLUETOOTH: QUALITY IS LIMITED BY THE WIRELESS CODEC');
  assert.ok(!badgeExact({ ...base, bluetooth: true }));
  assert.strictEqual(badgeText({ ...base, eq: true }), 'OUTPUT: 96 KHZ — NOT RESAMPLED\nTHE EQUALIZER OR MONO CHANGES THE SOUND');
  assert.strictEqual(badgeText({ ...base, deviceRate: 96000, switched: false }), 'OUTPUT: 96 KHZ — NOT RESAMPLED');
});
