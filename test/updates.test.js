'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const { checkForUpdate, isNewer, pickAsset, installPlan, downloadAsset, installScript } = require('../src/main/updates');

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const releasing = (version) => {
  const calls = [];
  const fetchLatest = async (current) => { calls.push(current); return version && { version, asset: null }; };
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
  assert.deepStrictEqual(await checkForUpdate('2.1.0', releasing('2.2.0')), { version: '2.2.0', asset: null });
  assert.strictEqual(await checkForUpdate('2.2.0', releasing('2.2.0')), null);
  assert.strictEqual(await checkForUpdate('2.3.0', releasing('2.2.0')), null);
  assert.strictEqual(await checkForUpdate('2.1.0', releasing(null)), null);
});

test('every check asks GitHub, so the newest release is always the one announced', async () => {
  // 2.3.0 and 2.3.1 came out an hour apart; a saved answer kept showing "2.3.0 AVAILABLE" to someone on 2.2.0.
  const first = releasing('2.3.0');
  assert.deepStrictEqual(await checkForUpdate('2.2.0', first), { version: '2.3.0', asset: null });
  const next = releasing('2.3.1');
  assert.deepStrictEqual(await checkForUpdate('2.2.0', next), { version: '2.3.1', asset: null });
  assert.strictEqual(first.calls.length, 1);
  assert.strictEqual(next.calls.length, 1);
});

test('nothing is saved between checks', async () => {
  await checkForUpdate('2.1.0', releasing('2.2.0'));
  assert.deepStrictEqual(fs.readdirSync(home), []);
  // Offline right after a check that found 2.2.0: no remembered answer to fall back on.
  assert.deepStrictEqual(await checkForUpdate('2.1.0', { fetchLatest: offline }), { offline: true });
});

const ASSETS = [
  { name: 'CDPlayer-2.13.0-mac.dmg', size: 10, browser_download_url: 'https://x/mac', digest: `sha256:${'a'.repeat(64)}` },
  { name: 'CDPlayer-2.13.0-windows.exe', size: 20, browser_download_url: 'https://x/win' },
  { name: 'CDPlayer-2.13.0-linux.AppImage', size: 30, browser_download_url: 'https://x/linux' },
];

test('each system gets its own file from the release', () => {
  assert.deepStrictEqual(pickAsset(ASSETS, 'darwin'), { name: 'CDPlayer-2.13.0-mac.dmg', url: 'https://x/mac', size: 10, sha256: 'a'.repeat(64) });
  assert.strictEqual(pickAsset(ASSETS, 'win32').url, 'https://x/win');
  assert.strictEqual(pickAsset(ASSETS, 'win32').sha256, null);
  assert.strictEqual(pickAsset(ASSETS, 'linux').url, 'https://x/linux');
  assert.strictEqual(pickAsset(ASSETS, 'freebsd'), null);
  assert.strictEqual(pickAsset([], 'darwin'), null);
});

test('the app is replaced in place only where it can be', () => {
  const yes = () => true, no = () => false;
  const mac = (execPath, canWrite = yes) => installPlan({ platform: 'darwin', execPath, env: {}, canWrite });
  assert.deepStrictEqual(mac('/Applications/CDPlayer.app/Contents/MacOS/CDPlayer'), { kind: 'replace', target: '/Applications/CDPlayer.app' });
  assert.deepStrictEqual(mac('/Volumes/CDPlayer 2.12.0/CDPlayer.app/Contents/MacOS/CDPlayer'), { kind: 'open' }); // run from the disk image
  assert.deepStrictEqual(mac('/private/var/folders/x/T/AppTranslocation/1/d/CDPlayer.app/Contents/MacOS/CDPlayer'), { kind: 'open' });
  assert.deepStrictEqual(mac('/Applications/CDPlayer.app/Contents/MacOS/CDPlayer', no), { kind: 'open' }); // no write access
  assert.deepStrictEqual(mac('/usr/local/bin/electron'), { kind: 'open' });
  const win = installPlan({ platform: 'win32', execPath: 'C:\\T\\x\\CDPlayer.exe', env: { PORTABLE_EXECUTABLE_FILE: 'C:\\Apps\\CDPlayer.exe' }, canWrite: yes });
  assert.deepStrictEqual(win, { kind: 'replace', target: 'C:\\Apps\\CDPlayer.exe' });
  assert.deepStrictEqual(installPlan({ platform: 'win32', execPath: 'C:\\x\\CDPlayer.exe', env: {}, canWrite: yes }), { kind: 'open' }); // win-unpacked
  assert.deepStrictEqual(installPlan({ platform: 'linux', execPath: '/tmp/.mount/cdplayer', env: { APPIMAGE: '/home/a/CDPlayer.AppImage' }, canWrite: yes }), { kind: 'replace', target: '/home/a/CDPlayer.AppImage' });
  assert.deepStrictEqual(installPlan({ platform: 'linux', execPath: '/opt/CDPlayer/cdplayer', env: {}, canWrite: yes }), { kind: 'open' }); // AUR package
});

