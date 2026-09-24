'use strict';
// The fallback decoders must be bit-exact: each fixture was encoded from (or decoded to) the matching ref*.wav.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { decodeToWav, fallbackKind } = require('../src/main/decoders');
const { parseMp4Audio } = require('../src/main/decoders/mp4');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name));
function pcmOf(wav) {
  for (let p = 12; p < wav.length;) {
    const id = wav.toString('ascii', p, p + 4), size = wav.readUInt32LE(p + 4);
    if (id === 'data') return wav.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}
function fmtOf(wav) {
  return { channels: wav.readUInt16LE(22), sampleRate: wav.readUInt32LE(24), bits: wav.readUInt16LE(34) };
}

const cases = [
  ['alac16.m4a', 'alac', 'ref16.wav'],
  ['alac24.m4a', 'alac', 'ref24.wav'],
  ['alacmono.m4a', 'alac', 'refmono.wav'],
  ['tone.aiff', 'aiff', 'ref16.wav'],
  ['tone24.aiff', 'aiff', 'ref24.wav'],
  ['tone-ulaw.au', 'au', 'ref-ulaw.wav'],
];
for (const [file, kind, ref] of cases) {
  test(`${file} decodes bit-exact`, () => {
    const out = decodeToWav(kind, fixture(file));
    const expected = fixture(ref);
    assert.deepStrictEqual(fmtOf(out), fmtOf(expected));
    assert.ok(pcmOf(out).equals(pcmOf(expected)), 'PCM differs from reference');
  });
}

test('AAC .m4a is left for Chromium, ALAC .m4a is routed to the JS decoder', () => {
  assert.strictEqual(parseMp4Audio(fixture('aac.m4a')).codec, 'mp4a');
  assert.strictEqual(parseMp4Audio(fixture('alac16.m4a')).codec, 'alac');
  assert.strictEqual(fallbackKind('x.m4a', fixture('aac.m4a')), null);
  assert.strictEqual(fallbackKind('x.m4a', fixture('alac16.m4a')), 'alac');
  assert.strictEqual(fallbackKind('x.AIFF', null), 'aiff');
  assert.strictEqual(fallbackKind('x.au', null), 'au');
  assert.strictEqual(fallbackKind('x.mp3', null), null);
  assert.strictEqual(fallbackKind('x.flac', null), null);
});

test('garbage input is rejected cleanly', () => {
  assert.throws(() => decodeToWav('aiff', Buffer.from('not an aiff file at all')));
  assert.throws(() => decodeToWav('au', Buffer.alloc(32)));
  assert.throws(() => decodeToWav('alac', fixture('aac.m4a')));
});
