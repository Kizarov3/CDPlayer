'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const { createOutputRate, deviceRate, findDevice, parseMacList, parseWinList } = require('../src/main/output-rate');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const MAC = [
  { name: 'MacBook Pro Speakers', uid: 'BuiltInSpeakerDevice', rate: 48000, rates: [44100, 48000, 88200, 96000], transport: 'bltn', isDefault: false },
  { name: 'External Headphones', uid: 'BuiltInHeadphoneOutputDevice', rate: 48000, rates: [44100, 48000, 88200, 96000], transport: 'bltn', isDefault: true },
  { name: 'AirPods Pro', uid: 'AA-BB', rate: 48000, rates: [48000], transport: 'blue', isDefault: false },
];

test('the rate a device can play nearest to the one wanted', () => {
  const r = [44100, 48000, 88200, 96000];
  assert.strictEqual(deviceRate(96000, r), 96000);
  assert.strictEqual(deviceRate(192000, r), 96000, 'same family, below');
  assert.strictEqual(deviceRate(176400, r), 88200, 'same family, below');
  assert.strictEqual(deviceRate(88200, [48000, 96000, 176400]), 176400, 'a whole multiple above');
  assert.strictEqual(deviceRate(44100, [48000, 96000]), 48000, 'nothing of its family: the nearest above');
  assert.strictEqual(deviceRate(192000, [32000, 48000]), 48000, 'the highest of its family below');
  assert.strictEqual(deviceRate(48000, []), null);
});

test('the helpers\' lists, read the same way', () => {
  const mac = parseMacList(MAC);
  assert.deepStrictEqual(mac[1], { id: 'BuiltInHeadphoneOutputDevice', name: 'External Headphones', rate: 48000, rates: [44100, 48000, 88200, 96000], bluetooth: false, isDefault: true });
  assert.strictEqual(mac[2].bluetooth, true);
  const one = { name: 'Speakers (Realtek(R) Audio)', id: '{0.0.0.00000000}.{abc}', rate: 48000, rates: [44100, 48000, 96000], enumerator: 'HDAUDIO', isDefault: true };
  assert.deepStrictEqual(parseWinList(one), [{ id: one.id, name: one.name, rate: 48000, rates: [44100, 48000, 96000], bluetooth: false, isDefault: true }], 'PowerShell gives a lone object for a one-item list');
  assert.strictEqual(parseWinList([{ ...one, enumerator: 'BTHENUM' }])[0].bluetooth, true);
  assert.deepStrictEqual(parseMacList('nonsense'), []);
});

test('the device by its Chromium label, or the default', () => {
  const devices = parseMacList(MAC);
  assert.strictEqual(findDevice(devices, null).id, 'BuiltInHeadphoneOutputDevice');
  assert.strictEqual(findDevice(devices, { id: 'hash', label: 'MacBook Pro Speakers (Built-in)' }).id, 'BuiltInSpeakerDevice');
  assert.strictEqual(findDevice(devices, { id: 'hash', label: 'AirPods Pro' }).id, 'AA-BB');
  assert.strictEqual(findDevice(devices, { id: 'hash', label: 'Gone' }).id, 'BuiltInHeadphoneOutputDevice', 'unknown name: the default');
});

function fakeMac() {
  const devices = MAC.map((d) => ({ ...d }));
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    if (args[0] === 'list') return devices.map((d) => ({ ...d }));
    const d = devices.find((x) => x.uid === args[1]);
    if (!d) throw new Error('no such device');
    d.rate = Number(args[2]);
    return { rate: d.rate };
  };
  return { devices, calls, run };
}

test('switching: the original rate written first, kept on a second change, restored and forgotten', async () => {
  const file = path.join(home, 'output-rate.json');
  const fake = fakeMac();
  const rate = createOutputRate({ platform: 'darwin', run: fake.run, file });
  assert.deepStrictEqual(await rate.set(null, 96000), { rate: 96000, switched: true, bluetooth: false });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { BuiltInHeadphoneOutputDevice: 48000 });
  assert.deepStrictEqual(await rate.set(null, 44100), { rate: 44100, switched: true, bluetooth: false });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { BuiltInHeadphoneOutputDevice: 48000 }, 'still the first rate');
  assert.deepStrictEqual(await rate.set(null, 192000), { rate: 96000, switched: true, bluetooth: false }, 'the nearest it can');
  await rate.restore();
  assert.strictEqual(fake.devices[1].rate, 48000);
  assert.ok(!fs.existsSync(file));
});

test('a device switched and then left (OUTPUT changed) is still restored', async () => {
  const file = path.join(home, 'output-rate.json');
  const fake = fakeMac();
  const rate = createOutputRate({ platform: 'darwin', run: fake.run, file });
  await rate.set(null, 96000);
  await rate.set({ id: 'h', label: 'MacBook Pro Speakers (Built-in)' }, 44100);
  await rate.restore();
  assert.strictEqual(fake.devices[0].rate, 48000);
  assert.strictEqual(fake.devices[1].rate, 48000);
});

