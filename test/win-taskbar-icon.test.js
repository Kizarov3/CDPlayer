'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPinnedIcon, pngToIco, PINS_DIR } = require('../src/main/win-taskbar-icon');

const PNG = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'icon.png'));

test('the .ico holds the PNG whole, with a header Windows reads', () => {
  const ico = pngToIco(PNG, 128);
  assert.deepStrictEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 1]);
  assert.deepStrictEqual([ico[6], ico[7]], [128, 128]);
  assert.strictEqual(ico.readUInt32LE(14), PNG.length);
  assert.strictEqual(ico.readUInt32LE(18), 22);
  assert.ok(ico.subarray(22).equals(PNG));
  assert.deepStrictEqual([pngToIco(PNG, 256)[6], pngToIco(PNG, 256)[7]], [0, 0]); // 0 = 256
});

// Shortcuts as a map of path → { target, appUserModelId, icon, iconIndex }, with files on disk to list.
function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-pins-'));
  const appData = path.join(root, 'AppData'), dataDir = path.join(root, 'data'), pinsDir = PINS_DIR(appData);
  fs.mkdirSync(pinsDir, { recursive: true });
  const links = new Map(), notified = [];
  const pin = (name, l) => { const p = path.join(pinsDir, name); fs.writeFileSync(p, ''); links.set(p, { icon: '', iconIndex: 0, ...l }); return p; };
  const shell = {
    readShortcutLink: (p) => { if (!links.has(p)) throw new Error('no link'); return { ...links.get(p) }; },
    writeShortcutLink: (p, op, o) => { assert.strictEqual(op, 'update'); links.set(p, { ...links.get(p), ...o }); return true; },
  };
  const make = () => createPinnedIcon({ shell, appData, dataDir, appId: 'com.kizarov3.cdplayer', exe: 'C:\\Apps\\CDPlayer.exe', notify: (l) => notified.push(l) });
  return { root, dataDir, links, notified, pin, make, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('pinned: the pin wears the disc, and gets its own icon back when the disc comes out', () => {
  const w = world();
  try {
    const ours = w.pin('CDPlayer.lnk', { target: 'C:\\Apps\\CDPlayer.exe', appUserModelId: 'com.kizarov3.cdplayer', icon: 'C:\\Apps\\CDPlayer.exe', iconIndex: 0 });
    const other = w.pin('Notepad.lnk', { target: 'C:\\Windows\\notepad.exe', icon: 'C:\\Windows\\notepad.exe' });
    const icon = w.make();
    assert.strictEqual(icon.show(PNG), true);
    const disc = w.links.get(ours).icon;
    assert.match(disc, /disc-[0-9a-f]{12}\.ico$/);
    assert.ok(fs.readFileSync(disc).subarray(22).equals(PNG));
    assert.strictEqual(w.links.get(other).icon, 'C:\\Windows\\notepad.exe'); // someone else's pin is left alone
    assert.deepStrictEqual(w.notified.at(-1), [ours]);

    // Another disc: a new file (Explorer hasn't seen its name), the old one cleared away; still one record of the original.
    const png2 = Buffer.concat([PNG, Buffer.from([0])]);
    icon.show(png2);
    assert.notStrictEqual(w.links.get(ours).icon, disc);
    assert.ok(!fs.existsSync(disc));
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(w.dataDir, 'taskbar', 'pins.json'), 'utf8')).length, 1);

    icon.show(null);
    assert.strictEqual(w.links.get(ours).icon, 'C:\\Apps\\CDPlayer.exe');
    assert.deepStrictEqual(fs.readdirSync(path.join(w.dataDir, 'taskbar')), []);
  } finally { w.done(); }
});

test('a pin found by the exe it starts, and one with no icon of its own gets the exe\'s back', () => {
  const w = world();
  try {
    const ours = w.pin('CDPlayer (2).lnk', { target: 'c:\\apps\\cdplayer.exe' });
    const icon = w.make();
    icon.show(PNG);
    assert.match(w.links.get(ours).icon, /\.ico$/);
    icon.restore();
    assert.strictEqual(w.links.get(ours).icon, 'C:\\Apps\\CDPlayer.exe');
  } finally { w.done(); }
});

test('after a crash, the next launch puts the pin\'s own icon back', () => {
  const w = world();
  try {
    const ours = w.pin('CDPlayer.lnk', { target: 'C:\\Apps\\CDPlayer.exe', icon: 'C:\\Apps\\CDPlayer.exe', iconIndex: 0 });
    w.make().show(PNG); // …and the app dies here
    assert.match(w.links.get(ours).icon, /\.ico$/);
    assert.strictEqual(w.make().restore(), true); // a new run
    assert.strictEqual(w.links.get(ours).icon, 'C:\\Apps\\CDPlayer.exe');
    assert.strictEqual(w.make().restore(), false); // nothing left to do
  } finally { w.done(); }
});

test('not pinned: nothing is written', () => {
  const w = world();
  try {
    const icon = w.make();
    assert.strictEqual(icon.show(PNG), false);
    assert.ok(!fs.existsSync(path.join(w.dataDir, 'taskbar')));
    assert.deepStrictEqual(w.notified, []);
  } finally { w.done(); }
});
