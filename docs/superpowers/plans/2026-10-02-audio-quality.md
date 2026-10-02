# Audio quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings → QUALITY (HIGH / LOSSLESS / HI-RES LOSSLESS): each song plays at its own sample rate, with the output device's rate switched to match on macOS and Windows, and a LOSSLESS / HI-RES LOSSLESS badge under the title.

**Architecture:** A pure renderer module (`quality.js`) decides the rate a song should play at and words the badge. The engine (`audio.js`) can rebuild its Web Audio graph at a given rate. A main-process module (`output-rate.js`) switches the output device's rate through a small helper per OS (a Swift binary on macOS, a PowerShell + C# script on Windows), remembers the original rate in `output-rate.json` and restores it. `app.js` asks for the rate before loading each file track.

**Tech Stack:** Electron (castLabs build), Web Audio, Node `node:test`, Swift + CoreAudio (macOS helper), PowerShell + C# `Add-Type` with Core Audio COM interfaces (Windows helper), electron-builder.

**Spec:** `docs/superpowers/specs/2026-10-02-audio-quality-design.md`

## Global Constraints

- Levels are stored as `HIGH` | `LOSSLESS` | `HIRES` on `settings.txt` line 19; missing or unknown → `HIGH`.
- LOSSLESS plays a song at its own rate up to 48000; HI-RES LOSSLESS up to 192000. Above the cap, the rate is lowered within its family (44.1 kHz ×n or 48 kHz ×n), e.g. 88200 → 44100 under LOSSLESS, 352800 → 176400 under HI-RES. (Refines the spec's "above that: 48000/192000" so the lowering is always a whole ratio.)
- HIGH never touches the device; switching to HIGH restores every device CDPlayer changed, at once.
- Bluetooth devices are never switched (macOS transport `blue`/`blea`; Windows enumerator `BTHENUM`/`BTHLEDEVICE`).
- Every user-visible text goes through `t()` and gets its Russian in `src/locales/ru.json` (`test/i18n-locales.test.mjs` fails otherwise).
- Tests never touch the real `~/.cdplayer`: Node tests set `process.env.CDPLAYER_HOME` to a temp dir before requiring `src/main/*`.
- Commits: no Claude co-author or "Generated with" lines (the user is sole contributor). Commit messages in the repo's style: a plain sentence saying what now happens.
- Helper calls time out after 5 s; any helper failure means "couldn't switch", never an exception that stops playback.
- Spotify tracks are untouched: no rate change, no badge.

## Review Focus

- The user changes OUTPUT while a device is switched → the old device must still be restored on quit (restore covers every device in `output-rate.json`, not only the current one). Test in Task 2.
- A track load superseded while the helper is switching (user skips fast) → the newer track's rate wins and nothing throws. `applyQuality` checks `loadToken` after every await (Task 7, Step 1); checked by hand in Task 7, Step 7, item 9.
- The startup restore of a crashed run racing the first song's switch → the switch waits for the restore. Test in Task 2.
- Crossfade into a track at a different rate → a plain cut, never two decks from two AudioContexts. Test in Task 6 (setRate disposes the outgoing deck) and Task 7 (fade forced to 0).
- CDPlayer killed while a device is switched → restored at the next launch from the leftover `output-rate.json`. Test in Task 2.
- The helper missing (dev run without a built binary, Linux, broken PowerShell) → music plays, badge says the rate couldn't be set. Test in Task 2.

---

### Task 1: The pure quality rules (`quality.js`)

**Files:**
- Create: `src/renderer/js/quality.js`
- Test: `test/quality.test.mjs`

**Interfaces:**
- Consumes: `t` from `src/renderer/js/i18n.js` (returns the key itself in tests, with `{name}` placeholders filled).
- Produces:
  - `LEVELS: ['HIGH', 'LOSSLESS', 'HIRES']`
  - `capRate(rate: number, cap: number) → number`
  - `targetRate(level: string, fileRate: number|undefined) → number|null` (null: leave the engine as it is — HIGH, or rate unknown)
  - `badgeLabel(format: {sampleRate, bitsPerSample, lossless}|null|undefined, level: string) → string|null`
  - `badgeText(info: { fileRate, aimed, deviceRate, switched, bluetooth, eq, mono }) → string`
  - `badgeExact(info) → boolean`
  - `levelName(level: string, long?: boolean) → string`
  - `khz(hz: number) → string` (`'96 KHZ'`, `'44.1 KHZ'`)

- [ ] **Step 1: Write the failing test**

`test/quality.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { LEVELS, capRate, targetRate, badgeLabel, badgeText, badgeExact, levelName, khz } from '../src/renderer/js/quality.js';

test('three levels, as in Apple Music', () => {
  assert.deepStrictEqual(LEVELS, ['HIGH', 'LOSSLESS', 'HIRES']);
  assert.deepStrictEqual(LEVELS.map((l) => levelName(l)), ['HIGH', 'LOSSLESS', 'HI-RES LOSSLESS']);
  assert.strictEqual(levelName('HIRES', true), 'HI-RES LOSSLESS · UP TO 24-BIT / 192 KHZ');
  assert.strictEqual(levelName('LOSSLESS', true), 'LOSSLESS · UP TO 24-BIT / 48 KHZ');
  assert.strictEqual(levelName('nonsense'), 'HIGH');
});

test('above the cap, a rate is lowered within its family: a whole ratio', () => {
  assert.deepStrictEqual([44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000].map((r) => capRate(r, 48000)),
    [44100, 48000, 44100, 48000, 44100, 48000, 44100, 48000]);
  assert.deepStrictEqual([44100, 96000, 192000, 352800, 384000].map((r) => capRate(r, 192000)), [44100, 96000, 192000, 176400, 192000]);
  assert.strictEqual(capRate(22050, 48000), 22050);
});

test('the rate a song plays at, per level', () => {
  assert.strictEqual(targetRate('HIGH', 96000), null);
  assert.strictEqual(targetRate('LOSSLESS', 44100), 44100);
  assert.strictEqual(targetRate('LOSSLESS', 96000), 48000);
  assert.strictEqual(targetRate('HIRES', 96000), 96000);
  assert.strictEqual(targetRate('HIRES', 352800), 176400);
  assert.strictEqual(targetRate('HIRES', undefined), null);
  assert.strictEqual(targetRate('HIRES', 0), null);
});

test('the badge: lossless files only, hi-res above 48 kHz at 24-bit, by the rate actually aimed at', () => {
  const f = (sampleRate, bitsPerSample, lossless = true) => ({ sampleRate, bitsPerSample, lossless });
  assert.strictEqual(badgeLabel(f(44100, 16), 'HIGH'), null);
  assert.strictEqual(badgeLabel(f(44100, 16, false), 'HIRES'), null);
  assert.strictEqual(badgeLabel(null, 'HIRES'), null);
  assert.strictEqual(badgeLabel(f(44100, 16), 'HIRES'), '◈ LOSSLESS');
  assert.strictEqual(badgeLabel(f(96000, 24), 'HIRES'), '◈ HI-RES LOSSLESS');
  assert.strictEqual(badgeLabel(f(96000, 16), 'HIRES'), '◈ LOSSLESS');
  assert.strictEqual(badgeLabel(f(96000, 24), 'LOSSLESS'), '◈ LOSSLESS');
});

test('what reaches the output, said plainly', () => {
  assert.strictEqual(khz(44100), '44.1 KHZ');
  assert.strictEqual(khz(96000), '96 KHZ');
  const base = { fileRate: 96000, aimed: 96000, deviceRate: 96000, switched: true, bluetooth: false, eq: false, mono: false };
  assert.strictEqual(badgeText(base), 'OUTPUT: 96 KHZ — NOT RESAMPLED');
  assert.ok(badgeExact(base));
  assert.strictEqual(badgeText({ ...base, fileRate: 192000, aimed: 192000 }), "OUTPUT: 96 KHZ — RESAMPLED (THE DEVICE CAN'T PLAY 192 KHZ)");
  assert.strictEqual(badgeText({ ...base, deviceRate: 48000, switched: false }), 'OUTPUT: 48 KHZ — RESAMPLED (SET THE RATE IN YOUR SOUND SETTINGS)');
  assert.strictEqual(badgeText({ ...base, aimed: 48000, deviceRate: 48000 }), 'OUTPUT: 48 KHZ — LOWERED FROM 96 KHZ (HI-RES LOSSLESS PLAYS IT IN FULL)');
  assert.ok(!badgeExact({ ...base, aimed: 48000, deviceRate: 48000 }));
  assert.strictEqual(badgeText({ ...base, bluetooth: true }), 'BLUETOOTH: QUALITY IS LIMITED BY THE WIRELESS CODEC');
  assert.ok(!badgeExact({ ...base, bluetooth: true }));
  assert.strictEqual(badgeText({ ...base, eq: true }), 'OUTPUT: 96 KHZ — NOT RESAMPLED\nTHE EQUALIZER OR MONO CHANGES THE SOUND');
  assert.strictEqual(badgeText({ ...base, deviceRate: 96000, switched: false }), 'OUTPUT: 96 KHZ — NOT RESAMPLED');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/quality.test.mjs`
Expected: FAIL with `Cannot find module '…/src/renderer/js/quality.js'`

- [ ] **Step 3: Write minimal implementation**

`src/renderer/js/quality.js`:

```js
// Settings → QUALITY, as in Apple Music: HIGH plays everything at the system's rate (as CDPlayer always did);
// LOSSLESS and HI-RES LOSSLESS play each song at its own sample rate, up to 48 and 192 kHz, with the output device
// switched to match (src/main/output-rate.js). These are the pure rules: which rate, and what the badge says.
import { t } from './i18n.js';

export const LEVELS = ['HIGH', 'LOSSLESS', 'HIRES'];
const CAP = { LOSSLESS: 48000, HIRES: 192000 };

/** '96 KHZ', '44.1 KHZ'. */
export function khz(hz) {
  const k = hz / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)} KHZ`;
}

