'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sections, writeUpdateInfo, UPDATE_INFO } = require('../scripts/appimage-update-info.js');
const { metainfo } = require('../build/before-pack.js');

// A minimal ELF64 runtime: a null section, .upd_info (1024 bytes, holding old text) and the section names.
function fakeRuntime() {
  const names = Buffer.from('\0.upd_info\0.shstrtab\0', 'latin1');
  const updAt = 0x100, namesAt = updAt + 1024, shoff = namesAt + 64, shentsize = 64, shnum = 3;
  const b = Buffer.alloc(shoff + shnum * shentsize + 32, 0);
  b.writeUInt32BE(0x7f454c46, 0); b[4] = 2; b[5] = 1;
  b.writeBigUInt64LE(BigInt(shoff), 0x28); b.writeUInt16LE(shentsize, 0x3a); b.writeUInt16LE(shnum, 0x3c); b.writeUInt16LE(2, 0x3e);
  const sh = (i, name, offset, size) => { const o = shoff + i * shentsize; b.writeUInt32LE(name, o); b.writeBigUInt64LE(BigInt(offset), o + 0x18); b.writeBigUInt64LE(BigInt(size), o + 0x20); };
  sh(1, 1, updAt, 1024); sh(2, 11, namesAt, names.length);
  names.copy(b, namesAt);
  b.write('old update information that is longer', updAt, 'latin1');
  return { b, updAt, end: shoff + shnum * shentsize };
}

test("the update information goes into the runtime's .upd_info, zero-padded, and the runtime's end is where the squashfs starts", () => {
  const { b, updAt, end } = fakeRuntime();
  assert.deepStrictEqual(sections(b).sections['.upd_info'], { offset: updAt, size: 1024 });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-appimage-')), 'x.AppImage');
  fs.writeFileSync(file, b);
  assert.strictEqual(writeUpdateInfo(file), end);
  const out = fs.readFileSync(file), slot = out.subarray(updAt, updAt + 1024);
  assert.strictEqual(slot.toString('utf8').replace(/\0+$/, ''), UPDATE_INFO);
  assert.ok(slot.subarray(Buffer.byteLength(UPDATE_INFO)).every((x) => x === 0));
  assert.deepStrictEqual(out.subarray(0, updAt), b.subarray(0, updAt)); // (nothing else changed)
  assert.deepStrictEqual(out.subarray(updAt + 1024), b.subarray(updAt + 1024));
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test("the update information names the latest release's .zsync of the Linux download, as the in-app updater names it", () => {
  assert.strictEqual(UPDATE_INFO, 'gh-releases-zsync|Kizarov3|CDPlayer|latest|CDPlayer-*-linux.AppImage.zsync');
  assert.strictEqual(require('../package.json').build.appImage.artifactName, '${productName}-${version}-linux.${ext}');
});

test('the AppStream entry gets this version and date, and nothing left to fill in', () => {
  const xml = metainfo('9.8.7', '2026-11-11');
  assert.match(xml, /<release version="9\.8\.7" date="2026-11-11">/);
  assert.match(xml, /releases\/tag\/v9\.8\.7/);
  assert.doesNotMatch(xml, /@[A-Z]+@/);
  assert.match(xml, /<id>com\.kizarov3\.cdplayer<\/id>/);
  assert.match(xml, /<launchable type="desktop-id">cdplayer\.desktop<\/launchable>/);
  for (const shot of xml.match(/docs\/screenshots\/[\w-]+\.jpg/g)) assert.ok(fs.existsSync(path.join(__dirname, '..', shot)), shot);
});

test('the in-app updater still takes the AppImage, not the .zsync published beside it', () => {
  const { pickAsset } = require('../src/main/updates.js');
  const asset = (name) => ({ name, browser_download_url: `https://example.com/${name}`, size: 1 });
  assert.strictEqual(pickAsset([asset('CDPlayer-2.22.0-linux.AppImage.zsync'), asset('CDPlayer-2.22.0-linux.AppImage')], 'linux').name, 'CDPlayer-2.22.0-linux.AppImage');
  assert.strictEqual(pickAsset([asset('CDPlayer-2.22.0-linux.AppImage.zsync')], 'linux'), null);
});
