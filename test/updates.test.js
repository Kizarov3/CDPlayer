'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const { checkForUpdate, isNewer } = require('../src/main/updates');

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const releasing = (version) => {
  const calls = [];
  const fetchLatest = async (current) => { calls.push(current); return version; };
  return { calls, fetchLatest };
};
const offline = async () => { throw new Error('offline'); };

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
  assert.strictEqual(await checkForUpdate('2.2.0', releasing('2.2.0')), null);
  assert.strictEqual(await checkForUpdate('2.3.0', releasing('2.2.0')), null);
  assert.strictEqual(await checkForUpdate('2.1.0', releasing(null)), null);
});

test('every check asks GitHub, so the newest release is always the one announced', async () => {
  // 2.3.0 and 2.3.1 came out an hour apart; a saved answer kept showing "2.3.0 AVAILABLE" to someone on 2.2.0.
  const first = releasing('2.3.0');
  assert.deepStrictEqual(await checkForUpdate('2.2.0', first), { version: '2.3.0' });
  const next = releasing('2.3.1');
  assert.deepStrictEqual(await checkForUpdate('2.2.0', next), { version: '2.3.1' });
  assert.strictEqual(first.calls.length, 1);
  assert.strictEqual(next.calls.length, 1);
});

test('nothing is saved between checks', async () => {
  await checkForUpdate('2.1.0', releasing('2.2.0'));
  assert.deepStrictEqual(fs.readdirSync(home), []);
  // Offline right after a check that found 2.2.0: no remembered answer to fall back on.
  assert.deepStrictEqual(await checkForUpdate('2.1.0', { fetchLatest: offline }), { offline: true });
});
