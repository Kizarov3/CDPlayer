'use strict';
// VMP signing for Spotify's Widevine: at the right step of electron-builder for each system.
const test = require('node:test');
const assert = require('node:assert');
const { vmpSign } = require('../build/vmp-sign');
const afterSign = require('../build/vmp-sign-after-sign').default;

const run = async (hook, platform, appOutDir, env = { EVS_ACCOUNT_NAME: 'me' }) => {
  const calls = [];
  await vmpSign({ electronPlatformName: platform, appOutDir }, { hook, env, exec: (cmd, args) => calls.push(args.slice(2).join(' ')) });
  return calls;
};

test('macOS: signed after packing (before Apple’s signature), the merged universal app only', async () => {
  assert.deepStrictEqual(await run('afterPack', 'darwin', 'dist/mac-universal'), ['sign-pkg dist/mac-universal', 'verify-pkg dist/mac-universal']);
  assert.deepStrictEqual(await run('afterPack', 'darwin', 'dist/mac-universal-arm64-temp'), []);
  assert.deepStrictEqual(await run('afterSign', 'darwin', 'dist/mac-universal'), []);
});

test('Windows: signed after electron-builder has edited the exe (its icon and version), not before', async () => {
  assert.deepStrictEqual(await run('afterPack', 'win32', 'dist/win-unpacked'), []);
  assert.deepStrictEqual(await run('afterSign', 'win32', 'dist/win-unpacked'), ['sign-pkg dist/win-unpacked', 'verify-pkg dist/win-unpacked']);
});

test('Linux has no VMP, and without an EVS login nothing is signed', async () => {
  assert.deepStrictEqual(await run('afterPack', 'linux', 'dist/linux-unpacked'), []);
  assert.deepStrictEqual(await run('afterSign', 'win32', 'dist/win-unpacked', {}), []);
});

test('the afterSign entry point is the Windows step', () => {
  assert.strictEqual(typeof afterSign, 'function');
});
