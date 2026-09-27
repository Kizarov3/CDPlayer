# Audio CDs on Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Windows, an audio CD shows the AUDIO CD button, is named from MusicBrainz, plays and seeks through the normal player, and ejects — by reading the drive directly.

**Architecture:** A long-running PowerShell helper (C# compiled with `Add-Type`) answers framed requests over stdin/stdout (`drives`, `toc`, `read`, `eject`). `src/main/win-cd.js` runs it and holds the pure pieces (TOC parsing, frame parsing, `cdda://F/3` paths, WAV header, byte→sector mapping). `audio-cd.js` turns drives into the disc objects the rest of the app already uses; `media-protocol.js` streams `cdda://` tracks as WAV with Range support; `metadata.js` gives their details without touching the file system.

**Tech Stack:** Electron 44 main process (CommonJS), Windows PowerShell 5.1 + C#, `node --test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-27-windows-audio-cd-design.md`

## Global Constraints

- Nothing to install, no shipped binaries: the helper is `src/main/win-cd/helper.ps1`, started as `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File helper.ps1`, shipped unpacked (`asarUnpack`).
- Protocol: one JSON request per stdin line; each answer = one JSON header line on stdout + exactly `bytes` raw bytes. Errors: `{"id":…,"ok":false,"error":"…","bytes":0}`.
- Sector = 2352 bytes (44.1 kHz, 16-bit, stereo, little-endian); the helper reads ≤ 20 sectors per `IOCTL_CDROM_RAW_READ`; the media server reads 25 sectors per request.
- A sector that won't read is retried once, then silence — never an error that stops the song.
- Empty CD drives (error 21, UTM's `D:`/`E:`) are skipped quietly.
- Track paths are `cdda://<letter>/<track number>` (e.g. `cdda://F/3`).
- macOS and Linux behaviour unchanged. Tests never touch a real `~/.cdplayer`.
- Commit messages in the repo's plain style, **no AI attribution lines** (user rule).
- The user's disc (the fixture): TOC LBAs 0, 3635, 21075, 44183, 68530, 88590, 104555, 132670, 150915, 168360, 182128, 192878, 202733, lead-out 276725 → disc ID `6u6SZ6TRjV_O9VDaKMAucGeZEOY-`.

## Review Focus

1. The helper prints something that isn't a frame (a PowerShell warning, a blank line) — the parser must skip it and stay in sync. (Task 1 test.)
2. The helper process dies mid-read (disc yanked, PowerShell crash) — pending requests must reject, not hang the player; after two deaths CD support stays off. (Task 2 test.)
3. A seek lands mid-sector or inside the 44-byte WAV header — the served bytes must be exactly the requested range. (Task 4 tests.)
4. The disc is taken out: the next poll must drop it (AUDIO CD button goes, tracks forgotten), and reads of its tracks must 404 rather than serve stale data. (Task 3 test.)
5. An enhanced CD (audio + a data session): the data track is not a playable track and the disc ID still matches MusicBrainz. (Task 1 test.)

---

### Task 1: The pure pieces — TOC, frames, paths, WAV header, sector spans

**Files:**
- Create: `src/main/win-cd.js`
- Create: `test/fixtures/cd-toc.js`
- Test: `test/win-cd.test.js`

**Interfaces:**
- Produces (from `src/main/win-cd.js`):
  - `parseToc(buf: Buffer) → { first, last, leadout, offsets: number[], tracks: number[] } | null` — offsets/leadout absolute (MSF frames, i.e. LBA + 150), audio tracks only.
  - `class FrameParser(onFrame(header, payload: Buffer))` with `.push(chunk: Buffer)`.
  - `trackPath(drive: 'F:', n) → 'cdda://F/3'`; `parseTrackPath(p) → { drive: 'F:', number } | null`.
  - `remember(drive, toc)`, `keepOnly(drives: Set<string>)`, `trackInfo(p) → { drive, number, lba, sectors, duration } | null` (lba = relative LBA for raw reads; duration seconds).
  - `wavHeader(dataBytes) → Buffer(44)`; `sectorSpan(start, end) → { first, count, skip } | null`.
  - constants `SECTOR = 2352`, `HEADER = 44`.
- Produces (from `test/fixtures/cd-toc.js`): `tocBytes(tracks: [{ number, lba, data? }], leadoutLba) → Buffer(804)`, `THREE_DOLLAR_BILL = { lbas: [...], leadout: 276725, id: '6u6SZ6TRjV_O9VDaKMAucGeZEOY-' }`.

- [ ] **Step 1: Write the fixture** — `test/fixtures/cd-toc.js`:

```js
'use strict';
// A CDROM_TOC as Windows' IOCTL_CDROM_READ_TOC returns it: length (2 bytes, big-endian), first and last track, then
// 8 bytes per track (reserved, control/adr, number, reserved, address as 0 M S F) and the lead-out (number 0xAA).
function tocBytes(tracks, leadoutLba) {
  const b = Buffer.alloc(804);
  const all = [...tracks, { number: 0xAA, lba: leadoutLba }];
  b.writeUInt16BE(2 + all.length * 8, 0);
  b[2] = tracks[0].number; b[3] = tracks[tracks.length - 1].number;
  all.forEach((t, i) => {
    const o = 4 + i * 8, f = t.lba + 150;
    b[o + 1] = 0x10 | (t.data ? 4 : 0); // adr 1, control bit 2 = data track
    b[o + 2] = t.number;
    b[o + 5] = Math.floor(f / 4500); b[o + 6] = Math.floor(f / 75) % 60; b[o + 7] = f % 75;
  });
  return b;
}
// The user's CD, read on Windows 11 in UTM: Limp Bizkit – Three Dollar Bill, Yall$.
const THREE_DOLLAR_BILL = {
  lbas: [0, 3635, 21075, 44183, 68530, 88590, 104555, 132670, 150915, 168360, 182128, 192878, 202733],
  leadout: 276725, id: '6u6SZ6TRjV_O9VDaKMAucGeZEOY-',
};
module.exports = { tocBytes, THREE_DOLLAR_BILL };
```

- [ ] **Step 2: Write the failing tests** — `test/win-cd.test.js`:

```js
'use strict';
// Windows audio CDs: the pieces that don't need a drive (TOC, the helper's frames, cdda:// paths, WAV and sectors).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const winCd = require('../src/main/win-cd');
const { discId } = require('../src/main/audio-cd');
const { tocBytes, THREE_DOLLAR_BILL } = require('./fixtures/cd-toc');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const userDisc = () => tocBytes(THREE_DOLLAR_BILL.lbas.map((lba, i) => ({ number: i + 1, lba })), THREE_DOLLAR_BILL.leadout);

test('the user\'s CD: its TOC gives the disc ID MusicBrainz knows', () => {
  const toc = winCd.parseToc(userDisc());
  assert.strictEqual(toc.first, 1);
  assert.strictEqual(toc.last, 13);
  assert.deepStrictEqual(toc.offsets.slice(0, 3), [150, 3785, 21225]);
  assert.strictEqual(toc.leadout, 276875);
  assert.strictEqual(discId(toc), THREE_DOLLAR_BILL.id);
});

test('an enhanced CD: the data track is left out, and the audio ends 11400 sectors before it', () => {
  const toc = winCd.parseToc(tocBytes([{ number: 1, lba: 0 }, { number: 2, lba: 20000 }, { number: 3, lba: 50000, data: true }], 90000));
  assert.deepStrictEqual(toc.tracks, [1, 2]);
  assert.strictEqual(toc.leadout, 50150 - 11400);
  assert.strictEqual(winCd.parseToc(tocBytes([{ number: 1, lba: 0, data: true }], 1000)), null);
});

test('frames: a header line then its bytes, however the pipe splits them; stray lines skipped', () => {
  const got = [];
  const p = new winCd.FrameParser((h, payload) => got.push([h.id, payload.toString()]));
  const wire = Buffer.from('WARNING: something\n{"id":1,"ok":true,"bytes":3}\nabc{"id":2,"ok":true,"bytes":0}\n\n{"id":3,"ok":true,"bytes":2}\nxy');
  for (let i = 0; i < wire.length; i += 3) p.push(wire.subarray(i, i + 3));
  assert.deepStrictEqual(got, [[1, 'abc'], [2, ''], [3, 'xy']]);
  const all = [];
  new winCd.FrameParser((h) => all.push(h.id)).push(wire);
  assert.deepStrictEqual(all, [1, 2, 3]);
});

test('cdda paths, and a track\'s place on the disc', () => {
  assert.strictEqual(winCd.trackPath('F:', 3), 'cdda://F/3');
  assert.deepStrictEqual(winCd.parseTrackPath('cdda://f/12'), { drive: 'F:', number: 12 });
  assert.strictEqual(winCd.parseTrackPath('/Volumes/Audio CD/1 Audio Track.aiff'), null);
  winCd.remember('F:', winCd.parseToc(userDisc()));
  assert.deepStrictEqual(winCd.trackInfo('cdda://F/2'), { drive: 'F:', number: 2, lba: 3635, sectors: 17440, duration: 17440 / 75 });
  assert.strictEqual(winCd.trackInfo('cdda://F/13').sectors, 276725 - 202733);
  assert.strictEqual(winCd.trackInfo('cdda://F/14'), null);
  winCd.keepOnly(new Set());
  assert.strictEqual(winCd.trackInfo('cdda://F/2'), null, 'a disc taken out is forgotten');
});

test('the WAV header, and which sectors cover a byte range', () => {
  const h = winCd.wavHeader(2352 * 10);
  assert.strictEqual(h.length, 44);
  assert.strictEqual(h.toString('ascii', 0, 4), 'RIFF');
  assert.strictEqual(h.readUInt32LE(4), 36 + 23520);
  assert.strictEqual(h.readUInt32LE(24), 44100);
  assert.strictEqual(h.readUInt16LE(34), 16);
  assert.strictEqual(h.readUInt32LE(40), 23520);
  assert.strictEqual(winCd.sectorSpan(0, 43), null); // only the header
  assert.deepStrictEqual(winCd.sectorSpan(0, 44), { first: 0, count: 1, skip: 0 });
  assert.deepStrictEqual(winCd.sectorSpan(44 + 2352 + 10, 44 + 2352 * 3), { first: 1, count: 3, skip: 10 });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `node --test test/win-cd.test.js`
Expected: FAIL — `Cannot find module '../src/main/win-cd'`.

- [ ] **Step 4: Implement** — `src/main/win-cd.js` (the helper client comes in Task 2; this task adds only the pure parts and the disc registry):

```js
'use strict';
/**
 * Audio CDs on Windows. Windows shows an audio CD only as .cda shortcuts with no audio behind them, so CDPlayer reads
 * the drive itself: a small PowerShell helper (win-cd/helper.ps1, C# compiled on the spot — nothing to install) reads
 * the table of contents and raw audio sectors through Windows' own CD calls, and this module runs it. A disc's
 * tracks are "cdda://F/3" paths, which the media server plays as WAV and metadata.js names.
 */
const SECTOR = 2352; // bytes of CD audio in a sector: 1/75 s of 44.1 kHz 16-bit stereo
const HEADER = 44; // a WAV header

/**
 * A CDROM_TOC (IOCTL_CDROM_READ_TOC) → { first, last, leadout, offsets, tracks }, as tocFromPlist gives on macOS:
 * absolute sector numbers (MSF, 150 more than the LBA), audio tracks only. An enhanced CD's audio ends 11400 sectors
 * before its data session. → null when the disc has no audio.
 */
function parseToc(buf) {
  const count = buf[3] - buf[2] + 2; // its tracks and the lead-out
  const entries = [];
  for (let i = 0; i < count && 4 + i * 8 + 8 <= buf.length; i++) {
    const o = 4 + i * 8;
    entries.push({ number: buf[o + 2], data: (buf[o + 1] & 4) !== 0, offset: (buf[o + 5] * 60 + buf[o + 6]) * 75 + buf[o + 7] });
  }
  const leadout = entries.find((e) => e.number === 0xAA);
  const audio = entries.filter((e) => e.number !== 0xAA && !e.data);
  if (!leadout || !audio.length) return null;
  const dataAfter = entries.find((e) => e.number !== 0xAA && e.data && e.number > audio[audio.length - 1].number);
  return {
    first: audio[0].number, last: audio[audio.length - 1].number,
    leadout: dataAfter ? dataAfter.offset - 11400 : leadout.offset,
    offsets: audio.map((e) => e.offset), tracks: audio.map((e) => e.number),
  };
}

/**
 * The helper's answers: a JSON header line, then exactly `bytes` bytes. Anything that isn't a JSON line where a
 * header should be (a PowerShell warning, a blank line) is skipped.
 */
class FrameParser {
  constructor(onFrame) { this.buf = Buffer.alloc(0); this.header = null; this.onFrame = onFrame; }
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : Buffer.from(chunk);
    for (;;) {
      if (!this.header) {
        const nl = this.buf.indexOf(10);
        if (nl < 0) return;
        const line = this.buf.subarray(0, nl).toString('utf8').trim();
        this.buf = this.buf.subarray(nl + 1);
        if (!line.startsWith('{')) continue;
        try { this.header = JSON.parse(line); } catch { continue; }
      }
      const need = this.header.bytes || 0;
      if (this.buf.length < need) return;
      const header = this.header, payload = Buffer.from(this.buf.subarray(0, need));
      this.buf = this.buf.subarray(need);
      this.header = null;
      this.onFrame(header, payload);
    }
  }
}

const trackPath = (drive, n) => `cdda://${drive.replace(':', '')}/${n}`;
function parseTrackPath(p) {
  const m = /^cdda:\/\/([A-Za-z])\/(\d+)$/.exec(String(p || ''));
  return m ? { drive: `${m[1].toUpperCase()}:`, number: parseInt(m[2], 10) } : null;
}

// The discs in the drives right now: drive → its TOC.
const discs = new Map();
function remember(drive, toc) { discs.set(drive, toc); }
function keepOnly(drives) { for (const d of [...discs.keys()]) if (!drives.has(d)) discs.delete(d); }
/** Where a cdda:// track is: { drive, number, lba (for raw reads), sectors, duration (s) } — null if not on a disc now. */
function trackInfo(p) {
  const ref = parseTrackPath(p);
  const toc = ref && discs.get(ref.drive);
  const i = toc ? toc.tracks.indexOf(ref.number) : -1;
  if (i < 0) return null;
  const start = toc.offsets[i], end = i + 1 < toc.offsets.length ? toc.offsets[i + 1] : toc.leadout;
  return { drive: ref.drive, number: ref.number, lba: start - 150, sectors: end - start, duration: (end - start) / 75 };
}

/** The 44-byte header of a WAV of CD audio holding `dataBytes` bytes. */
function wavHeader(dataBytes) {
  const h = Buffer.alloc(HEADER);
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + dataBytes, 4); h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(44100, 24); h.writeUInt32LE(44100 * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii'); h.writeUInt32LE(dataBytes, 40);
  return h;
}
/** The sectors covering bytes start…end of a track's WAV: { first, count, skip (bytes into the first) } — null if only the header. */
function sectorSpan(start, end) {
  const a = Math.max(0, start - HEADER), b = end - HEADER;
  if (b < 0) return null;
  const first = Math.floor(a / SECTOR);
  return { first, count: Math.floor(b / SECTOR) - first + 1, skip: a - first * SECTOR };
}

module.exports = { SECTOR, HEADER, parseToc, FrameParser, trackPath, parseTrackPath, remember, keepOnly, trackInfo, wavHeader, sectorSpan };
```

- [ ] **Step 5: Run the tests**

Run: `node --test test/win-cd.test.js` then `npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/win-cd.js test/win-cd.test.js test/fixtures/cd-toc.js
git commit -m "Windows audio CDs: reading a disc's table of contents, the helper's answers, and cdda:// tracks"
```

---

### Task 2: The drive helper and running it

**Files:**
- Create: `src/main/win-cd/helper.ps1`
- Create: `test/fixtures/fake-cd-helper.js`
- Modify: `src/main/win-cd.js` (add the client), `package.json` (`asarUnpack`), `.github/workflows/build.yml` (Windows smoke step)
- Test: `test/win-cd.test.js`

**Interfaces:**
- Consumes: `FrameParser`, `parseToc` (Task 1).
- Produces: `drives() → Promise<string[]>`, `readToc(drive) → Promise<toc|null>`, `readSectors(drive, lba, count) → Promise<Buffer>`, `eject(drive) → Promise<void>`, `available() → boolean` (false once the helper has died twice). The helper command can be replaced for tests with env `CDPLAYER_WIN_CD_HELPER` (a command line, split on spaces).

- [ ] **Step 1: Write the fake helper** — `test/fixtures/fake-cd-helper.js` (speaks the real protocol; the user's disc in `F:`; `read` returns sectors whose bytes are `(lba + sector) & 0xff`; `die` exits):

```js
'use strict';
// A stand-in for win-cd/helper.ps1 in tests: the same protocol, the user's CD in F:.
const readline = require('readline');
const { tocBytes, THREE_DOLLAR_BILL } = require('./cd-toc');
const toc = tocBytes(THREE_DOLLAR_BILL.lbas.map((lba, i) => ({ number: i + 1, lba })), THREE_DOLLAR_BILL.leadout);
const send = (header, payload = Buffer.alloc(0)) => {
  process.stdout.write(`${JSON.stringify({ ...header, bytes: payload.length })}\n`);
  if (payload.length) process.stdout.write(payload);
};
process.stdout.write('WARNING: a stray PowerShell line\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const req = JSON.parse(line);
  if (req.op === 'die') process.exit(1);
  if (req.op === 'drives') return send({ id: req.id, ok: true, drives: ['F:'] });
  if (req.op === 'toc') return req.drive === 'F:' ? send({ id: req.id, ok: true }, toc) : send({ id: req.id, ok: false, error: 'toc: error 21' });
  if (req.op === 'read') {
    const b = Buffer.alloc(req.count * 2352);
    for (let s = 0; s < req.count; s++) b.fill((req.lba + s) & 0xff, s * 2352, (s + 1) * 2352);
    return send({ id: req.id, ok: true }, b);
  }
  if (req.op === 'eject') return send({ id: req.id, ok: true });
  return send({ id: req.id, ok: false, error: 'unknown op' });
});
```

- [ ] **Step 2: Write the failing tests** — append to `test/win-cd.test.js`:

```js
test('the helper: drives, table of contents, sectors and eject, over the pipe', async () => {
  process.env.CDPLAYER_WIN_CD_HELPER = `${process.execPath} ${path.join(__dirname, 'fixtures', 'fake-cd-helper.js')}`;
  assert.deepStrictEqual(await winCd.drives(), ['F:']);
  const toc = await winCd.readToc('F:');
  assert.strictEqual(discId(toc), THREE_DOLLAR_BILL.id);
  const bytes = await winCd.readSectors('F:', 3635, 3);
  assert.strictEqual(bytes.length, 3 * 2352);
  assert.deepStrictEqual([bytes[0], bytes[2352], bytes[4704]], [3635 & 0xff, 3636 & 0xff, 3637 & 0xff]);
  await assert.rejects(winCd.readToc('D:'), /error 21/);
  await winCd.eject('F:');
});