/** A level's name for the Settings button, or (long) for its menu. */
export function levelName(level, long = false) {
  if (level === 'LOSSLESS') return long ? t('LOSSLESS · UP TO 24-BIT / 48 KHZ') : t('LOSSLESS');
  if (level === 'HIRES') return long ? t('HI-RES LOSSLESS · UP TO 24-BIT / 192 KHZ') : t('HI-RES LOSSLESS');
  return t('HIGH');
}

/** `rate`, or — above `cap` — the highest rate of its family (44.1 kHz ×2ⁿ or 48 kHz ×2ⁿ) that fits: a whole ratio. */
export function capRate(rate, cap) {
  if (rate <= cap) return rate;
  let r = rate % 11025 === 0 ? 44100 : 48000;
  while (r * 2 <= cap) r *= 2;
  return r;
}

/** The rate a song should play at under `level`; null leaves the engine as it is (HIGH, or the rate isn't known). */
export function targetRate(level, fileRate) {
  if (!CAP[level] || !(fileRate > 0)) return null;
  return capRate(fileRate, CAP[level]);
}

/** '◈ LOSSLESS' / '◈ HI-RES LOSSLESS' for a lossless file under LOSSLESS or HI-RES, by the rate it's played at. */
export function badgeLabel(format, level) {
  if (!format || !format.lossless || !CAP[level]) return null;
  const aimed = targetRate(level, format.sampleRate);
  if (!aimed) return null;
  return aimed > 48000 && (format.bitsPerSample || 0) >= 24 ? `◈ ${t('HI-RES LOSSLESS')}` : `◈ ${t('LOSSLESS')}`;
}

/** True when the song reaches the output exactly as it is in the file. */
export function badgeExact({ fileRate, aimed, deviceRate, bluetooth }) {
  return !bluetooth && deviceRate === aimed && aimed === fileRate;
}

/** The badge's tooltip: what reaches the output, and why when it isn't the file's own rate. */
export function badgeText({ fileRate, aimed, deviceRate, switched, bluetooth, eq, mono }) {
  let line;
  if (bluetooth) line = t('BLUETOOTH: QUALITY IS LIMITED BY THE WIRELESS CODEC');
  else if (deviceRate === aimed) {
    line = aimed < fileRate
      ? t('OUTPUT: {rate} — LOWERED FROM {file} (HI-RES LOSSLESS PLAYS IT IN FULL)', { rate: khz(aimed), file: khz(fileRate) })
      : t('OUTPUT: {rate} — NOT RESAMPLED', { rate: khz(aimed) });
  } else if (switched) line = t("OUTPUT: {rate} — RESAMPLED (THE DEVICE CAN'T PLAY {file})", { rate: khz(deviceRate), file: khz(aimed) });
  else line = t('OUTPUT: {rate} — RESAMPLED (SET THE RATE IN YOUR SOUND SETTINGS)', { rate: khz(deviceRate) });
  return eq || mono ? `${line}\n${t('THE EQUALIZER OR MONO CHANGES THE SOUND')}` : line;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/quality.test.mjs`
Expected: PASS (5 tests). If `t()` doesn't fill `{rate}` outside the app, check how `test/output.test.mjs` gets `SYSTEM DEFAULT` back from `t()` and follow it.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/js/quality.js test/quality.test.mjs
git commit -m "The quality rules: which rate a song plays at under LOSSLESS and HI-RES LOSSLESS, and what its badge says"
```

---

### Task 2: Switching the device's rate, remembered and restored (`output-rate.js`)

**Files:**
- Create: `src/main/output-rate.js`
- Test: `test/output-rate.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (CommonJS):
  - `createOutputRate({ platform: string, run: (args: string[]) => Promise<any>, file: string, log?: (msg) => void })` → `{ list(), current(device), set(device, hz), restore() }`
    - `list() → Promise<Device[] | null>` (`[]` on Linux, `null` if the helper failed). `Device = { id, name, rate, rates: number[], bluetooth: boolean, isDefault: boolean }`
    - `current(device) → Promise<number|null>`
    - `set(device, hz) → Promise<{ rate: number, switched: boolean, bluetooth: boolean } | null>`
    - `restore() → Promise<void>`
  - pure: `deviceRate(wanted, supported) → number|null`, `findDevice(devices, device) → Device|null`, `parseMacList(json) → Device[]`, `parseWinList(json) → Device[]`
  - `device` (input) is `{ id, label }` as `settings.output` stores it, or `null` for the system default.

- [ ] **Step 1: Write the failing test**

`test/output-rate.test.js`:

```js
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
  await createOutputRate({ platform: 'darwin', run: fake.run, file }).restore();
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/output-rate.test.js`
Expected: FAIL with `Cannot find module '../src/main/output-rate'`

- [ ] **Step 3: Write minimal implementation**

`src/main/output-rate.js`:

```js
'use strict';
/**
 * Settings → QUALITY's other half: the output device's sample rate, switched to the song's on macOS (mac-rate, a small
 * CoreAudio helper) and Windows (win-rate/helper.ps1, the device's default format) — so a 96 kHz song reaches the
 * headphones at 96 kHz instead of being resampled to whatever the system was set to. Before its first change to a
 * device, the rate it had is written to output-rate.json; restore() puts every one back (on quit, on switching to
 * HIGH, and at startup if CDPlayer didn't get to quit). Bluetooth outputs are never touched: their codec decides.
 */
const fs = require('fs');

const family = (r) => (r % 11025 === 0 ? 44100 : 48000);

/** The rate a device that plays `supported` should be set to for a song at `wanted`; null if nothing's known. */
function deviceRate(wanted, supported) {
  const rates = [...new Set(supported || [])].filter((r) => r > 0).sort((a, b) => a - b);
  if (!rates.length) return null;
  if (rates.includes(wanted)) return wanted;
  const multiple = rates.find((r) => r > wanted && r % wanted === 0);
  if (multiple) return multiple;
  const kin = rates.filter((r) => r < wanted && family(r) === family(wanted));
  if (kin.length) return kin[kin.length - 1];
  const above = rates.find((r) => r > wanted);
  if (above) return above;
  return rates[rates.length - 1];
}

const asList = (json) => (Array.isArray(json) ? json : json && typeof json === 'object' ? [json] : []);
const rateList = (rates) => asList(rates).map(Number).filter((r) => r > 0);

/** mac-rate's `list`: [{ name, uid, rate, rates, transport, isDefault }] → devices. */
function parseMacList(json) {
  return asList(json).filter((d) => d && d.uid).map((d) => ({
    id: String(d.uid), name: String(d.name || ''), rate: Number(d.rate) || null, rates: rateList(d.rates),
    bluetooth: d.transport === 'blue' || d.transport === 'blea', isDefault: !!d.isDefault,
  }));
}
/** win-rate's `list`: [{ name, id, rate, rates, enumerator, isDefault }] (or one lone object) → devices. */
function parseWinList(json) {
  return asList(json).filter((d) => d && d.id).map((d) => ({
    id: String(d.id), name: String(d.name || ''), rate: Number(d.rate) || null, rates: rateList(d.rates),
    bluetooth: /^BTH/i.test(String(d.enumerator || '')), isDefault: !!d.isDefault,
  }));
}

/** The device Settings → OUTPUT means ({ id, label } from Chromium, or null): found by its name, else the default. */
function findDevice(devices, device) {
  const fallback = devices.find((d) => d.isDefault) || null;
  if (!device || !device.label) return fallback;
  const label = device.label.replace(/^Default - /, '');
  const bare = label.replace(/\s*\([^)]*\)\s*$/, '');
  return devices.find((d) => d.name === label) || devices.find((d) => d.name === bare) || fallback;
}