const serving = (bytes) => async () => new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('a download arrives whole, checked, under its own name', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-dl-'));
  try {
    const bytes = Buffer.from('the new CDPlayer');
    const seen = [];
    const file = await downloadAsset({ name: 'CDPlayer-2.13.0-mac.dmg', url: 'u', size: bytes.length, sha256: sha(bytes) }, dir, (f) => seen.push(f), { fetchImpl: serving(bytes) });
    assert.strictEqual(file, path.join(dir, 'CDPlayer-2.13.0-mac.dmg'));
    assert.deepStrictEqual(fs.readFileSync(file), bytes);
    assert.strictEqual(seen.at(-1), 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a short or altered download is refused and leaves nothing behind', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-dl-'));
  try {
    const bytes = Buffer.from('the new CDPlayer');
    await assert.rejects(downloadAsset({ name: 'a.dmg', url: 'u', size: bytes.length + 5, sha256: null }, dir, undefined, { fetchImpl: serving(bytes) }));
    await assert.rejects(downloadAsset({ name: 'a.dmg', url: 'u', size: bytes.length, sha256: 'b'.repeat(64) }, dir, undefined, { fetchImpl: serving(bytes) }));
    await assert.rejects(downloadAsset({ name: 'a.dmg', url: 'u', size: 1, sha256: null }, dir, undefined, { fetchImpl: async () => new Response('gone', { status: 404 }) }));
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the install scripts quote paths with spaces and quotes', () => {
  const paths = { pid: 42, file: "/tmp/it's here/CDPlayer.dmg", target: "/Users/o'neil/Apps/CDPlayer.app" };
  const mac = installScript('darwin', paths).text;
  assert.match(mac, /kill -0 42/);
  assert.ok(mac.includes(`'/Users/o'\\''neil/Apps/CDPlayer.app'`));
  const win = installScript('win32', { pid: 42, file: "C:\\Temp\\it's\\CDPlayer.exe", target: 'C:\\My Apps\\CDPlayer.exe' }).text;
  assert.ok(win.includes(`'C:\\Temp\\it''s\\CDPlayer.exe'`));
  assert.ok(win.includes(`-Destination 'C:\\My Apps\\CDPlayer.exe'`));
});

test('the AppImage script swaps the file once the old app has quit, and starts the new one', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-swap-'));
  try {
    const target = path.join(dir, "My Apps", "CDPlayer.AppImage");
    fs.mkdirSync(path.dirname(target));
    fs.writeFileSync(target, '#!/bin/sh\necho old > "$0.ran"\n', { mode: 0o755 });
    const file = path.join(dir, 'CDPlayer-2.13.0-linux.AppImage');
    fs.writeFileSync(file, `#!/bin/sh\necho new > '${target}.ran'\n`);
    const gone = execFileSync('/bin/sh', ['-c', 'sh -c "exit 0" & echo $!']).toString().trim(); // a pid that has exited
    const script = path.join(dir, 'install.sh');
    fs.writeFileSync(script, installScript('linux', { pid: gone, file, target }).text);
    execFileSync('/bin/sh', [script]);
    for (let i = 0; i < 50 && !fs.existsSync(`${target}.ran`); i++) execFileSync('sleep', ['0.1']);
    assert.match(fs.readFileSync(target, 'utf8'), /echo new/);
    assert.strictEqual(fs.readFileSync(`${target}.ran`, 'utf8'), 'new\n');
    assert.ok(!fs.existsSync(file));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
