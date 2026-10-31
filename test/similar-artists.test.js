'use strict';
// FROM YOUR SHELF's lookups (similar-artists.js): Last.fm stood in for (fetch), so nothing goes online.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
process.env.CDPLAYER_LASTFM_API = 'http://lastfm.test/2.0/';
const { createSimilarArtists } = require('../src/main/similar-artists');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const DAY = 86400e3;
const SIMILAR = { similarartists: { artist: [{ name: 'Portishead', match: '1' }, { name: 'Tricky', match: '0.8123' }, { name: ' ' }] } };

// `answer` (url → json | Error) for each request; the requests, the file and the clock kept to look at.
function setup(answer = () => SIMILAR) {
  const asked = [], file = { text: null }, clock = { now: 1e12 }, waited = [];
  const fetch = async (url) => {
    asked.push(url);
    const a = answer(url);
    if (a instanceof Error) throw a;
    return { status: 200, json: async () => a };
  };
  const s = createSimilarArtists({ fetch, read: () => file.text, write: (t) => { file.text = t; }, now: () => clock.now, wait: async (ms) => { waited.push(ms); clock.now += ms; } });
  return { s, asked, file, clock, waited };
}

test('asked of Last.fm with CDPlayer\'s key, no sign-in; the likest first, nameless ones left out', async () => {
  const { s, asked, file } = setup();
  assert.deepStrictEqual(await s.similarTo('Massive Attack'), [{ name: 'Portishead', match: 1 }, { name: 'Tricky', match: 0.812 }]);
  assert.strictEqual(asked.length, 1);
  assert.match(asked[0], /^http:\/\/lastfm\.test\/2\.0\/\?method=artist\.getsimilar&artist=Massive%20Attack&.*api_key=[0-9a-f]{32}&format=json$/);
  assert.ok(!/sk=|api_sig=/.test(asked[0]));
  assert.strictEqual(JSON.parse(file.text).version, 1);
});

test('kept for 30 days, by the name as the shelf compares it; then asked again — the old answer at once meanwhile', async () => {
  const { s, asked, clock } = setup();
  await s.similarTo('Massive Attack');
  assert.strictEqual((await s.similarTo('MASSIVE ATTACK!')).length, 2);
  clock.now += 29 * DAY;
  await s.similarTo('massive attack');
  assert.strictEqual(asked.length, 1);
  clock.now += 2 * DAY;
  assert.strictEqual((await s.similarTo('Massive Attack')).length, 2); // stale, at once
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(asked.length, 2); // …and asked again behind it
});

test('offline: what was kept stands (from the file too); nothing kept, nothing — and no error', async () => {
  const first = setup();
  await first.s.similarTo('Massive Attack');
  const { s, asked } = setup(() => new TypeError('fetch failed'));
  assert.deepStrictEqual(await s.similarTo('Nobody'), []);
  assert.strictEqual(asked.length, 1);
  // the same file, read by a fresh one (CDPlayer started again, offline), long after
  const again = createSimilarArtists({ fetch: async () => { throw new TypeError('fetch failed'); }, read: () => first.file.text, write: () => {}, now: () => first.clock.now + 90 * DAY, wait: async () => {} });
  assert.strictEqual((await again.similarTo('Massive Attack')).length, 2);
});

test('an artist Last.fm doesn\'t know is kept as none for a week', async () => {
  const { s, asked, clock } = setup(() => ({ error: 6, message: 'The artist you supplied could not be found' }));
  assert.deepStrictEqual(await s.similarTo('Garage Band 2003'), []);
  clock.now += 6 * DAY;
  await s.similarTo('Garage Band 2003');
  assert.strictEqual(asked.length, 1);
  clock.now += 2 * DAY;
  await s.similarTo('Garage Band 2003');
  assert.strictEqual(asked.length, 2);
});

test('one at a time, a quarter of a second apart; the same artist asked twice at once is one request', async () => {
  const { s, asked, waited } = setup();
  const [a, b, c] = await Promise.all([s.similarTo('A'), s.similarTo('a'), s.similarTo('B')]);
  assert.strictEqual(asked.length, 2);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(c.length, 2);
  assert.deepStrictEqual(waited, [250]);
});

test('"too many at once" (error 29): nothing asked for a minute, nothing kept', async () => {
  let busy = true;
  const { s, asked, clock, file } = setup(() => (busy ? { error: 29, message: 'Rate limit exceeded' } : SIMILAR));
  assert.deepStrictEqual(await s.similarTo('A'), []);
  busy = false;
  assert.deepStrictEqual(await s.similarTo('B'), []);
  assert.strictEqual(asked.length, 1);
  assert.strictEqual(file.text, null);
  clock.now += 61e3;
  assert.strictEqual((await s.similarTo('B')).length, 2);
});
