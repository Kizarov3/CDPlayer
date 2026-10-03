'use strict';
/**
 * Windows: the disc that's in on the window's taskbar button. The taskbar doesn't draw a button from the window's
 * icon but from its app ID (AppUserModelID) — the icon of the Start menu shortcut carrying it (which the media controls
 * need, to say "CDPlayer" rather than "Unknown app") — so setting the window's icon changes the title bar, not the
 * button. While a disc is in, then, the window takes an ID of its own for that disc, named in the registry
 * (HKCU\Software\Classes\AppUserModelId\<id>: DisplayName "CDPlayer", IconUri the disc as a PNG), and the disc as an
 * .ico for its relaunch icon — the one the button is drawn with: the button wears the disc and the media controls still
 * say CDPlayer. One ID per disc, so the taskbar never has an old picture cached for
 * it. With the disc out the window goes back to the app's ID; IDs no longer used are taken out of the registry, and any
 * left by a run that didn't get to it (a crash) at the next launch.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const REG_ROOT = 'HKCU\\Software\\Classes\\AppUserModelId';

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

/** The registry commands (reg.exe arguments) that name `id` CDPlayer, with `icon` as its picture. */
function registerArgs(id, icon) {
  const key = `${REG_ROOT}\\${id}`;
  return [
    ['add', key, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', 'CDPlayer', '/f'],
    ['add', key, '/v', 'IconUri', '/t', 'REG_SZ', '/d', icon, '/f'],
  ];
}
const unregisterArgs = (id) => ['delete', `${REG_ROOT}\\${id}`, '/f'];

const runReg = (args) => new Promise((resolve) => execFile('reg.exe', args, { windowsHide: true }, (e) => resolve(!e)));

/**
 * { appId, dataDir, setWindowAppId(id, icoPath?), reg(args) → Promise<ok>, size } → { show(png | null), cleanUp() }.
 * `size` is the PNGs' width and height (dock-disc.js draws them 128 px).
 * Each disc's ID is `${appId}.disc.<hash of its picture>`; the IDs given out are written down (taskbar/ids.json).
 */
function createTaskbarDisc({ appId, dataDir, setWindowAppId, reg = runReg, size = 128 }) {
  const dir = path.join(dataDir, 'taskbar');
  const idsFile = path.join(dir, 'ids.json');
  const readIds = () => { try { const l = JSON.parse(fs.readFileSync(idsFile, 'utf8')); return Array.isArray(l) ? l : []; } catch { return []; } };
  const writeIds = (l) => { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(idsFile, JSON.stringify(l)); } catch { /* best effort */ } };
  let current = null, turn = 0;
  let queue = Promise.resolve(); // one registry job at a time: a clean-up never removes an ID being given out
  const serial = (job) => (queue = queue.then(job, job));

  // Every ID but `keep` out of the registry, and its picture off the disk.
  async function forget(keep) {
    const left = [];
    for (const id of readIds()) {
      if (id === keep) { left.push(id); continue; }
      if (!(await reg(unregisterArgs(id)))) left.push(id); // still there (or reg.exe failed): try again next time
      else for (const ext of ['png', 'ico']) fs.rmSync(path.join(dir, `${id}.${ext}`), { force: true });
    }
    writeIds(left);
  }

  /** The disc (PNG bytes) on the button, or null for the app's own icon. */
  function show(png) {
    const mine = ++turn; // a newer disc asked for meanwhile wins
    return serial(() => (mine === turn ? apply(png, mine) : null));
  }
  async function apply(png, mine) {
    if (!png) {
      current = null;
      setWindowAppId(appId);
      await forget(null);
      return;
    }
    const id = `${appId}.disc.${crypto.createHash('sha1').update(png).digest('hex').slice(0, 12)}`;
    if (id === current) return;
    const icon = path.join(dir, `${id}.png`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(icon, Buffer.from(png));
    const ico = path.join(dir, `${id}.ico`);
    fs.writeFileSync(ico, pngToIco(Buffer.from(png), size));
    writeIds([...new Set([...readIds(), id])]);
    let ok = true;
    for (const args of registerArgs(id, icon)) ok = (await reg(args)) && ok;
    if (mine !== turn) return;
    if (!ok) { setWindowAppId(appId); return; } // unnamed, the media controls would say "Unknown app": keep the app's ID
    current = id;
    setWindowAppId(id, ico);
    await forget(id);
  }

  return { show, cleanUp: () => serial(() => forget(current)) };
}

module.exports = { createTaskbarDisc, registerArgs, unregisterArgs, pngToIco, REG_ROOT };
