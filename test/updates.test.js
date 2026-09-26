'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const { checkForUpdate, isNewer, CHECK_INTERVAL_MS } = require('../src/main/updates');

const cacheFile = path.join(home, 'update-check.txt');
test.beforeEach(() => fs.rmSync(cacheFile, { force: true }));
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const releasing = (version) => {
  const calls = [];
  const fetchLatest = async (current) => { calls.push(current); return version; };
  return { calls, fetchLatest };
};

test('version comparison', () => {
  assert.strictEqual(isNewer('2.2.0', '2.1.0'), true);
  assert.strictEqual(isNewer('v2.10.0', '2.9.9'), true);
  assert.strictEqual(isNewer('3.0.0', '2.99.99'), true);
  assert.strictEqual(isNewer('2.1.0', '2.1.0'), false);
  assert.strictEqual(isNewer('2.0.5', '2.1.0'), false);
  assert.strictEqual(isNewer('2.2.0-beta', '2.1.0'), false);
  assert.strictEqual(isNewer('', '2.1.0'), false);
});

test('reports a newer release, and not the one already running', async () => {
  assert.deepStrictEqual(await checkForUpdate('2.1.0', releasing('2.2.0')), { version: '2.2.0' });
  fs.rmSync(cacheFile);
  assert.strictEqual(await checkForUpdate('2.2.0', releasing('2.2.0')), null);
  fs.rmSync(cacheFile);
  assert.strictEqual(await checkForUpdate('2.1.0', releasing(null)), null);
});

test('asks GitHub at most once every 10 minutes', async () => {
  assert.strictEqual(CHECK_INTERVAL_MS, 10 * 60 * 1000);
  const now = 1_800_000_000_000;
  const first = releasing('2.2.0');
  await checkForUpdate('2.1.0', { now, ...first });
  assert.strictEqual(first.calls.length, 1);

  const soon = releasing('9.9.9');
  assert.deepStrictEqual(await checkForUpdate('2.1.0', { now: now + CHECK_INTERVAL_MS - 1, ...soon }), { version: '2.2.0' });
  assert.strictEqual(soon.calls.length, 0);

  const later = releasing('2.3.0');
  assert.deepStrictEqual(await checkForUpdate('2.1.0', { now: now + CHECK_INTERVAL_MS, ...later }), { version: '2.3.0' });
  assert.strictEqual(later.calls.length, 1);
});

test('a release that comes out an hour later is the one announced (not the one seen first)', async () => {
  // 2.3.0 and 2.3.1 were published an hour apart; a day-long cache kept showing "2.3.0 AVAILABLE" to someone on 2.2.0.
  const now = 1_800_000_000_000;
  assert.deepStrictEqual(await checkForUpdate('2.2.0', { now, ...releasing('2.3.0') }), { version: '2.3.0' });
  const hourLater = now + 60 * 60 * 1000; // the app's hourly re-check
  assert.deepStrictEqual(await checkForUpdate('2.2.0', { now: hourLater, ...releasing('2.3.1') }), { version: '2.3.1' });
});

test('once updated, the cached release no longer shows', async () => {
  await checkForUpdate('2.1.0', releasing('2.2.0'));
  assert.strictEqual(await checkForUpdate('2.2.0', releasing('2.2.0')), null);
});

test('offline keeps what was last known and retries next time', async () => {
  const now = 1_800_000_000_000;
  await checkForUpdate('2.1.0', { now, ...releasing('2.2.0') });
  const offline = async () => { throw new Error('offline'); };
  const later = now + CHECK_INTERVAL_MS * 2;
  assert.deepStrictEqual(await checkForUpdate('2.1.0', { now: later, fetchLatest: offline }), { version: '2.2.0' });
  const back = releasing('2.3.0');
  assert.deepStrictEqual(await checkForUpdate('2.1.0', { now: later + 1, ...back }), { version: '2.3.0' });
  assert.strictEqual(back.calls.length, 1);

  fs.rmSync(cacheFile);
  assert.strictEqual(await checkForUpdate('2.1.0', { now, fetchLatest: offline }), null);
});

test('a clock set backwards triggers a fresh check', async () => {
  const now = 1_800_000_000_000;
  await checkForUpdate('2.1.0', { now, ...releasing('2.2.0') });
  const back = releasing('2.3.0');
  assert.deepStrictEqual(await checkForUpdate('2.1.0', { now: now - 1000, ...back }), { version: '2.3.0' });
  assert.strictEqual(back.calls.length, 1);
});