test('the helper dying: what was asked fails instead of hanging; twice, and CDs are off', async () => {
  await assert.rejects(winCd._send('die'), /stopped/);
  assert.deepStrictEqual(await winCd.drives(), ['F:'], 'started again after the first time');
  await assert.rejects(winCd._send('die'), /stopped/);
  assert.strictEqual(winCd.available(), false);
  await assert.rejects(winCd.drives(), /no CD helper/);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `node --test test/win-cd.test.js`
Expected: FAIL — `winCd.drives is not a function`.

- [ ] **Step 4: Implement the client** — in `src/main/win-cd.js`, add `const path = require('path');` and `const { spawn } = require('child_process');` at the top, and before `module.exports`:

```js
// ---- The helper ------------------------------------------------------------------------------------------------
// Started the first time it's needed and kept running; requests are answered in turn. If it dies, what was asked
// fails (never hangs), and it's started again next time — but after it has died twice, CDs are off until relaunch.
const TIMEOUT_MS = 30000;
let helper = null, deaths = 0, nextId = 1;
const pending = new Map();

function helperCommand() {
  if (process.env.CDPLAYER_WIN_CD_HELPER) { const [cmd, ...args] = process.env.CDPLAYER_WIN_CD_HELPER.split(' '); return { cmd, args }; }
  const script = path.join(__dirname, 'win-cd', 'helper.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  return { cmd: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script] };
}
function start() {
  if (helper) return helper;
  if (deaths >= 2) return null;
  const { cmd, args } = helperCommand();
  let child;
  try { child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }); } catch { deaths++; return null; }
  const parser = new FrameParser((header, payload) => {
    const job = pending.get(header.id);
    if (!job) return;
    pending.delete(header.id);
    clearTimeout(job.timer);
    if (header.ok) job.resolve({ header, payload }); else job.reject(new Error(header.error || 'failed'));
  });
  child.stdout.on('data', (c) => parser.push(c));
  const died = () => {
    if (helper !== child) return;
    helper = null;
    if (++deaths >= 2) console.log('Audio CDs are off: the Windows CD helper stopped twice');
    for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error('the CD helper stopped')); }
    pending.clear();
  };
  child.on('exit', died);
  child.on('error', died);
  child.stdin.on('error', () => {});
  helper = child;
  return child;
}
function send(op, fields = {}) {
  const child = start();
  if (!child) return Promise.reject(new Error('no CD helper'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { if (pending.delete(id)) reject(new Error(`the CD helper didn't answer ${op}`)); }, TIMEOUT_MS);
    timer.unref();
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, op, ...fields })}\n`);
  });
}

const available = () => deaths < 2;
/** The CD drives with a disc in them right now: ['F:'…]. */
async function drives() { return (await send('drives')).header.drives || []; }
async function readToc(drive) { return parseToc((await send('toc', { drive })).payload); }
/** `count` raw sectors from `lba`: count × 2352 bytes (a sector that won't read comes back silent). */
async function readSectors(drive, lba, count) { return (await send('read', { drive, lba, count })).payload; }
async function eject(drive) { await send('eject', { drive }); }
```

