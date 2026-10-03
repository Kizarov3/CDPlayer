'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTaskbarDisc, registerArgs, pngToIco, REG_ROOT } = require('../src/main/win-taskbar-disc');

const APP = 'com.kizarov3.cdplayer';
const PNG1 = Buffer.from('disc one'), PNG2 = Buffer.from('disc two');

// A registry as a Map of key → values, with reg.exe's add/delete; `fail` makes every call fail.
function world({ fail = false } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-taskbar-'));
  const registry = new Map(), ids = [];
  const reg = async (args) => {
    if (fail) return false;
    const [op, key] = args;
    if (op === 'add') { const v = registry.get(key) || {}; v[args[3]] = args[7]; registry.set(key, v); return true; }
    if (op === 'delete') return registry.delete(key);
    return false;
  };
  const icons = [];
  const disc = (extra = {}) => createTaskbarDisc({ appId: APP, dataDir, setWindowAppId: (id, ico) => { ids.push(id); icons.push(ico); }, reg, ...extra });
  return { dataDir, registry, ids, icons, disc, done: () => fs.rmSync(dataDir, { recursive: true, force: true }) };
}
const keyOf = (id) => `${REG_ROOT}\\${id}`;

test('the registry commands name the ID CDPlayer, with the disc as its picture', () => {
  assert.deepStrictEqual(registerArgs('x.disc.1', 'C:\\d\\x.png'), [
    ['add', `${REG_ROOT}\\x.disc.1`, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', 'CDPlayer', '/f'],
    ['add', `${REG_ROOT}\\x.disc.1`, '/v', 'IconUri', '/t', 'REG_SZ', '/d', 'C:\\d\\x.png', '/f'],
  ]);
});

test('a disc gets an ID of its own, named CDPlayer with its picture; the next disc another; the old one goes', async () => {
  const w = world();
  try {
    const d = w.disc();
    await d.show(PNG1);
    const first = w.ids.at(-1);
    assert.match(first, /^com\.kizarov3\.cdplayer\.disc\.[0-9a-f]{12}$/);
    const v = w.registry.get(keyOf(first));
    assert.strictEqual(v.DisplayName, 'CDPlayer');
    assert.deepStrictEqual(fs.readFileSync(v.IconUri), PNG1);
    // …and the same picture as an .ico for the window's relaunch icon, which the button is drawn with
    assert.match(w.icons.at(-1), /\.ico$/);
    assert.ok(fs.readFileSync(w.icons.at(-1)).subarray(22).equals(PNG1));

    await d.show(PNG1); // the same disc again: nothing to do
    assert.strictEqual(w.ids.length, 1);

    await d.show(PNG2);
    const second = w.ids.at(-1);
    assert.notStrictEqual(second, first);
    assert.ok(!w.registry.has(keyOf(first)));
    assert.ok(!fs.existsSync(path.join(w.dataDir, 'taskbar', `${first}.png`)));
    assert.ok(!fs.existsSync(path.join(w.dataDir, 'taskbar', `${first}.ico`)));

    await d.show(null); // the disc out: the app's own ID, and nothing left in the registry
    assert.strictEqual(w.ids.at(-1), APP);
    assert.strictEqual(w.registry.size, 0);
  } finally { w.done(); }
});

test('only the newest of discs asked for quickly is put on', async () => {
  const w = world();
  try {
    const d = w.disc();
    await Promise.all([d.show(PNG1), d.show(PNG2)]);
    assert.strictEqual(w.ids.length, 1);
    assert.deepStrictEqual(fs.readFileSync(w.registry.get(keyOf(w.ids[0])).IconUri), PNG2);
    assert.strictEqual(w.registry.size, 1);
  } finally { w.done(); }
});

test('IDs left by a crash are taken out at the next launch, but not the one in use', async () => {
  const w = world();
  try {
    await w.disc().show(PNG1); // …and the app dies
    assert.strictEqual(w.registry.size, 1);
    const next = w.disc();
    await next.cleanUp();
    assert.strictEqual(w.registry.size, 0);
    await next.show(PNG2);
    await next.cleanUp();
    assert.strictEqual(w.registry.size, 1);
  } finally { w.done(); }
});

test('when the registry can\'t be written, the window keeps the app\'s ID (never an unnamed one)', async () => {
  const w = world({ fail: true });
  try {
    await w.disc().show(PNG1);
    assert.deepStrictEqual(w.ids, [APP]);
  } finally { w.done(); }
});

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

test('a disc whose ID couldn\'t be registered doesn\'t stand in the way of the one before coming back', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-taskbar-'));
  try {
    let failing = false;
    const registry = new Map(), ids = [];
    const reg = async (args) => {
      if (failing) return false;
      if (args[0] === 'add') { registry.set(args[1], true); return true; }
      return registry.delete(args[1]);
    };
    const d = createTaskbarDisc({ appId: APP, dataDir, setWindowAppId: (id) => ids.push(id), reg });
    await d.show(PNG1);
    const first = ids.at(-1);
    failing = true;
    await d.show(PNG2);
    assert.strictEqual(ids.at(-1), APP); // B couldn't be named: the app's own ID
    failing = false;
    await d.show(PNG1);
    assert.strictEqual(ids.at(-1), first); // A back on the button
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});
