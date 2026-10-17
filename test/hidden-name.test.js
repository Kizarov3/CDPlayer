'use strict';
// The hidden song's name from MusicBrainz's "A / B" recording titles (no network).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const { hiddenNameFrom } = require('../src/main/online');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const recordings = [
  { title: 'Something in the Way', length: 232000 },
  { title: 'Something in the Way / Endless, Nameless', length: 1235066 },
];

test('the part after " / " of a recording as long as the file, whose first part is the file\'s title', () => {
  assert.strictEqual(hiddenNameFrom(recordings, { title: 'Something in the Way', duration: 1235 }), 'Endless, Nameless');
  assert.strictEqual(hiddenNameFrom(recordings, { title: 'something in the way (Remastered)', duration: 1233 }), 'Endless, Nameless');
});

test('nothing for another length, another first part, or no " / "', () => {
  assert.strictEqual(hiddenNameFrom(recordings, { title: 'Something in the Way', duration: 662 }), null);
  assert.strictEqual(hiddenNameFrom([{ title: 'Other / X', length: 1235000 }], { title: 'Something in the Way', duration: 1235 }), null);
  assert.strictEqual(hiddenNameFrom([{ title: 'Something in the Way', length: 1235000 }], { title: 'Something in the Way', duration: 1235 }), null);
  assert.strictEqual(hiddenNameFrom(undefined, { title: 'x', duration: 1 }), null);
});