and extend the exports: `module.exports = { SECTOR, HEADER, parseToc, FrameParser, trackPath, parseTrackPath, remember, keepOnly, trackInfo, wavHeader, sectorSpan, drives, readToc, readSectors, eject, available, _send: send };`

- [ ] **Step 5: Write the real helper** — `src/main/win-cd/helper.ps1`:

```powershell
# CDPlayer's audio-CD reader for Windows (see src/main/win-cd.js). Windows only offers an audio CD as .cda shortcuts,
# so this reads the drive itself through Windows' CD calls: the table of contents, raw audio sectors, and eject.
# Requests are JSON lines on stdin; each answer is a JSON header line on stdout followed by exactly "bytes" bytes.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.IO; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
public static class CdIo {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr sa, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool DeviceIoControl(SafeFileHandle h, uint code, byte[] inBuf, int inLen, byte[] outBuf, int outLen, out int returned, IntPtr overlapped);
  const int SECTOR = 2352, CHUNK = 20;
  static SafeFileHandle Open(string drive) {
    var h = CreateFile(@"\\.\" + drive, 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (h.IsInvalid) throw new IOException("open " + drive + ": error " + Marshal.GetLastWin32Error());
    return h;
  }
  public static byte[] Toc(string drive) {
    using (var h = Open(drive)) {
      var o = new byte[804]; int r;
      if (!DeviceIoControl(h, 0x24000, null, 0, o, o.Length, out r, IntPtr.Zero)) throw new IOException("toc: error " + Marshal.GetLastWin32Error());
      return o;
    }
  }
  static bool RawRead(SafeFileHandle h, long lba, int count, byte[] into, int at) {
    var info = new byte[16];
    BitConverter.GetBytes(lba * 2048).CopyTo(info, 0);
    BitConverter.GetBytes(count).CopyTo(info, 8);
    BitConverter.GetBytes(2).CopyTo(info, 12); // CDDA
    var o = new byte[count * SECTOR]; int r;
    if (!DeviceIoControl(h, 0x2403E, info, 16, o, o.Length, out r, IntPtr.Zero) || r < o.Length) return false;
    Buffer.BlockCopy(o, 0, into, at, o.Length);
    return true;
  }
  // A chunk that won't read is read a sector at a time, each tried twice; a sector that still won't is silence.
  public static byte[] Read(string drive, long lba, int count) {
    var all = new byte[count * SECTOR];
    using (var h = Open(drive)) {
      for (int done = 0; done < count; done += CHUNK) {
        int n = Math.Min(CHUNK, count - done);
        if (RawRead(h, lba + done, n, all, done * SECTOR)) continue;
        for (int s = 0; s < n; s++)
          if (!RawRead(h, lba + done + s, 1, all, (done + s) * SECTOR)) RawRead(h, lba + done + s, 1, all, (done + s) * SECTOR);
      }
    }
    return all;
  }
  public static void Eject(string drive) {
    using (var h = Open(drive)) {
      int r;
      if (!DeviceIoControl(h, 0x2D4808, null, 0, null, 0, out r, IntPtr.Zero)) throw new IOException("eject: error " + Marshal.GetLastWin32Error());
    }
  }
}
'@

$out = [Console]::OpenStandardOutput()
function Send($header, [byte[]]$payload) {
  if ($null -eq $payload) { $payload = [byte[]]::new(0) }
  $header.bytes = $payload.Length
  $line = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $header -Compress -Depth 3) + "`n")
  $out.Write($line, 0, $line.Length)
  if ($payload.Length) { $out.Write($payload, 0, $payload.Length) }
  $out.Flush()
}
# CD drives with a disc whose table of contents reads (an empty drive answers error 21 and is left out).
function Get-Drives {
  $list = @()
  foreach ($d in [IO.DriveInfo]::GetDrives()) {
    if ($d.DriveType -ne 'CDRom') { continue }
    $name = $d.Name.TrimEnd('\')
    try { [void][CdIo]::Toc($name); $list += $name } catch { }
  }
  return ,$list
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if (-not $line.Trim()) { continue }
  $req = $null
  try {
    $req = ConvertFrom-Json $line
    switch ($req.op) {
      'drives' { Send ([ordered]@{ id = $req.id; ok = $true; drives = @(Get-Drives) }) $null }
      'toc' { Send ([ordered]@{ id = $req.id; ok = $true }) ([CdIo]::Toc($req.drive)) }
      'read' { Send ([ordered]@{ id = $req.id; ok = $true }) ([CdIo]::Read($req.drive, [long]$req.lba, [int]$req.count)) }
      'eject' { [CdIo]::Eject($req.drive); Send ([ordered]@{ id = $req.id; ok = $true }) $null }
      default { Send ([ordered]@{ id = $req.id; ok = $false; error = 'unknown op' }) $null }
    }
  } catch {
    Send ([ordered]@{ id = $(if ($req) { $req.id } else { 0 }); ok = $false; error = "$($_.Exception.Message)" }) $null
  }
}
```

- [ ] **Step 6: Ship it unpacked, and smoke-test it on Windows CI**

`package.json` → `"asarUnpack": ["src/main/decoders/**", "src/main/win-cd/**"]`.

`.github/workflows/build.yml`, after `- run: npm test`:

```yaml
      - name: The Windows CD helper compiles and answers
        if: runner.os == 'Windows'
        shell: bash
        run: echo '{"id":1,"op":"drives"}' | powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File src/main/win-cd/helper.ps1 | tee /dev/stderr | grep -q '"ok":true'
```

- [ ] **Step 7: Run the tests**

Run: `node --test test/win-cd.test.js` then `npm test`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/win-cd.js src/main/win-cd/helper.ps1 test/win-cd.test.js test/fixtures/fake-cd-helper.js package.json .github/workflows/build.yml
git commit -m "Windows audio CDs: a helper that reads the drive directly, and running it"
```

---

### Task 3: Windows discs in the app — found, named, ejected

**Files:**
- Modify: `src/main/audio-cd.js` (`findDiscs`, new `findWinDiscs`), `src/main/main.js` (disc watcher on Windows; `cd:eject`)
- Test: `test/audio-cd.test.js`

**Interfaces:**
- Consumes: `winCd.drives`, `winCd.readToc`, `winCd.remember`, `winCd.keepOnly`, `winCd.trackPath`, `winCd.eject` (Tasks 1–2); `discId` (existing).
- Produces: on `win32`, `audioCd.findDiscs()` → `[{ mount: 'F:', name: 'Audio CD', tracks: ['cdda://F/1'…], toc, id }]` — the existing disc shape; `nameDisc`, `detailsFor`, `forgetDisc` work on it unchanged.

- [ ] **Step 1: Write the failing test** — append to `test/audio-cd.test.js` (it already sets `CDPLAYER_HOME`; add `const path = require('path');` if missing):

```js
test('Windows: the disc in a drive, read through the CD helper, with its cdda:// tracks — and forgotten when it\'s taken out', async () => {
  const realPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  process.env.CDPLAYER_WIN_CD_HELPER = `${process.execPath} ${path.join(__dirname, 'fixtures', 'fake-cd-helper.js')}`;
  try {
    const winCd = require('../src/main/win-cd');
    const { findDiscs } = require('../src/main/audio-cd');
    const [disc, ...others] = await findDiscs();
    assert.strictEqual(others.length, 0);
    assert.strictEqual(disc.mount, 'F:');
    assert.strictEqual(disc.id, '6u6SZ6TRjV_O9VDaKMAucGeZEOY-');
    assert.strictEqual(disc.tracks.length, 13);
    assert.strictEqual(disc.tracks[2], 'cdda://F/3');
    assert.ok(winCd.trackInfo('cdda://F/3'));
    winCd.drives = async () => []; // the disc taken out
    assert.deepStrictEqual(await findDiscs(), []);
    assert.strictEqual(winCd.trackInfo('cdda://F/3'), null);
  } finally {
    Object.defineProperty(process, 'platform', { value: realPlatform });
    delete process.env.CDPLAYER_WIN_CD_HELPER;
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/audio-cd.test.js`
Expected: FAIL — `findDiscs()` returns `[]` on win32 (`disc` undefined).

- [ ] **Step 3: Implement** — in `src/main/audio-cd.js`: add `const winCd = require('./win-cd');` below the other requires; update the file's header comment's last sentence to *"Windows only shows an audio CD as .cda shortcuts with no audio behind them, so there the drive is read directly (win-cd.js) and the tracks are cdda:// paths."*; and change `findDiscs`:

```js
// Windows: the discs in the drives, read through the CD helper — their tracks are cdda://F/1… paths. A drive whose
// disc is gone is forgotten, so its tracks stop playing.
async function findWinDiscs() {
  let drives = [];
  try { drives = await winCd.drives(); } catch { drives = []; }
  const discs = [], seen = new Set();
  for (const drive of drives) {
    let toc = null;
    try { toc = await winCd.readToc(drive); } catch { toc = null; }
    if (!toc) continue;
    seen.add(drive);
    winCd.remember(drive, toc);
    discs.push({ mount: drive, name: 'Audio CD', tracks: toc.tracks.map((n) => winCd.trackPath(drive, n)), toc, id: discId(toc) });
  }
  winCd.keepOnly(seen);
  return discs;
}

// A disc is read once, when it turns up; after that it's only checked for still being there.
const known = new Map(); // mount -> disc
/** Every audio CD in a drive right now: [{ mount, name, tracks: [paths in order], toc, id }]. */
async function findDiscs() {
  if (process.platform === 'win32') return findWinDiscs();
  const candidates = await candidateMounts();
  // …the rest of the existing body unchanged…
```

In `src/main/main.js`:
- the disc watcher start condition (near line 441): `if (!smokeDir && (process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32' || process.env.CDPLAYER_CD_ROOT)) {`
- `cd:eject`: after the linux line add `else if (process.platform === 'win32') require('./win-cd').eject(mount).catch(() => {});`
- update the "Audio CDs" section comment if it says macOS/Linux only.

- [ ] **Step 4: Run the tests**

Run: `node --test test/audio-cd.test.js` then `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/audio-cd.js src/main/main.js test/audio-cd.test.js
git commit -m "Windows audio CDs: discs found in the drives, named from MusicBrainz, and ejected"
```

---

### Task 4: Playing cdda:// tracks, and their details

**Files:**
- Modify: `src/main/media-protocol.js` (serve `cdda://`), `src/main/metadata.js` (details), `src/renderer/js/app.js` (no waveform for CD tracks)
- Test: `test/win-cd-media.test.js`

**Interfaces:**
- Consumes: `winCd.trackInfo`, `winCd.readSectors`, `winCd.wavHeader`, `winCd.sectorSpan`, `winCd.parseTrackPath`, `SECTOR`, `HEADER`.
- Produces: `mediaProtocol.serveCdda(request, p, read = winCd.readSectors) → Promise<Response>`; `mediaProtocol.cddaBytes(info, start, end, read)` (async generator of Buffers); `metadata.getDetails('cdda://F/3')` → details without touching the file system.

- [ ] **Step 1: Write the failing tests** — `test/win-cd-media.test.js`:

```js
'use strict';
// Playing Windows audio-CD tracks (cdda://): WAV bytes for any range, and their details, without a drive.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdplayer-test-'));
process.env.CDPLAYER_HOME = home; // never touch a real ~/.cdplayer
const electron = require.resolve('electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { nativeImage: {} } };
const winCd = require('../src/main/win-cd');
const media = require('../src/main/media-protocol');
const metadata = require('../src/main/metadata');
const { tocBytes, THREE_DOLLAR_BILL } = require('./fixtures/cd-toc');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));

winCd.remember('F:', winCd.parseToc(tocBytes(THREE_DOLLAR_BILL.lbas.map((lba, i) => ({ number: i + 1, lba })), THREE_DOLLAR_BILL.leadout)));
// A drive whose sector n is filled with the byte n & 0xff.
const reads = [];
const fakeRead = async (drive, lba, count) => {
  reads.push([lba, count]);
  const b = Buffer.alloc(count * 2352);
  for (let s = 0; s < count; s++) b.fill((lba + s) & 0xff, s * 2352, (s + 1) * 2352);
  return b;
};
const req = (range) => ({ headers: new Headers(range ? { range } : {}) });
const bytes = async (res) => Buffer.from(await res.arrayBuffer());

test('a whole-track answer: a WAV the size of the track', async () => {
  const res = await media.serveCdda(req(null), 'cdda://F/2', fakeRead);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'audio/wav');
  assert.strictEqual(Number(res.headers.get('content-length')), 44 + 17440 * 2352);
});

test('a seek: exactly the bytes asked for, from the right sectors — mid-sector and across the header', async () => {
  const start = 44 + 2352 * 100 + 7, end = start + 2352 * 30; // 31 sectors, starting 7 bytes into sector 100
  reads.length = 0;
  const res = await media.serveCdda(req(`bytes=${start}-${end}`), 'cdda://F/2', fakeRead);
  assert.strictEqual(res.status, 206);
  const b = await bytes(res);
  assert.strictEqual(b.length, end - start + 1);
  assert.strictEqual(b[0], (3635 + 100) & 0xff);
  assert.strictEqual(b[b.length - 1], (3635 + 130) & 0xff);
  assert.deepStrictEqual(reads, [[3735, 25], [3760, 6]], 'read 25 sectors at a time');
  const head = await bytes(await media.serveCdda(req('bytes=40-47'), 'cdda://F/2', fakeRead));
  assert.strictEqual(head.length, 8);
  assert.strictEqual(head.readUInt32LE(0), 17440 * 2352); // the data size, the header's last 4 bytes
  assert.deepStrictEqual([...head.subarray(4)], [3635 & 0xff, 3635 & 0xff, 3635 & 0xff, 3635 & 0xff]);
});

test('a track of a disc that\'s gone: not found', async () => {
  assert.strictEqual((await media.serveCdda(req(null), 'cdda://G/1', fakeRead)).status, 404);
});

test('a CD track\'s details come from the disc, never the file system', async () => {
  const d = await metadata.getDetails('cdda://F/2', { withCover: false });
  assert.strictEqual(d.title, 'Track 2');
  assert.strictEqual(d.duration, 17440 / 75);
  assert.strictEqual(d.quality, 'CD AUDIO · 16-BIT · 44.1 KHZ');
  assert.strictEqual(d.unnamed, true, 'an unnamed CD track is not looked up online');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/win-cd-media.test.js`
Expected: FAIL — `media.serveCdda is not a function`.

- [ ] **Step 3: Implement**

`src/main/media-protocol.js` — add `const winCd = require('./win-cd');` with the other requires; before `async function serveMedia`:

```js
// ---- Windows audio CDs --------------------------------------------------------------------------------------------
// A cdda://F/3 track is played as a WAV: its header, then its sectors read straight from the drive, 25 at a time and
// only those a request (a seek) needs.
const CD_CHUNK = 25;
async function* cddaBytes(info, start, end, read) {
  if (start < winCd.HEADER) yield winCd.wavHeader(info.sectors * winCd.SECTOR).subarray(start, Math.min(winCd.HEADER, end + 1));
  const span = winCd.sectorSpan(start, end);
  if (!span) return;
  let left = end + 1 - Math.max(start, winCd.HEADER), skip = span.skip;
  for (let s = span.first; s < span.first + span.count && left > 0; s += CD_CHUNK) {
    const n = Math.min(CD_CHUNK, span.first + span.count - s);
    const got = (await read(info.drive, info.lba + s, n)).subarray(skip, skip + left);
    skip = 0; left -= got.length;
    yield got;
  }
}
async function serveCdda(request, p, read = winCd.readSectors) {
  const info = winCd.trackInfo(p);
  if (!info) return new Response('Not found', { status: 404 });
  const size = winCd.HEADER + info.sectors * winCd.SECTOR;
  return respond(request, size, 'audio/wav', (start, end) => Readable.toWeb(Readable.from(cddaBytes(info, start, end, read))));
}
```

and at the top of `serveMedia`: `if (winCd.parseTrackPath(filePath)) return serveCdda(request, filePath);` — before the `path.isAbsolute` check. Export: `module.exports = { handle, resolvePlayable, parseRange, serveCdda, cddaBytes };`

`src/main/metadata.js` — add `const winCd = require('./win-cd');`; in `getDetails`, replace the first line with:

```js
  const onDisc = winCd.trackInfo(filePath);
  const details = onDisc ? cdTrackDetails(filePath, onDisc, opts) : await readDetails(filePath, opts);
```

and above `getDetails`:

```js
// A Windows audio-CD track (cdda://): nothing to read from a file — its length from the disc's table of contents,
// its name from MusicBrainz (below) or else "Track N".
function cdTrackDetails(p, info, { withCover = true } = {}) {
  return {
    path: p, title: `Track ${info.number}`, artist: null, nameGuessed: false, unnamed: true, credits: {}, album: null,
    lyrics: null, duration: info.duration, ext: 'CDA', quality: 'CD AUDIO · 16-BIT · 44.1 KHZ', cover: withCover ? null : undefined,
  };
}
```

(When MusicBrainz has named the disc, the existing `audioCd.detailsFor` block below overrides title/artist/album and sets `unnamed: false`.)

`src/renderer/js/app.js` — the waveform condition (near line 350): `if (!cue && !isAudioCdTrack(path) && engine.duration && engine.duration < 30 * 60) {` and extend its comment: *"(…Nor for a CD track: it would read the whole track off the disc first.)"*

- [ ] **Step 4: Run the tests**

Run: `node --test test/win-cd-media.test.js` then `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/media-protocol.js src/main/metadata.js src/renderer/js/app.js test/win-cd-media.test.js
git commit -m "Windows audio CDs: tracks played straight from the drive, seeking included, and named"
```

---

### Task 5: A Windows test build, and the user's check on real hardware

**Files:** none changed unless the check finds problems.

- [ ] **Step 1: Build** — on the Mac: `npm run dist:win` → `dist/CDPlayer-2.7.0-windows.exe` (x64; runs on Windows 11 ARM through its emulation). Confirm `dist/win-unpacked/resources/app.asar.unpacked/src/main/win-cd/helper.ps1` exists.

- [ ] **Step 2: Hand it to the user** with these steps:
  1. On the Mac, quit CDPlayer. In UTM, pass the CD drive to the VM (USB icon), CD inside.
  2. Copy `CDPlayer-2.7.0-windows.exe` into Windows (UTM shared folder, or drag and drop) and run it (SmartScreen: *More info → Run anyway*).
  3. Report: does **AUDIO CD** appear within ~10 s? Does it change to *Three Dollar Bill, Yall$* with the cover? Click it: does it play? Seek with the bar and ←/→; skip tracks with L/J; press E: does the tray eject?

- [ ] **Step 3: Fix what they report** — each finding gets a failing test first where it can be reproduced here (the fake helper), then the fix, then a new test build. Commit each fix separately.

---

## Self-review notes

- Spec §1 helper → Task 2; §2 Node side → Tasks 1–2; §3 finding discs/eject → Task 3; §4 playing → Task 4; §5 other places → Task 4 (details, waveform, Tags button already hidden for CD tracks by `isAudioCdTrack`, which matches `cdda://` tracks since they're the disc's `tracks`). Testing section → Tasks 1–5 (CI smoke in Task 2).
- **Deviation (ruling):** the spec says a restored queue "drops cdda:// tracks whose disc is gone". `fs:exists` (`cue.entryExists`) reports every `cdda://` path as missing, so restored CD tracks are dropped even if the disc is still in — CDs aren't restored across launches on Windows. The disc's AUDIO CD button reappears at once, so nothing is lost but the old queue position. Cost if wrong: one click to put the CD back in.
- Names are consistent across tasks: `parseToc`, `FrameParser`, `trackPath`, `parseTrackPath`, `remember`, `keepOnly`, `trackInfo`, `wavHeader`, `sectorSpan`, `drives`, `readToc`, `readSectors`, `eject`, `available`, `_send`, `serveCdda`, `cddaBytes`.
