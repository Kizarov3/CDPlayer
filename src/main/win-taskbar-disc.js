'use strict';
/**
 * Windows: the disc that's in on the window's taskbar button. The taskbar doesn't draw a button from the window's
 * icon but from its relaunch icon (or, without one, its app ID's Start menu shortcut) — setting the window's icon
 * changes the title bar, not the button. So while a disc is in, the window's relaunch icon is the disc as an .ico; the
 * app ID stays CDPlayer's, so a pin is always CDPlayer's and the media controls say CDPlayer. One file per disc, so the
 * taskbar never has an old picture cached under its name; the ones no longer used are removed.
 *
 * Earlier builds (never released) gave each disc an app ID of its own instead, named in the registry — which made a pin
 * belong to one disc: those registry keys are taken out at launch.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const REG_ROOT = 'HKCU\\Software\\Classes\\AppUserModelId';
const unregisterArgs = (id) => ['delete', `${REG_ROOT}\\${id}`, '/f'];
const runReg = (args) => new Promise((resolve) => execFile('reg.exe', args, { windowsHide: true }, (e) => resolve(!e)));

/** PNG bytes (a square image up to 256 px) → an .ico holding it (Windows Vista and later read PNG inside an .ico). */
function pngToIco(png, size) {
  const header = Buffer.alloc(6 + 16);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); // reserved, icon, one image
  header.writeUInt8(size >= 256 ? 0 : size, 6); header.writeUInt8(size >= 256 ? 0 : size, 7); // 0 means 256
  header.writeUInt8(0, 8); header.writeUInt8(0, 9);    // no palette, reserved
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); // planes, bits per pixel
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18); // its size, where it starts
  return Buffer.concat([header, png]);
}

/**
 * { appId, dataDir, setWindowIcon(icoPath | null), reg(args) → Promise<ok>, size } → { show(png | null), cleanUp() }.
 * `size` is the PNGs' width and height (dock-disc.js draws them 128 px).
 */
function createTaskbarDisc({ appId, dataDir, setWindowIcon, reg = runReg, size = 128 }) {
  const dir = path.join(dataDir, 'taskbar');
  let current = null;

  // Every disc's .ico but `keep` off the disk.
  function removeIcons(keep) {
    let files = [];
    try { files = fs.readdirSync(dir); } catch { return; }
    for (const f of files) if (f.endsWith('.ico') && f !== keep) fs.rmSync(path.join(dir, f), { force: true });
  }

  /** The disc (PNG bytes) on the button, or null for the app's own icon. */
  function show(png) {
    if (!png) {
      current = null;
      setWindowIcon(null);
      removeIcons(null);
      return;
    }
    const name = `disc-${crypto.createHash('sha1').update(png).digest('hex').slice(0, 12)}.ico`;
    if (name === current) return;
    fs.mkdirSync(dir, { recursive: true });
    const ico = path.join(dir, name);
    fs.writeFileSync(ico, pngToIco(Buffer.from(png), size));
    current = name;
    setWindowIcon(ico);
    removeIcons(name);
  }

  // At launch: the per-disc app IDs earlier builds put in the registry (listed in taskbar/ids.json), and old files.
  async function cleanUp() {
    const idsFile = path.join(dir, 'ids.json');
    let ids = [];
    try { ids = JSON.parse(fs.readFileSync(idsFile, 'utf8')); } catch { /* none */ }
    const left = [];
    for (const id of Array.isArray(ids) ? ids : []) {
      if (typeof id !== 'string' || !id.startsWith(`${appId}.disc.`)) continue;
      if (!(await reg(unregisterArgs(id)))) left.push(id); // reg.exe failed: try again next launch
      for (const ext of ['png', 'ico']) fs.rmSync(path.join(dir, `${id}.${ext}`), { force: true });
    }
    if (left.length) fs.writeFileSync(idsFile, JSON.stringify(left)); else fs.rmSync(idsFile, { force: true });
    await reg(unregisterArgs(`${appId}.nowplaying`)); // the very first try's one ID for every disc
    removeIcons(current);
  }

  return { show, cleanUp };
}

module.exports = { createTaskbarDisc, pngToIco, unregisterArgs, REG_ROOT };