function createOutputRate({ platform, run, file, log = (msg) => console.warn(msg) }) {
  const parse = platform === 'darwin' ? parseMacList : platform === 'win32' ? parseWinList : null;
  let warned = false, busy = Promise.resolve();
  const fail = (e) => { if (!warned) { warned = true; log(`output rate: ${e && e.message ? e.message : e}`); } return null; };
  const readOriginals = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; } };
  const writeOriginals = (o) => { if (Object.keys(o).length) fs.writeFileSync(file, JSON.stringify(o)); else fs.rmSync(file, { force: true }); };

  async function list() {
    if (!parse) return [];
    try { return parse(await run(['list'])); } catch (e) { return fail(e); }
  }
  async function current(device) {
    const devices = await list();
    const d = devices && findDevice(devices, device);
    return d ? d.rate : null;
  }
  async function set(device, hz) {
    if (!parse) return null;
    await busy; // a restore still running (the one at startup) mustn't undo this
    const devices = await list();
    const d = devices && findDevice(devices, device);
    if (!d) return null;
    if (d.bluetooth) return { rate: d.rate, switched: false, bluetooth: true };
    const target = deviceRate(hz, d.rates.length ? d.rates : [d.rate]);
    if (!target) return null;
    if (target === d.rate) return { rate: target, switched: true, bluetooth: false };
    const originals = readOriginals();
    if (!(d.id in originals)) { originals[d.id] = d.rate; writeOriginals(originals); }
    try {
      const res = await run(['set', d.id, String(target)]);
      const rate = Number(res && res.rate) || null;
      return { rate: rate || d.rate, switched: rate === target, bluetooth: false };
    } catch (e) { return fail(e); }
  }
  function restore() {
    const job = busy.then(restoreNow);
    busy = job.catch(() => {});
    return job;
  }
  async function restoreNow() {
    if (!parse) return;
    const originals = readOriginals();
    for (const [id, rate] of Object.entries(originals)) {
      try { await run(['set', id, String(rate)]); } catch (e) { fail(e); } // unplugged: nothing to put back
      delete originals[id];
    }
    writeOriginals(originals);
  }
  return { list, current, set, restore };
}

module.exports = { createOutputRate, deviceRate, findDevice, parseMacList, parseWinList };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/output-rate.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/output-rate.js test/output-rate.test.js
git commit -m "The output device's rate switched to the song's, its first rate kept in output-rate.json and put back; Bluetooth left alone"
```

---

### Task 3: The macOS helper (`mac-rate`), built and packed

**Files:**
- Create: `src/main/mac-rate/rate.swift`
- Create: `scripts/build-mac-rate.js`
- Create: `build/before-pack.js`
- Modify: `package.json` (scripts `prestart`, `build.beforePack`, `build.mac.extraResources`, `build.mac.x64ArchFiles`)
- Modify: `.gitignore` (add `build/bin/`)
- Test: by hand on this Mac (CoreAudio can't be faked usefully); `test/output-rate.test.js` already covers parsing.

**Interfaces:**
- Consumes: the `mac-rate list` / `mac-rate set` JSON shapes that `parseMacList` and `set()` read (Task 2).
- Produces: `build/bin/mac-rate` (universal arm64 + x86_64), shipped at `CDPlayer.app/Contents/Resources/mac-rate`; `scripts/build-mac-rate.js` exporting `buildMacRate() → string|null` (the binary's path, or null off macOS).

- [ ] **Step 1: Write the Swift helper**

`src/main/mac-rate/rate.swift`:

```swift
// CDPlayer's output-rate helper for macOS (see src/main/output-rate.js).
//   mac-rate list                  → [{ name, uid, rate, rates, transport, isDefault }] for every output device
//   mac-rate set <uid|default> <hz> → { rate } once the device reports the new rate (2 s at most)
import CoreAudio
import Foundation

func address(_ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: 0) // the main element (kAudioObjectPropertyElementMain, which needs macOS 12 to name)
}

func array<T>(_ object: AudioObjectID, _ addr: AudioObjectPropertyAddress, _: T.Type) -> [T] {
  var a = addr
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(object, &a, 0, nil, &size) == noErr, size > 0 else { return [] }
  let count = Int(size) / MemoryLayout<T>.stride
  let buffer = UnsafeMutablePointer<T>.allocate(capacity: count)
  defer { buffer.deallocate() }
  guard AudioObjectGetPropertyData(object, &a, 0, nil, &size, buffer) == noErr else { return [] }
  return Array(UnsafeBufferPointer(start: buffer, count: count))
}

func value<T>(_ object: AudioObjectID, _ addr: AudioObjectPropertyAddress, _ initial: T) -> T? {
  var a = addr
  var v = initial
  var size = UInt32(MemoryLayout<T>.size)
  return AudioObjectGetPropertyData(object, &a, 0, nil, &size, &v) == noErr ? v : nil
}

func string(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
  var a = address(selector)
  var v: Unmanaged<CFString>?
  var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  guard AudioObjectGetPropertyData(object, &a, 0, nil, &size, &v) == noErr, let s = v else { return nil }
  return s.takeRetainedValue() as String
}

func fourCC(_ code: UInt32) -> String {
  let bytes = [24, 16, 8, 0].map { UInt8((code >> UInt32($0)) & 0xFF) }
  return String(bytes: bytes, encoding: .ascii) ?? ""
}

let system = AudioObjectID(kAudioObjectSystemObject)
let standardRates: [Double] = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000]

func outputs() -> [AudioObjectID] {
  array(system, address(kAudioHardwarePropertyDevices), AudioObjectID.self).filter {
    !array($0, address(kAudioDevicePropertyStreams, kAudioObjectPropertyScopeOutput), AudioStreamID.self).isEmpty
  }
}

func rate(_ device: AudioObjectID) -> Double { value(device, address(kAudioDevicePropertyNominalSampleRate), Float64(0)) ?? 0 }

func rates(_ device: AudioObjectID) -> [Double] {
  var found = Set<Double>()
  for r in array(device, address(kAudioDevicePropertyAvailableNominalSampleRates), AudioValueRange.self) {
    if r.mMinimum == r.mMaximum { found.insert(r.mMinimum) }
    else { for s in standardRates where s >= r.mMinimum && s <= r.mMaximum { found.insert(s) } }
  }
  return found.sorted()
}

func defaultOutput() -> AudioObjectID { value(system, address(kAudioHardwarePropertyDefaultOutputDevice), AudioObjectID(0)) ?? 0 }

func printJSON(_ object: Any) {
  let data = try! JSONSerialization.data(withJSONObject: object, options: [])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write("\(message)\n".data(using: .utf8)!)
  exit(1)
}

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "list":
  let def = defaultOutput()
  printJSON(outputs().map { d -> [String: Any] in
    [
      "name": string(d, kAudioObjectPropertyName) ?? "",
      "uid": string(d, kAudioDevicePropertyDeviceUID) ?? "",
      "rate": rate(d),
      "rates": rates(d),
      "transport": fourCC(value(d, address(kAudioDevicePropertyTransportType), UInt32(0)) ?? 0),
      "isDefault": d == def,
    ]
  })
case "set":
  guard args.count == 4, let hz = Double(args[3]) else { fail("usage: mac-rate set <uid|default> <hz>") }
  let device = args[2] == "default" ? defaultOutput() : (outputs().first { string($0, kAudioDevicePropertyDeviceUID) == args[2] } ?? 0)
  if device == 0 { fail("no such device") }
  var a = address(kAudioDevicePropertyNominalSampleRate)
  var r = Float64(hz)
  let status = AudioObjectSetPropertyData(device, &a, 0, nil, UInt32(MemoryLayout<Float64>.size), &r)
  if status != noErr { fail("set: \(status)") }
  let deadline = Date().addingTimeInterval(2)
  while rate(device) != hz && Date() < deadline { usleep(50_000) }
  printJSON(["rate": rate(device)])
