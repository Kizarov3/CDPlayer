'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { activityFor, encode, decode, ICON_URL } = require('../src/main/discord');

test('frames: 4-byte opcode + 4-byte length (little-endian) + JSON, split across reads', () => {
  const a = encode(1, { cmd: 'SET_ACTIVITY', nonce: '1' }), b = encode(3, { hi: 'é' });
  assert.strictEqual(a.readInt32LE(0), 1);
  assert.strictEqual(a.readInt32LE(4), a.length - 8);
  const both = Buffer.concat([a, b]);
  const first = decode(both.subarray(0, a.length + 5)); // the second frame only partly arrived
  assert.deepStrictEqual(first.frames, [{ op: 1, data: { cmd: 'SET_ACTIVITY', nonce: '1' } }]);
  const second = decode(Buffer.concat([first.rest, both.subarray(a.length + 5)]));
  assert.deepStrictEqual(second.frames, [{ op: 3, data: { hi: 'é' } }]);
  assert.strictEqual(second.rest.length, 0);
});

test('a playing song becomes "Listening to CDPlayer" with a progress bar', () => {
  const now = 1_800_000_000_000;
  const a = activityFor({ title: 'Solar Flare', artist: 'Nova Drift', album: 'Neon Skies', position: 62, duration: 185 }, now);
  assert.strictEqual(a.type, 2);
  assert.strictEqual(a.details, 'Solar Flare');
  assert.strictEqual(a.state, 'Nova Drift');
  assert.deepStrictEqual(a.timestamps, { start: now - 62_000, end: now - 62_000 + 185_000 });
  assert.deepStrictEqual(a.assets, { large_image: ICON_URL, large_text: 'Neon Skies' });
  assert.strictEqual(a.buttons.length, 1);
  assert.strictEqual(a.status_display_type, 1); // "Listening to Nova Drift"
  assert.strictEqual(activityFor({ title: 'Untagged song' }).status_display_type, 2); // no artist: the title
});

test('an online cover is shown by its web address; embedded art (a data URL) falls back to the icon', () => {
  assert.strictEqual(activityFor({ title: 'x1', coverUrl: 'https://is1-ssl.mzstatic.com/a/600x600bb.jpg' }).assets.large_image, 'https://is1-ssl.mzstatic.com/a/600x600bb.jpg');
  assert.strictEqual(activityFor({ title: 'x1', coverUrl: 'data:image/jpeg;base64,AAAA' }).assets.large_image, ICON_URL);
});

test('text fits Discord: 2–128 characters, no empty artist', () => {
  const a = activityFor({ title: 'X', artist: '  ', album: '', duration: 0 });
  assert.strictEqual(a.details.length, 2);
  assert.strictEqual('state' in a, false);
  assert.strictEqual('timestamps' in a, false);
  assert.strictEqual(a.assets.large_text, 'CDPlayer');
  assert.strictEqual(activityFor({ title: 'y'.repeat(300) }).details.length, 128);
});
