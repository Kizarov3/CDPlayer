import test from 'node:test';
import assert from 'node:assert';
import { seamlessNext, rateFits, PREPARE_SECONDS } from '../src/renderer/js/gapless.js';

const base = {
  crossfade: 0, repeat: 'OFF', spotify: false, nextPath: '/m/02.flac', isCdTrack: false, sameFileCue: false,
  nextDetails: { cue: null, format: { sampleRate: 44100 } }, quality: 'HIGH', customRate: null, rateInfo: null, engineRate: 48000,
  mediaUrl: (p) => `cdp://app/media?p=${p}`,
};

test('the next file follows seamlessly by default', () => {
  assert.deepStrictEqual(seamlessNext(base), { url: 'cdp://app/media?p=/m/02.flac', segment: null });
  assert.strictEqual(PREPARE_SECONDS, 10);
});

test('a cue track in another file follows from its start', () => {
  const nextDetails = { cue: { file: '/m/b.flac', start: 0, end: 300 }, format: { sampleRate: 44100 } };
  assert.deepStrictEqual(seamlessNext({ ...base, nextPath: '/m/b.cue#1', nextDetails }), { url: 'cdp://app/media?p=/m/b.flac', segment: { start: 0, end: 300 } });
});

test('not with crossfade, REPEAT ONE, Spotify, a CD, a same-file cue track, or nothing next', () => {
  for (const change of [{ crossfade: 3 }, { repeat: 'ONE' }, { spotify: true }, { isCdTrack: true }, { sameFileCue: true }, { nextPath: null }, { nextPath: 'spotify:track:x' }, { nextDetails: null }]) {
    assert.strictEqual(seamlessNext({ ...base, ...change }), null, JSON.stringify(change));
  }
  assert.ok(seamlessNext({ ...base, repeat: 'ALL' }));
});

test('HIGH: only while the engine is at the system rate', () => {
  assert.strictEqual(rateFits({ quality: 'HIGH', customRate: null }), true);
  assert.strictEqual(rateFits({ quality: 'HIGH', customRate: 96000 }), false);
});

test('LOSSLESS / HIRES: only when the next song plays at the rate the engine is at', () => {
  const info = { aimed: 44100, switched: true, deviceRate: 44100 };
  assert.strictEqual(rateFits({ quality: 'LOSSLESS', fileRate: 44100, rateInfo: info, engineRate: 44100 }), true);
  assert.strictEqual(rateFits({ quality: 'HIRES', fileRate: 96000, rateInfo: info, engineRate: 44100 }), false);
  assert.strictEqual(rateFits({ quality: 'LOSSLESS', fileRate: 96000, rateInfo: { aimed: 48000, switched: false, deviceRate: 48000 }, engineRate: 48000 }), true); // capped to 48 kHz
  assert.strictEqual(rateFits({ quality: 'LOSSLESS', fileRate: 44100, rateInfo: null, engineRate: 44100 }), false);
  assert.strictEqual(rateFits({ quality: 'HIRES', fileRate: null, rateInfo: null, engineRate: 48000 }), true); // no rate known: nothing would change
  assert.strictEqual(seamlessNext({ ...base, quality: 'HIRES', nextDetails: { cue: null, format: { sampleRate: 96000 } }, rateInfo: info, engineRate: 44100 }), null);
});