test('left over from a crash: restored by the next run, an unplugged device just forgotten', async () => {
  const file = path.join(home, 'output-rate.json');
  fs.writeFileSync(file, JSON.stringify({ BuiltInHeadphoneOutputDevice: 44100, Unplugged: 48000 }));
  const fake = fakeMac();
  await createOutputRate({ platform: 'darwin', run: fake.run, file, log: () => {} }).restore();
  assert.strictEqual(fake.devices[1].rate, 44100);
  assert.ok(!fs.existsSync(file));
});

test('Bluetooth is never switched', async () => {
  const fake = fakeMac();
  const rate = createOutputRate({ platform: 'darwin', run: fake.run, file: path.join(home, 'bt.json') });
  assert.deepStrictEqual(await rate.set({ id: 'x', label: 'AirPods Pro' }, 44100), { rate: 48000, switched: false, bluetooth: true });
  assert.ok(!fake.calls.some((c) => c[0] === 'set'));
});

test('a switch asked for while the startup restore runs waits for it, so it isn\'t undone', async () => {
  const file = path.join(home, 'output-rate.json');
  fs.writeFileSync(file, JSON.stringify({ BuiltInHeadphoneOutputDevice: 48000 }));
  const fake = fakeMac();
  fake.devices[1].rate = 96000; // left switched by a run that crashed
  const rate = createOutputRate({ platform: 'darwin', run: fake.run, file });
  const restoring = rate.restore();
  const setting = rate.set(null, 44100);
  await Promise.all([restoring, setting]);
  assert.strictEqual(fake.devices[1].rate, 44100);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { BuiltInHeadphoneOutputDevice: 48000 });
  await rate.restore();
});

test('a helper that fails: null, never a throw; Linux: no helper at all', async () => {
  const broken = createOutputRate({ platform: 'win32', run: async () => { throw new Error('powershell missing'); }, file: path.join(home, 'x.json'), log: () => {} });
  assert.strictEqual(await broken.list(), null);
  assert.strictEqual(await broken.set(null, 96000), null);
  assert.strictEqual(await broken.current(null), null);
  let ran = false;
  const linux = createOutputRate({ platform: 'linux', run: async () => { ran = true; }, file: path.join(home, 'y.json') });
  assert.deepStrictEqual(await linux.list(), []);
  assert.strictEqual(await linux.set(null, 96000), null);
  await linux.restore();
  assert.strictEqual(ran, false);
});

test('set and restore are serialized: restore queues after set and puts the rate back', async () => {
  const file = path.join(home, 'serial.json');
  const devices = MAC.map((d) => ({ ...d }));
  let releaseSet;
  const run = async (args) => {
    if (args[0] === 'list') return devices.map((d) => ({ ...d }));
    if (args[0] === 'set') {
      const d = devices.find((x) => x.uid === args[1]);
      if (!d) throw new Error('no such device');
      // For the first set to 44100, block waiting for signal
      if (args[1] === 'BuiltInHeadphoneOutputDevice' && args[2] === '44100') {
        await new Promise((resolve) => { releaseSet = resolve; });
      }
      d.rate = Number(args[2]);
      return { rate: d.rate };
    }
  };
  const rate = createOutputRate({ platform: 'darwin', run, file });
  devices[1].rate = 96000;
  fs.writeFileSync(file, JSON.stringify({ BuiltInHeadphoneOutputDevice: 48000 }));
  const setPromise = rate.set(null, 44100);
  const restorePromise = rate.restore();
  await new Promise((r) => setImmediate(r));
  releaseSet();
  await Promise.all([setPromise, restorePromise]);
  assert.strictEqual(devices[1].rate, 48000, 'restore ran after set');
  assert.ok(!fs.existsSync(file));
});

test('a device whose restore set throws is kept in the file for the next try', async () => {
  const file = path.join(home, 'restore-failure.json');
  const devices = MAC.map((d) => ({ ...d }));
  let failSet = false;
  const run = async (args) => {
    if (args[0] === 'list') return devices.map((d) => ({ ...d }));
    if (args[0] === 'set') {
      if (failSet) throw new Error('helper timeout');
      const d = devices.find((x) => x.uid === args[1]);
      if (!d) throw new Error('no such device');
      d.rate = Number(args[2]);
      return { rate: d.rate };
    }
  };
  const rate = createOutputRate({ platform: 'darwin', run, file, log: () => {} });
  fs.writeFileSync(file, JSON.stringify({ BuiltInHeadphoneOutputDevice: 48000 }));
  devices[1].rate = 96000;
  failSet = true;
  await rate.restore();
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { BuiltInHeadphoneOutputDevice: 48000 }, 'entry kept after failed restore');
  assert.strictEqual(devices[1].rate, 96000, 'device not restored');
});

test('if list fails during restore, the file is not touched', async () => {
  const file = path.join(home, 'restore-list-fail.json');
  const run = async (args) => {
    if (args[0] === 'list') throw new Error('helper crashed');
    throw new Error('should not set');
  };
  const rate = createOutputRate({ platform: 'darwin', run, file, log: () => {} });
  fs.writeFileSync(file, JSON.stringify({ BuiltInHeadphoneOutputDevice: 48000, External: 96000 }));
  await rate.restore();
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { BuiltInHeadphoneOutputDevice: 48000, External: 96000 }, 'file unchanged after list failure');
});
