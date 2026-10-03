'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTaskbarDisc, pngToIco, REG_ROOT } = require('../src/main/win-taskbar-disc');

const APP = 'com.kizarov3.cdplayer';
const PNG1 = Buffer.from('disc one'), PNG2 = Buffer.from('disc two');

function world() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-taskbar-'));
  const icons = [], deleted = [];
  const reg = async (args) => { assert.strictEqual(args[0], 'delete'); deleted.push(args[1]); return true; };
  const disc = () => createTaskbarDisc({ appId: APP, dataDir, setWindowIcon: (ico) => icons.push(ico), reg });
  const files = () => { try { return fs.readdirSync(path.join(dataDir, 'taskbar')).sort(); } catch { return []; } };
  return { dataDir, icons, deleted, disc, files, done: () => fs.rmSync(dataDir, { recursive: true, force: true }) };
}

test('the .ico holds the PNG whole, with a header Windows reads', () => {
  const png = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'icon.png'));
  const ico = pngToIco(png, 128);
  assert.deepStrictEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 1]);
  assert.deepStrictEqual([ico[6], ico[7]], [128, 128]);
  assert.strictEqual(ico.readUInt32LE(14), png.length);
  assert.strictEqual(ico.readUInt32LE(18), 22);
  assert.ok(ico.subarray(22).equals(png));
  assert.deepStrictEqual([pngToIco(png, 256)[6], pngToIco(png, 256)[7]], [0, 0]); // 0 = 256
});

test('each disc is an .ico of its own for the window\'s relaunch icon; the old one goes; out, the app\'s icon', () => {
  const w = world();
  try {
    const d = w.disc();
    d.show(PNG1);
    const first = w.icons.at(-1);
    assert.match(path.basename(first), /^disc-[0-9a-f]{12}\.ico$/);
    assert.ok(fs.readFileSync(first).subarray(22).equals(PNG1));
    d.show(PNG1); // the same disc again: nothing to do
    assert.strictEqual(w.icons.length, 1);
    d.show(PNG2);
    assert.notStrictEqual(w.icons.at(-1), first);
    assert.deepStrictEqual(w.files(), [path.basename(w.icons.at(-1))]);
    d.show(null);
    assert.strictEqual(w.icons.at(-1), null);
    assert.deepStrictEqual(w.files(), []);
  } finally { w.done(); }
});

test('at launch, the per-disc app IDs earlier builds registered are taken out, and their files', async () => {
  const w = world();
  try {
    const dir = path.join(w.dataDir, 'taskbar');
    fs.mkdirSync(dir, { recursive: true });
    const old = `${APP}.disc.00c090abddf9`;
    fs.writeFileSync(path.join(dir, 'ids.json'), JSON.stringify([old, 'someone.else']));
    for (const ext of ['png', 'ico']) fs.writeFileSync(path.join(dir, `${old}.${ext}`), 'x');
    const d = w.disc();
    d.show(PNG1); // a disc already in while the clean-up runs keeps its icon
    await d.cleanUp();
    assert.deepStrictEqual(w.deleted, [`${REG_ROOT}\\${old}`, `${REG_ROOT}\\${APP}.nowplaying`]);
    assert.deepStrictEqual(w.files(), [path.basename(w.icons.at(-1))]);
  } finally { w.done(); }
});
