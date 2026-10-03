'use strict';
/**
 * Windows, when CDPlayer is pinned to the taskbar: the pinned button always shows its pin's icon, never the window's,
 * so to show the disc that's in there the pin's shortcut itself is given the disc as its icon (an .ico next to the
 * app's data), and Explorer told to look again. Its own icon is put back when the disc comes out, when the app quits —
 * and, if it never got to (a crash), at the next launch: what the pin had is written down before it's changed.
 *
 * Explorer keeps pinned icons in a cache of its own, so it may be slow to pick a change up — each disc gets an .ico of
 * its own name, which it hasn't seen before, to help it along.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PINS_DIR = (appData) => path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar');

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
 * { shell, appData, dataDir, appId, exe, notify } → { show(png | null), restore() }.
 * shell: Electron's (readShortcutLink, writeShortcutLink); notify(linkPaths): tells Explorer the pins changed.
 */
function createPinnedIcon({ shell, appData, dataDir, appId, exe, notify = notifyExplorer }) {
  const dir = path.join(dataDir, 'taskbar');
  const saved = path.join(dir, 'pins.json'); // [{ link, icon, iconIndex }]: what each pin had before the disc
  const read = (link) => { try { return shell.readShortcutLink(link); } catch { return null; } };

  function pins() {
    const pinsDir = PINS_DIR(appData);
    let files = [];
    try { files = fs.readdirSync(pinsDir).filter((f) => f.toLowerCase().endsWith('.lnk')); } catch { return []; }
    return files.map((f) => path.join(pinsDir, f)).filter((link) => {
      const l = read(link);
      return l && (l.appUserModelId === appId || (l.target || '').toLowerCase() === exe.toLowerCase());
    });
  }
  const readSaved = () => { try { const s = JSON.parse(fs.readFileSync(saved, 'utf8')); return Array.isArray(s) ? s : []; } catch { return []; } };
  const removeIcons = (keep) => {
    try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.ico') && f !== keep) fs.rmSync(path.join(dir, f), { force: true }); } catch { /* none */ }
  };

  /** Puts each pin's own icon back (if the disc is on it), and forgets the disc's. */
  function restore() {
    const list = readSaved();
    if (!list.length) return false;
    for (const p of list) {
      try { if (fs.existsSync(p.link)) shell.writeShortcutLink(p.link, 'update', { icon: p.icon || exe, iconIndex: p.iconIndex || 0 }); } catch { /* gone */ }
    }
    fs.rmSync(saved, { force: true });
    removeIcons(null);
    notify(list.map((p) => p.link));
    return true;
  }

  /** The disc (PNG bytes) on the pinned button, or null for the app's own icon. → whether CDPlayer is pinned. */
  function show(png, size = 128) {
    if (!png) { restore(); return pins().length > 0; }
    const links = pins();
    if (!links.length) { restore(); return false; }
    fs.mkdirSync(dir, { recursive: true });
    const name = `disc-${crypto.createHash('sha1').update(png).digest('hex').slice(0, 12)}.ico`;
    const ico = path.join(dir, name);
    if (!fs.existsSync(ico)) fs.writeFileSync(ico, pngToIco(Buffer.from(png), size));
    // What each pin had, before it first gets a disc (a pin that already has one keeps its first record).
    const before = readSaved();
    const known = new Set(before.map((p) => p.link));
    for (const link of links) {
      if (known.has(link)) continue;
      const l = read(link) || {};
      before.push({ link, icon: l.icon || '', iconIndex: l.iconIndex || 0 });
    }
    fs.writeFileSync(saved, JSON.stringify(before));
    for (const link of links) {
      try { shell.writeShortcutLink(link, 'update', { icon: ico, iconIndex: 0 }); } catch { /* can't write it: left as it is */ }
    }
    removeIcons(name);
    notify(links);
    return true;
  }

  return { show, restore };
}

// Tells Explorer the pinned shortcuts changed (SHChangeNotify, as installers do), so the taskbar redraws them.
function notifyExplorer(links) {
  const ps = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const script = [
    "Add-Type -Namespace CDP -Name Shell -MemberDefinition '[DllImport(\"shell32.dll\", CharSet = CharSet.Unicode)] public static extern void SHChangeNotify(int e, uint f, string a, System.IntPtr b);'",
    ...links.map((l) => `[CDP.Shell]::SHChangeNotify(0x00002000, 0x0005, ${ps(l)}, [System.IntPtr]::Zero)`), // SHCNE_UPDATEITEM, SHCNF_PATHW
    "[CDP.Shell]::SHChangeNotify(0x08000000, 0x1000, $null, [System.IntPtr]::Zero)", // SHCNE_ASSOCCHANGED, SHCNF_FLUSH
  ].join('; ');
  try {
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch { /* the icon just updates later */ }
}

module.exports = { createPinnedIcon, pngToIco, PINS_DIR };