default:
  fail("usage: mac-rate list | mac-rate set <uid|default> <hz>")
}
```

- [ ] **Step 2: The build script**

`scripts/build-mac-rate.js`:

```js
'use strict';
// Builds src/main/mac-rate/rate.swift into build/bin/mac-rate, one binary for Apple Silicon and Intel. Only on a Mac
// (it needs Xcode's command line tools); elsewhere, and when the binary is newer than its source, it does nothing.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'src', 'main', 'mac-rate', 'rate.swift');
const out = path.join(root, 'build', 'bin', 'mac-rate');

function buildMacRate() {
  if (process.platform !== 'darwin') return null;
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(source).mtimeMs) return out;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const parts = [['arm64-apple-macos11', `${out}-arm64`], ['x86_64-apple-macos10.15', `${out}-x64`]];
  for (const [target, file] of parts) execFileSync('xcrun', ['swiftc', '-O', '-target', target, '-o', file, source], { stdio: 'inherit' });
  execFileSync('lipo', ['-create', '-output', out, ...parts.map(([, file]) => file)], { stdio: 'inherit' });
  for (const [, file] of parts) fs.rmSync(file, { force: true });
  return out;
}

module.exports = { buildMacRate };
if (require.main === module) buildMacRate();
```

`build/before-pack.js`:

```js
'use strict';
// electron-builder's beforePack: the macOS output-rate helper is built before the app is packed around it.
const { buildMacRate } = require('../scripts/build-mac-rate');

exports.default = async function beforePack(context) {
  if (context.electronPlatformName === 'darwin') buildMacRate();
};
```

- [ ] **Step 3: Packaging**

In `package.json`:
- `scripts`: add `"prestart": "node scripts/build-mac-rate.js",` before `"start"`.
- `build`: add `"beforePack": "build/before-pack.js",` next to `"afterPack"`.
- `build.mac`: add
  ```json
  "extraResources": [{ "from": "build/bin/mac-rate", "to": "mac-rate" }],
  "x64ArchFiles": "Contents/Resources/mac-rate"
  ```
  (`x64ArchFiles`: the universal merge refuses a Mach-O file that is identical in the x64 and arm64 halves unless it's listed — this one is already universal.)

`.gitignore`: add a line `build/bin/`.

- [ ] **Step 4: Build and check it by hand on this Mac**

Run: `node scripts/build-mac-rate.js && lipo -archs build/bin/mac-rate && build/bin/mac-rate list`
Expected: `x86_64 arm64`, then a JSON array with the Mac's outputs, one with `"isDefault":true`, each `rates` a list like `[44100,48000,88200,96000]`.

Then, with the wired headphones plugged in, note the default device's `rate` (say 48000) and run:
`build/bin/mac-rate set default 96000 && build/bin/mac-rate set default 48000`
Expected: `{"rate":96000}` then `{"rate":48000}`; Audio MIDI Setup shows the change while it's open. (Put it back to the rate noted, if that wasn't 48000.)

- [ ] **Step 5: Commit**

```bash
git add src/main/mac-rate/rate.swift scripts/build-mac-rate.js build/before-pack.js package.json .gitignore
git commit -m "mac-rate: a small CoreAudio helper that lists outputs with their rates and switches one, built for both Mac architectures and packed into the app"
```

---

### Task 4: The Windows helper (`win-rate/helper.ps1`)

**Files:**
- Create: `src/main/win-rate/helper.ps1`
- Modify: `package.json` (`build.asarUnpack` gets `"src/main/win-rate/**"`)
- Test: `test/output-rate.test.js` (parsing, Task 2); the packaged helper runs in CI's Windows smoke test (Task 5). Real switching is checked by the user on a Windows PC.

**Interfaces:**
- Consumes: the JSON shapes `parseWinList` and `set()` read (Task 2).
- Produces: `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File helper.ps1 list` → `[{ name, id, rate, rates, enumerator, isDefault }]`; `… set <id|default> <hz>` → `{ rate }`.

- [ ] **Step 1: Write the helper**

`src/main/win-rate/helper.ps1`:

```powershell
# CDPlayer's output-rate helper for Windows (see src/main/output-rate.js). Windows plays everything at an output's
# "default format" (Sound settings → the device → Advanced); this lists the outputs with their rates and changes that
# format's sample rate — through IPolicyConfig, the interface the Sound control panel itself uses. No admin rights.
#   helper.ps1 list                    → [{ name, id, rate, rates, enumerator, isDefault }]
#   helper.ps1 set <id|default> <hz>   → { rate }
param([string]$Command, [string]$Id, [int]$Rate)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)] public struct PropertyKey { public Guid fmtid; public int pid; public PropertyKey(string g, int p) { fmtid = new Guid(g); pid = p; } }
[StructLayout(LayoutKind.Explicit)] public struct PropVariant {
  [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr pointer; [FieldOffset(8)] public uint blobSize; [FieldOffset(16)] public IntPtr blobData;
}
[ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore { int GetCount(out int c); int GetAt(int i, out PropertyKey k); int GetValue(ref PropertyKey k, out PropVariant v); }
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
  int OpenPropertyStore(int access, out IPropertyStore store);
  int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
}
[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection { int GetCount(out int c); int Item(int i, out IMMDevice d); }
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int flow, int state, out IMMDeviceCollection c);
  int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d);
  int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice d);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
[ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioClient {
  int Initialize(); int GetBufferSize(); int GetStreamLatency(); int GetCurrentPadding();
  [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
}
[ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPolicyConfig {
  [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr format);
  [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, int useDefault, out IntPtr format);
  [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
  [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr endpointFormat, IntPtr mixFormat);
}
[ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")] class PolicyConfigClient {}

public static class RateIo {
  static readonly int[] Rates = { 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000 };
  static PropertyKey FriendlyName = new PropertyKey("a45c254e-df1c-4efd-8020-67d146a850e0", 14);
  static PropertyKey EnumeratorName = new PropertyKey("a45c254e-df1c-4efd-8020-67d146a850e0", 24);
  static PropertyKey DeviceFormat = new PropertyKey("f19f064d-082c-4e27-bc73-6882a1bb8e4c", 0);

  static IMMDeviceEnumerator Enumerator() { return (IMMDeviceEnumerator)new MMDeviceEnumerator(); }
  static string Text(IPropertyStore s, PropertyKey k) { PropVariant v; return s.GetValue(ref k, out v) == 0 && v.vt == 31 ? Marshal.PtrToStringUni(v.pointer) : ""; }
  // The device format: a WAVEFORMATEX(TENSIBLE), as bytes. Rate at offset 4, bytes a second at 8, block align at 12.
  static byte[] Format(IPropertyStore s) {
    PropertyKey k = DeviceFormat; PropVariant v;
    if (s.GetValue(ref k, out v) != 0 || v.vt != 65 || v.blobSize < 18) return null;
    var b = new byte[v.blobSize]; Marshal.Copy(v.blobData, b, 0, b.Length); return b;
  }
  static byte[] WithRate(byte[] f, int rate) {
    var b = (byte[])f.Clone(); int align = BitConverter.ToUInt16(b, 12);
    BitConverter.GetBytes(rate).CopyTo(b, 4); BitConverter.GetBytes(rate * align).CopyTo(b, 8); return b;
  }
  static IntPtr Alloc(byte[] b) { var p = Marshal.AllocCoTaskMem(b.Length); Marshal.Copy(b, 0, p, b.Length); return p; }
  static byte[] Read(IntPtr p) { int size = 18 + BitConverter.ToUInt16(Bytes(p, 18), 16); var b = Bytes(p, size); return b; }
  static byte[] Bytes(IntPtr p, int n) { var b = new byte[n]; Marshal.Copy(p, b, 0, n); return b; }

  static List<int> Supported(IMMDevice d, byte[] f) {
    var list = new List<int>();
    Guid iid = typeof(IAudioClient).GUID; object o;
    if (f == null || d.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) return list;
    var client = (IAudioClient)o;
    foreach (int r in Rates) {
      IntPtr p = Alloc(WithRate(f, r)), closest;
      try { if (client.IsFormatSupported(1, p, out closest) == 0) list.Add(r); } finally { Marshal.FreeCoTaskMem(p); }
    }
    return list;
  }

  public static List<Dictionary<string, object>> List() {
    var e = Enumerator(); IMMDeviceCollection c; IMMDevice def; string defId = "";
    if (e.GetDefaultAudioEndpoint(0, 1, out def) == 0) def.GetId(out defId);
    e.EnumAudioEndpoints(0, 1, out c); int n; c.GetCount(out n);
    var outList = new List<Dictionary<string, object>>();
    for (int i = 0; i < n; i++) {
      IMMDevice d; c.Item(i, out d); string id; d.GetId(out id); IPropertyStore s; d.OpenPropertyStore(0, out s);
      var f = Format(s);
      outList.Add(new Dictionary<string, object> {
        { "name", Text(s, FriendlyName) }, { "id", id }, { "rate", f == null ? 0 : BitConverter.ToInt32(f, 4) },
        { "rates", Supported(d, f).ToArray() }, { "enumerator", Text(s, EnumeratorName) }, { "isDefault", id == defId },
      });
    }
    return outList;
  }

  public static int Set(string id, int rate) {
    var e = Enumerator(); IMMDevice d;
    if (id == "default") { e.GetDefaultAudioEndpoint(0, 1, out d); d.GetId(out id); } else e.GetDevice(id, out d);
    IPropertyStore s; d.OpenPropertyStore(0, out s);
    var f = Format(s); if (f == null) throw new Exception("no device format");
    var policy = (IPolicyConfig)new PolicyConfigClient();
    IntPtr mixPtr; byte[] mix = policy.GetMixFormat(id, out mixPtr) == 0 ? Read(mixPtr) : f;
    IntPtr pf = Alloc(WithRate(f, rate)), pm = Alloc(WithRate(mix, rate));
    try { int hr = policy.SetDeviceFormat(id, pf, pm); if (hr != 0) throw new Exception("SetDeviceFormat: 0x" + hr.ToString("X8")); }
    finally { Marshal.FreeCoTaskMem(pf); Marshal.FreeCoTaskMem(pm); }
    e.GetDevice(id, out d); d.OpenPropertyStore(0, out s); f = Format(s);
    return f == null ? 0 : BitConverter.ToInt32(f, 4);
  }
}
'@

switch ($Command) {
  'list' { ConvertTo-Json -Compress -Depth 4 -InputObject @([RateIo]::List()) }
  'set' { ConvertTo-Json -Compress -InputObject @{ rate = [RateIo]::Set($Id, $Rate) } }
  default { [Console]::Error.WriteLine('usage: helper.ps1 list | set <id|default> <hz>'); exit 1 }
}
```

(Flow `0` = eRender, state `1` = DEVICE_STATE_ACTIVE, role `1` = eMultimedia, `23` = CLSCTX_ALL, share mode `1` = exclusive, `vt` 31 = LPWSTR, 65 = BLOB. `PropVariant`'s blob fields assume 64-bit, which is the only Windows build CDPlayer ships.)

- [ ] **Step 2: Unpack it from the asar**

`package.json` → `build.asarUnpack`: add `"src/main/win-rate/**"` after `"src/main/win-cd/**"`.

- [ ] **Step 3: Run the unit tests (nothing should change)**

Run: `node --test test/output-rate.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/win-rate/helper.ps1 package.json
git commit -m "win-rate: the Windows helper that lists outputs with the rates they take and sets an output's default format to a song's rate"
```

---

### Task 5: Main process — the helpers run, IPC, restore on quit and at startup, the song's format, the QUALITY setting, the smoke test

**Files:**
- Modify: `src/main/main.js` (create `outputRate`; IPC; `before-quit`; startup restore; smoke test)
- Modify: `src/preload.js` (`outputRate` API)
- Modify: `src/main/metadata.js:126` and `:184` (`format` in details)
- Modify: `src/main/store.js:60-108` (settings line 19 `quality`)
- Modify: `test/state.test.js` (DEFAULT_SETTINGS expectation at line 23; new test)
- Test: `test/metadata-format.test.js` (new)

**Interfaces:**
- Consumes: `createOutputRate` (Task 2); `build/bin/mac-rate` / `Contents/Resources/mac-rate` (Task 3); `src/main/win-rate/helper.ps1` (Task 4).
- Produces:
  - IPC `outputRate:list`, `outputRate:current` (device), `outputRate:set` (device, hz), `outputRate:restore`
  - `window.cdp.outputRate = { list(), current(device), set(device, hz), restore() }`
  - track details gain `format: { sampleRate: number|null, bitsPerSample: number|null, lossless: boolean } | null`
  - `settings.quality: 'HIGH' | 'LOSSLESS' | 'HIRES'`

- [ ] **Step 1: Write the failing tests**

`test/metadata-format.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const metadata = require('../src/main/metadata');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const fixture = (name) => path.join(__dirname, 'fixtures', name);

test('a song\'s sample rate, bit depth and whether it\'s lossless come with its details', async () => {
  const flac = await metadata.getDetails(fixture('smoke.flac'), { withCover: false });
  assert.strictEqual(flac.format.lossless, true);
  assert.ok(flac.format.sampleRate > 0);
  assert.ok(flac.format.bitsPerSample > 0);
  const alac = await metadata.getDetails(fixture('alac24.m4a'), { withCover: false });
  assert.deepStrictEqual([alac.format.lossless, alac.format.bitsPerSample], [true, 24]);
  const mp3 = await metadata.getDetails(fixture('smoke.mp3'), { withCover: false });
  assert.strictEqual(mp3.format.lossless, false);
});
```

In `test/state.test.js`, line 23's expected defaults: add `quality: 'HIGH'` after `language: 'AUTO'`. Then add, after the language test (line ~214):

```js
test('the sound quality: HIGH unless set, kept, odd values back to HIGH', () => {
  store.writeSettings({ ...store.DEFAULT_SETTINGS });
  assert.strictEqual(store.readSettings().quality, 'HIGH');
  store.writeSettings({ ...store.readSettings(), quality: 'HIRES' });
  assert.strictEqual(store.readSettings().quality, 'HIRES');
  store.writeSettings({ ...store.readSettings(), quality: 'ULTRA' });
  assert.strictEqual(store.readSettings().quality, 'HIGH');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/metadata-format.test.js test/state.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'lossless')`, and the defaults / quality assertions.

- [ ] **Step 3: Implement**

`src/main/store.js`:
- Comment above `DEFAULT_SETTINGS`: append `…and the language (AUTO, en or a locale code), then the sound quality (HIGH, LOSSLESS or HIRES) (CDPlayer 2 only).`
- `DEFAULT_SETTINGS`: add `quality: 'HIGH'` after `language: 'AUTO'`.
- Next to `SHELF_SORTS`: `const QUALITIES = ['HIGH', 'LOSSLESS', 'HIRES'];`
- `readSettings`, before `return s;`: `s.quality = l.length >= 19 && QUALITIES.includes(l[18].trim()) ? l[18].trim() : 'HIGH';`
- `writeSettings`: after the language entry, add `QUALITIES.includes(s.quality) ? s.quality : 'HIGH'` to the array.

`src/main/metadata.js`:
- At the CD track's details (line 126), add `format: { sampleRate: 44100, bitsPerSample: 16, lossless: true },`.
- At the file's details (line 184, after `quality:`), add:
  ```js
      format: format ? {
        sampleRate: format.sampleRate || null,
        bitsPerSample: format.bitsPerSample || null,
        lossless: !!format.lossless || /^(FLAC|ALAC|WAV|AIFF|AIF)$/i.test(path.extname(filePath).slice(1)) || /alac|flac/i.test(String(format.codec || '')),
      } : null,
  ```
  (A cue track's details come from its album file's details, so they carry the same `format`; check `src/main/metadata.js:106` — the "track not in the sheet" placeholder needs `format: null`.)

`src/main/main.js`:
- With the other requires: `const { createOutputRate } = require('./output-rate');`
- After `const handle = …` (line 173):
  ```js
  // Settings → QUALITY: the output device's rate, switched by a helper per system (src/main/output-rate.js).
  function outputRateHelper() {
    if (process.platform === 'darwin') {
      const bin = app.isPackaged ? path.join(process.resourcesPath, 'mac-rate') : path.join(__dirname, '..', '..', 'build', 'bin', 'mac-rate');
      return (args) => runJson(bin, args);
    }
    const script = path.join(__dirname, 'win-rate', 'helper.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    return (args) => runJson('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args]);
  }
  function runJson(cmd, args) {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err, stdout) => {
        if (err) { reject(err); return; }
        try { resolve(JSON.parse(String(stdout).trim())); } catch (e) { reject(e); }
      });
    });
  }
  const outputRate = createOutputRate({ platform: process.platform, run: outputRateHelper(), file: path.join(store.dataDir(), 'output-rate.json') });
  if (!smokeDir) outputRate.restore(); // left over from a run that didn't get to quit
  handle('outputRate:list', () => outputRate.list());
  handle('outputRate:current', (device) => outputRate.current(device));
  handle('outputRate:set', (device, hz) => outputRate.set(device, hz));
  handle('outputRate:restore', () => outputRate.restore());
  ```
  (`store.dataDir` — check it's in `module.exports` at `src/main/store.js:274`; add it there if not.)
- `app.on('before-quit', …)`: quitting has to wait for the restore. Replace the handler with:
  ```js
  let restoredRate = false;
  app.on('before-quit', (e) => {
    quitting = true;
    if (playsTimer) { clearTimeout(playsTimer); writePlays(); }
    if (restoredRate || smokeDir) return;
    e.preventDefault();
    restoredRate = true;
    Promise.race([outputRate.restore(), new Promise((r) => setTimeout(r, 3000))]).finally(() => app.quit());
  });
  ```
- `runSmokeTest`, before `const allOk`: 
  ```js
  // The output-rate helper must start and answer in the packaged app (a CI machine may have no outputs: [] is fine).
  const rateList = process.platform === 'linux' ? [] : await outputRate.list();
  const rateOk = Array.isArray(rateList);
  ```
  and make `allOk` `results.length > 0 && results.every((r) => r.ok) && rateOk`, and add `outputRate: rateList` to the JSON written out.

`src/preload.js`, after `markOnboarded`:

```js
  outputRate: {
    list: invoke('outputRate:list'),
    current: invoke('outputRate:current'),
    set: invoke('outputRate:set'),
    restore: invoke('outputRate:restore'),
  },
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS, all files (including `test/csp.test.js` and the i18n tests — no new `t()` texts yet in this task).

- [ ] **Step 5: Commit**

```bash
git add src/main/main.js src/preload.js src/main/metadata.js src/main/store.js test/state.test.js test/metadata-format.test.js
git commit -m "The output-rate helpers run from the main process, put the rate back on quit and after a crash; a song's details carry its sample rate; the QUALITY setting is kept"
```

---

### Task 6: The engine plays at a given rate (`audio.js`, `disc-noise.js`)

**Files:**
- Modify: `src/renderer/js/audio.js:14-50` (constructor → `build`; setters remember their values; `rate`, `customRate`, `setRate`, `onContextChange`), `:248-255` (recording destination is per context)
- Modify: `src/renderer/js/disc-noise.js:19-40` (constructor → `attach(ctx)`, re-attached on a new context)
- Test: `test/audio-rate.test.mjs` (new)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `engine.rate → number` (the context's sample rate)
  - `engine.customRate → number|null` (null: the system's rate)
  - `engine.setRate(rate: number|null) → Promise<boolean>` — rebuilds at `rate` (null: the system's); stops and disposes any deck first; false if the context can't be made at that rate (the engine is left as it was, minus its decks)
  - `engine.onContextChange(fn: (ctx) => void)`

- [ ] **Step 1: Write the failing test**

`test/audio-rate.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert';

// Just enough Web Audio: contexts remember their rate, whether they were closed, and their output device.
const param = () => ({ value: 1, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {}, setValueCurveAtTime() {} });
const node = () => ({ connect() {}, disconnect() {}, gain: param() });
const made = [];
globalThis.AudioContext = class {
  constructor(opts = {}) {
    if (opts.sampleRate === 999) throw new Error('NotSupportedError');
    this.sampleRate = opts.sampleRate || 48000; this.currentTime = 0; this.state = 'running'; this.destination = node(); this.closed = false; this.sinkId = '';
    made.push(this);
  }
  createGain() { return node(); }
  createBiquadFilter() { return { ...node(), type: '', frequency: param(), Q: param() }; }
  createAnalyser() { return { ...node(), fftSize: 0, frequencyBinCount: 1024, smoothingTimeConstant: 0 }; }
  createMediaElementSource() { return node(); }
  setSinkId(id) { this.sinkId = id; return Promise.resolve(); }
  close() { this.closed = true; return Promise.resolve(); }
  resume() { return Promise.resolve(); }
};
globalThis.Audio = class {
  constructor() { this.paused = true; this.h = {}; this.duration = 100; this.currentTime = 0; setTimeout(() => (this.h.loadedmetadata || []).forEach((f) => f()), 0); }
  addEventListener(t, f) { (this.h[t] = this.h[t] || []).push(f); }
  removeEventListener() {}
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute() {}
  load() {}
};
const { AudioEngine } = await import('../src/renderer/js/audio.js');

test('the engine starts at the system rate and can be rebuilt at a song\'s', async () => {
  const engine = new AudioEngine();
  assert.strictEqual(engine.rate, 48000);
  assert.strictEqual(engine.customRate, null);
  const first = engine.ctx;
  assert.strictEqual(await engine.setRate(96000), true);
  assert.strictEqual(engine.rate, 96000);
  assert.strictEqual(engine.customRate, 96000);
  assert.ok(first.closed, 'the old context is let go');
  assert.strictEqual(await engine.setRate(96000), true);
  assert.strictEqual(engine.ctx, made[made.length - 1], 'the same rate: nothing rebuilt');
  assert.strictEqual(await engine.setRate(null), true);
  assert.strictEqual(engine.rate, 48000);
  assert.strictEqual(engine.customRate, null);
});

test('volume, mono, EQ and the output device carry over to the new context', async () => {
  const engine = new AudioEngine();
  engine.setVolume(0.4);
  engine.setMono(true);
  engine.setEq([3, 0, 0, 0, 0, 0, 0, 0, 0, -2]);
  await engine.setOutput('headphones');
  await engine.setRate(44100);
  assert.strictEqual(engine.master.gain.value, 0.4);
  assert.strictEqual(engine.input.channelCount, 1);
  assert.strictEqual(engine.eq[0].gain.value, 3);
  assert.strictEqual(engine.eq[9].gain.value, -2);
  assert.strictEqual(engine.ctx.sinkId, 'headphones');
});

test('a rate change drops what was playing, crossfade included, and tells who listens', async () => {
  const engine = new AudioEngine();
  await engine.load('a.flac', { autoPlay: true });
  await engine.load('b.flac', { autoPlay: true, crossfadeSeconds: 5 });
  assert.ok(engine.crossfading);
  const seen = [];
  engine.onContextChange((ctx) => seen.push(ctx.sampleRate));
  await engine.setRate(96000);
  assert.strictEqual(engine.deck, null);
  assert.ok(!engine.crossfading);
  assert.deepStrictEqual(seen, [96000]);
});

test('a rate the browser refuses: false, the engine keeps its rate', async () => {
  const engine = new AudioEngine();
  assert.strictEqual(await engine.setRate(999), false);
  assert.strictEqual(engine.rate, 48000);
  assert.strictEqual(engine.ctx.closed, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/audio-rate.test.mjs`
Expected: FAIL — `engine.rate` is `undefined` / `engine.setRate is not a function`.

- [ ] **Step 3: Implement**

`src/renderer/js/audio.js` — replace the constructor and the three setters (lines 14-48) with:

```js
export class AudioEngine {
  constructor() {
    this.volume = 1; this.mono = false; this.eqGains = new Array(EQ_FREQUENCIES.length).fill(0);
    this.outputId = '';
    this.customRate = null;    // Settings → QUALITY: the song's rate, or null for the system's
    this.contextListeners = [];
    this.build(null);
    this.deck = null;          // the current track
    this.fadingOut = null;     // the previous track, while a crossfade is in progress
    this.fadeTimer = null;
    this.onEnded = null;
  }

  /** The graph, in a new context at `rate` (null: the system's), with the volume, mono and EQ it had. */
  build(rate) {
    const ctx = new AudioContext(rate ? { sampleRate: rate, latencyHint: 'playback' } : { latencyHint: 'playback' });
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.eq = EQ_FREQUENCIES.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = 'peaking'; b.frequency.value = f; b.Q.value = 1.2; b.gain.value = this.eqGains[i]; // same RBJ peaking curve, Q 1.2, as the Java EQ
      return b;
    });
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 8192;
    this.analyser.smoothingTimeConstant = 0;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    let node = this.input;
    for (const b of this.eq) { node.connect(b); node = b; }
    node.connect(this.analyser);
    this.analyser.connect(this.master);
    this.master.connect(ctx.destination);
    this.samples = new Float32Array(this.analyser.fftSize);
    this.freq = null;
    this.recDest = null;
    this.applyMono();
  }

  get rate() { return this.ctx.sampleRate; }
  onContextChange(fn) { this.contextListeners.push(fn); }
  /**
   * Plays at `rate` from now on (null: the system's rate), by building the graph again in a new context — Web Audio
   * can't change a context's rate. Whatever was playing (and fading) is dropped: the caller loads the next song.
   * → false if the browser won't make a context at that rate; the engine then stays at the rate it had.
   */
  async setRate(rate) {
    if ((rate || null) === this.customRate && (!rate || rate === this.ctx.sampleRate)) return true;
    this.stop();
    const old = this.ctx, oldNodes = { input: this.input, eq: this.eq, analyser: this.analyser, master: this.master, samples: this.samples };
    try { this.build(rate); } catch {
      Object.assign(this, { ctx: old }, oldNodes);
      return false;
    }
    this.customRate = rate || null;
    if (this.outputId && this.ctx.setSinkId) await this.ctx.setSinkId(this.outputId).catch(() => {});
    for (const fn of this.contextListeners) fn(this.ctx);
    old.close().catch(() => {});
    return true;
  }

  setVolume(v) { this.volume = v; this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01); }
  setMono(on) { this.mono = on; this.applyMono(); }
  applyMono() {
    // A 1-channel "explicit" node makes Web Audio sum L+R (×0.5 each) — exactly the Java version's (L+R)/2 —
    // and the speakers then get that mono signal on both sides.
    this.input.channelCount = this.mono ? 1 : 2;
    this.input.channelCountMode = this.mono ? 'explicit' : 'max';
    this.input.channelInterpretation = 'speakers';
  }
  setEq(gains) { this.eqGains = gains.slice(); gains.forEach((g, i) => this.eq[i].gain.setTargetAtTime(g, this.ctx.currentTime, 0.02)); }
```

(The fake `setTargetAtTime` in the test sets `.value`, so `master.gain.value` reads back 0.4. Keep `setOutput` as it is: it already stores `this.outputId`.)

`build()` sets `this.recDest = null`, so a recording only ever belongs to the context it was made in; `recordingStream()` and `stopRecording()` need no change.

`src/renderer/js/disc-noise.js` — replace the constructor (lines 19-40) with:

```js
export class DiscNoise {
  constructor(engine) {
    this.engine = engine;
    this.enabled = false;
    this.attach(engine.ctx);
    // Settings → QUALITY rebuilds the engine at a song's rate: the noise moves into the new context with it.
    engine.onContextChange((ctx) => this.attach(ctx));
  }

  attach(ctx) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(this.engine.master);
    this.white = noiseBuffer(ctx, 2);
    this.brown = noiseBuffer(ctx, 2, true);
    // The hiss: looped white noise, band-limited to the airy top end, faded in only while playing.
    this.hiss = ctx.createGain();
    this.hiss.gain.value = 0;
    const src = ctx.createBufferSource();
    src.buffer = this.white; src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 11000;
    src.connect(hp); hp.connect(lp); lp.connect(this.hiss); this.hiss.connect(this.out);
    src.start();
  }
```

(The hiss comes back with the next `setPlaying(true)`, which `app.js` calls when the new song starts.)

- [ ] **Step 4: Run tests**

Run: `node --test test/audio-rate.test.mjs test/audio-element-deck.test.mjs test/disc-noise.test.mjs`
Expected: PASS. (`audio-element-deck`'s fake `AudioContext` takes no options and has no `close`; it never calls `setRate`, so it still passes.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/js/audio.js src/renderer/js/disc-noise.js test/audio-rate.test.mjs
git commit -m "The engine can play at a song's own sample rate: the graph built again in a new context, keeping the volume, mono, EQ and output; disc noise moves with it"
```

---

### Task 7: The player — the rate before each song, the badge, Settings → QUALITY, Russian, README

**Files:**
- Modify: `src/renderer/js/app.js` (state, `applyQuality`, `load()` at lines 362-381, `updateQualityBadge`, `setQuality`, settings snapshot at 1395, settings load at ~1730, app API at ~1663, `setEq`/`setMono` refresh the badge)
- Modify: `src/renderer/index.html:46` (badge element)
- Modify: `src/renderer/styles.css:118` (badge style)
- Modify: `src/renderer/js/panels.js:200-260` (QUALITY row)
- Modify: `src/locales/ru.json` (new texts)
- Modify: `README.md` (one line under Features)
- Test: `test/quality.test.mjs` (Task 1), `test/i18n-locales.test.mjs`, `test/csp.test.js`; by hand.

**Interfaces:**
- Consumes: `targetRate`, `badgeLabel`, `badgeText`, `badgeExact`, `levelName`, `LEVELS` (Task 1); `cdp.outputRate.set/restore` (Task 5); `details.format`, `settings.quality` (Task 5); `engine.rate`, `engine.customRate`, `engine.setRate` (Task 6).
- Produces: `app.setQuality(level)`, `app.state.quality`.

- [ ] **Step 1: State and the rate step in `load()`**

In `app.js`:
- import: `import { targetRate, badgeLabel, badgeText, badgeExact, levelName, LEVELS } from './quality.js';`
- `state`: add `quality: 'HIGH', rateInfo: null,` next to `language`.
- Above `async function load(`:

```js
// Settings → QUALITY: before a song loads, the engine (and, through the main process, the output device) is set to
// the rate it should play at. → true when the engine was rebuilt, so the song can't crossfade in.
async function applyQuality(format, token) {
  if (state.quality === 'HIGH') {
    state.rateInfo = null;
    return engine.customRate ? engine.setRate(null) : false;
  }
  const fileRate = format && format.sampleRate;
  const aimed = targetRate(state.quality, fileRate);
  if (!aimed) return false;
  const known = state.rateInfo;
  if (known && known.aimed === aimed && engine.rate === (known.switched ? known.deviceRate : aimed)) {
    state.rateInfo = { ...known, fileRate };
    return false;
  }
  const result = await cdp.outputRate.set(state.output, aimed).catch(() => null);
  if (token !== state.loadToken) return false;
  state.rateInfo = {
    fileRate, aimed, deviceRate: result ? result.rate : engine.rate,
    switched: !!(result && result.switched), bluetooth: !!(result && result.bluetooth),
  };
  const playAt = result && result.switched ? result.rate : aimed;
  if (playAt === engine.rate) return false;
  return engine.setRate(playAt);
}
```

- In `load()`: change `const fade = …` to `let fade = …`. Then, right after the `if (cueRef(path) && !cue) { … }` block and before `const url = …`, insert:

```js
  if (state.quality !== 'HIGH' || engine.customRate) {
    const rateChanged = await applyQuality(((await detailsPromise) || {}).format, token);
    if (token !== state.loadToken) return;
    if (rateChanged) fade = 0; // a new context: nothing left to fade out of
  }
```

(Under HIGH with the engine already at the system rate, nothing waits for the details — loading is as quick as before.)

- [ ] **Step 2: The badge**

`src/renderer/index.html` line 46 — replace the `track-source` line with:

```html
        <div id="source-row"><span id="quality-badge" hidden></span><div id="track-source" data-i18n>YOUR MUSIC LIBRARY</div></div>
```

`src/renderer/styles.css` — change line 118's `#track-source { margin-top: 6px; …` to drop `margin-top: 6px;` and add above it:

```css
#source-row { margin-top: 6px; display: flex; align-items: center; gap: 8px; min-width: 0; }
#quality-badge { flex: none; height: 16px; line-height: 16px; padding: 0 6px; border-radius: 4px; font-size: 10px; letter-spacing: 0.06em; color: rgb(var(--text)); background: rgb(var(--text) / 0.12); cursor: default; }
#quality-badge.dim { opacity: 0.45; }
#track-source { min-width: 0; }
```

(Check the theme's colour variables at the top of `styles.css`: if `--text` isn't the name used for the main text colour, use the one `#track-title` uses.)

In `app.js`, next to `updateWear`:

```js
/** The ◈ LOSSLESS / ◈ HI-RES LOSSLESS badge under the title, and what reaches the output on hover. */
function updateQualityBadge() {
  const badge = $('quality-badge'), d = state.details;
  const label = d && !isSpotifyUri(state.loadedPath || '') ? badgeLabel(d.format, state.quality) : null;
  badge.hidden = !label;
  if (!label) return;
  const fileRate = d.format.sampleRate;
  const info = state.rateInfo || { fileRate, aimed: targetRate(state.quality, fileRate), deviceRate: engine.rate, switched: false, bluetooth: false };
  const full = { ...info, eq: state.eq.some((g) => g !== 0), mono: state.mono };
  badge.textContent = label;
  badge.title = badgeText(full);
  badge.classList.toggle('dim', !badgeExact(full));
}
```

Call `updateQualityBadge()`:
- in `load()` right after `updateWear();` (where `state.details` is set for a file);
- at the end of `loadSpotify` after its details are set (it hides the badge);
- in `setMono` and `setEq`, after the engine call.

- [ ] **Step 3: The setting**

In `app.js`:

```js
/** Settings → QUALITY. Applies from the next song; back to HIGH puts the outputs' rates back at once. */
async function setQuality(level) {
  state.quality = LEVELS.includes(level) ? level : 'HIGH';
  saveSettingsSoon();
  if (state.quality === 'HIGH') { state.rateInfo = null; await cdp.outputRate.restore().catch(() => {}); }
  updateQualityBadge();
}
```

- `settingsSnapshot()` (line 1395): add `quality: state.quality,`.
- Settings load (line ~1731, after `state.language = …`): `state.quality = s.quality || 'HIGH';`
- The app API object (line ~1663): add `setQuality,`.

In `panels.js`, after `app.currentOutputName().then(…)` (line 206):

```js
  const qualityButton = pill(levelName(s.quality), () => showMenu(qualityButton, LEVELS.map((level) => ({
    label: levelName(level, true), current: level === s.quality,
    pick: () => app.setQuality(level).then(() => refreshSettingsIfOpen(app)),
  }))), t('How the sound leaves CDPlayer'));
```

with `import { levelName, LEVELS } from './quality.js';` at the top. In the SOUND section, after `unavailable(row(t('OUTPUT'), outputButton)),`:

```js
    unavailable(row(t('QUALITY'), qualityButton)),
    hint(t('Lossless plays each song at its own sample rate; CDPlayer switches your output’s rate to match and puts it back when it closes. Over Bluetooth, the wireless codec limits it.')),
```

- [ ] **Step 4: Russian**

Run: `npm run i18n -- ru`
Expected: `ru: N/M` with the new texts added empty. Fill each in `src/locales/ru.json`:

| English | Русский |
| --- | --- |
| `HIGH` | `ВЫСОКОЕ` |
| `LOSSLESS` | `LOSSLESS` |
| `HI-RES LOSSLESS` | `HI-RES LOSSLESS` |
| `LOSSLESS · UP TO 24-BIT / 48 KHZ` | `LOSSLESS · ДО 24 БИТ / 48 КГЦ` |
| `HI-RES LOSSLESS · UP TO 24-BIT / 192 KHZ` | `HI-RES LOSSLESS · ДО 24 БИТ / 192 КГЦ` |
| `QUALITY` | `КАЧЕСТВО` |
| `How the sound leaves CDPlayer` | `В каком качестве звук уходит из CDPlayer` |
| `Lossless plays each song at its own sample rate; CDPlayer switches your output’s rate to match and puts it back when it closes. Over Bluetooth, the wireless codec limits it.` | `Lossless играет каждую песню на её родной частоте: CDPlayer переключает частоту выхода и возвращает её, когда закрывается. По Bluetooth качество ограничивает беспроводной кодек.` |
| `OUTPUT: {rate} — NOT RESAMPLED` | `ВЫХОД: {rate} — БЕЗ ПЕРЕСЧЁТА` |
| `OUTPUT: {rate} — LOWERED FROM {file} (HI-RES LOSSLESS PLAYS IT IN FULL)` | `ВЫХОД: {rate} — ПОНИЖЕНО С {file} (HI-RES LOSSLESS СЫГРАЕТ ЦЕЛИКОМ)` |
| `OUTPUT: {rate} — RESAMPLED (THE DEVICE CAN'T PLAY {file})` | `ВЫХОД: {rate} — ПЕРЕСЧЁТ (УСТРОЙСТВО НЕ УМЕЕТ {file})` |
| `OUTPUT: {rate} — RESAMPLED (SET THE RATE IN YOUR SOUND SETTINGS)` | `ВЫХОД: {rate} — ПЕРЕСЧЁТ (ПОСТАВЬТЕ ЧАСТОТУ В НАСТРОЙКАХ ЗВУКА)` |
| `BLUETOOTH: QUALITY IS LIMITED BY THE WIRELESS CODEC` | `BLUETOOTH: КАЧЕСТВО ОГРАНИЧЕНО БЕСПРОВОДНЫМ КОДЕКОМ` |
| `THE EQUALIZER OR MONO CHANGES THE SOUND` | `ЭКВАЛАЙЗЕР ИЛИ МОНО МЕНЯЮТ ЗВУК` |

(If `HIGH` or `QUALITY` already exist in `ru.json` with another meaning, the i18n test will say so — reuse the existing translation only if it reads right here.)

- [ ] **Step 5: README**

In `README.md` → Features, after the **Playback** line, add:

```markdown
- **Quality** — like Apple Music's: LOSSLESS and HI-RES LOSSLESS play each song at its own sample rate (up to 192 kHz), switching your output's rate to match on macOS and Windows
```

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: PASS, every file (`i18n-locales` confirms Russian is complete; `help.test.mjs` the shortcuts table).

- [ ] **Step 7: Check it by hand on this Mac**

Run the app with a throwaway data folder: `CDPLAYER_HOME=$CLAUDE_JOB_DIR/tmp/cdp-home npm start` (or any temp dir — never the real `~/.cdplayer`). With the wired headphones as the output and Audio MIDI Setup open:
1. Settings → QUALITY → HI-RES LOSSLESS. Play a 44.1 kHz FLAC: the headphones go to 44.1 kHz; the badge reads `◈ LOSSLESS`, hover `OUTPUT: 44.1 KHZ — NOT RESAMPLED`.
2. A 96 kHz/24-bit FLAC next: 96 kHz, `◈ HI-RES LOSSLESS`, `OUTPUT: 96 KHZ — NOT RESAMPLED`. (No 96 kHz file? Make one: `afconvert -f 'flac' -d 'flac@96000' -c 2 test/fixtures/ref24.wav $CLAUDE_JOB_DIR/tmp/hires.flac` — or any 24/96 FLAC.)
3. Crossfade on (5 s): 96 → 44.1 cuts cleanly, no error; within one album crossfade still works.
4. LOSSLESS: the 96 kHz song plays at 48 kHz, hover says `LOWERED FROM 96 KHZ`.
5. Back to HIGH: Audio MIDI Setup goes back to the rate it had at once.
6. HI-RES again, quit CDPlayer: the rate goes back. HI-RES again, `kill -9` CDPlayer, start it: the rate goes back.
7. AirPods as the output: not switched, badge dimmed, hover says Bluetooth.
8. EQ preset Rock: hover gets the EQ line. A Spotify album: no badge.
9. A queue alternating 44.1 and 96 kHz songs: press next five times fast — the last song plays at its own rate, no error in the console.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/js/app.js src/renderer/js/panels.js src/renderer/index.html src/renderer/styles.css src/locales/ru.json README.md
git commit -m "Settings → QUALITY: HIGH, LOSSLESS and HI-RES LOSSLESS; each song at its own rate, the output switched to match, and a LOSSLESS badge under the title saying what reaches the output"
```

---

### Task 8: The packaged app and CI

**Files:**
- Modify: `.github/workflows/build.yml` only if the Mac build step can't find `swiftc` (it's on GitHub's macOS runners by default).
- Test: a packaged build here.

**Interfaces:**
- Consumes: everything above.
- Produces: a `.dmg` whose app carries `Contents/Resources/mac-rate`.

- [ ] **Step 1: Build the Mac app**

Run: `npx electron-builder --mac --publish never`
Expected: `dist/mac-universal/CDPlayer.app` built; no "same in both x64 and arm64 builds" error.

- [ ] **Step 2: The helper is inside, universal, and the smoke test passes**

Run: `lipo -archs dist/mac-universal/CDPlayer.app/Contents/Resources/mac-rate && dist/mac-universal/CDPlayer.app/Contents/MacOS/CDPlayer --smoke-test=test/fixtures`
Expected: `x86_64 arm64`; the smoke JSON ends with `"allOk": true` and an `outputRate` list of this Mac's outputs; exit code 0.

- [ ] **Step 3: Push and watch CI**

```bash
git push
gh run watch --exit-status
```
Expected: all three platforms green; the Windows smoke JSON has an `outputRate` array (empty is fine on a runner without sound devices).

- [ ] **Step 4: Commit any CI fix the run needed** (skip if none)

```bash
git add .github/workflows/build.yml
git commit -m "CI builds the Mac output-rate helper before packing"
```
