'use strict';
/**
 * Audio CDs on Windows. Windows shows an audio CD only as .cda shortcuts with no audio behind them, so CDPlayer reads
 * the drive itself: a small PowerShell helper (win-cd/helper.ps1, C# compiled on the spot — nothing to install) reads
 * the table of contents and raw audio sectors through Windows' own CD calls, and this module runs it. A disc's
 * tracks are "cdda://F/3" paths, which the media server plays as WAV and metadata.js names.
 */
const path = require('path');
const { spawn } = require('child_process');

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

// ---- The helper ------------------------------------------------------------------------------------------------
// Started the first time it's needed and kept running; requests are answered in turn. If it dies, what was asked
// fails (never hangs), and it's started again next time — but after it has died twice, CDs are off until relaunch.
let timeoutMs = 30000;
let helper = null, deaths = 0, nextId = 1;
const pending = new Map();

function helperCommand() {
  // (tests: a stand-in helper, as a JSON array ["C:\\Program Files\\nodejs\\node.exe", "fake.js"] or words split on spaces)
  const custom = process.env.CDPLAYER_WIN_CD_HELPER;
  if (custom) { const [cmd, ...args] = custom.trim().startsWith('[') ? JSON.parse(custom) : custom.split(' '); return { cmd, args }; }
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
    if (!pending.size) hold(false);
    if (header.ok) job.resolve({ header, payload }); else job.reject(new Error(header.error || 'failed'));
  });
  child.stdout.on('data', (c) => parser.push(c));
  const died = () => {
    if (helper !== child) return;
    if (++deaths >= 2) console.log('Audio CDs are off: the Windows CD helper stopped twice');
    abandon(child, 'the CD helper stopped');
  };
  child.on('exit', died);
  child.on('error', died);
  child.stdin.on('error', () => {});
  helper = child;
  hold(false);
  return child;
}
// Lets go of a helper: whatever was asked of it fails now, and the next request starts a fresh one.
function abandon(child, reason) {
  if (helper !== child) return;
  helper = null;
  for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error(reason)); }
  pending.clear();
}
// An idle helper doesn't keep Node running; one with a request in flight does (until it answers or times out).
function hold(on) {
  if (!helper) return;
  for (const h of [helper, helper.stdout, helper.stdin]) if (h) (on ? h.ref : h.unref).call(h);
}
function send(op, fields = {}) {
  const child = start();
  if (!child) return Promise.reject(new Error('no CD helper'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    // No answer in time: the drive is stuck (a bad disc, a USB hiccup). The helper is stopped — everything asked of it
    // fails now rather than waiting behind it — and a fresh one starts with the next request. (Not a death: CDs stay on.)
    const timer = setTimeout(() => {
      if (!pending.delete(id)) return;
      reject(new Error(`the CD helper didn't answer ${op}`));
      abandon(child, `the CD helper didn't answer ${op}`);
      child.kill();
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    hold(true);
    child.stdin.write(`${JSON.stringify({ id, op, ...fields })}\n`);
  });
}

const available = () => deaths < 2;
const setTimeoutMs = (ms) => { timeoutMs = ms; }; // (tests)
// The helper's drive list, flat whatever shape PowerShell gave it (Windows PowerShell 5.1 wraps it: [["F:"]]).
const driveList = (d) => [].concat(d == null ? [] : d).flat(Infinity).filter((x) => typeof x === 'string');
/** The CD drives with a disc in them right now: ['F:'…]. */
async function drives() { return driveList((await send('drives')).header.drives); }
async function readToc(drive) { return parseToc((await send('toc', { drive })).payload); }
/** `count` raw sectors from `lba`: count × 2352 bytes (a sector that won't read comes back silent). */
async function readSectors(drive, lba, count) { return (await send('read', { drive, lba, count })).payload; }
async function eject(drive) { await send('eject', { drive }); }

module.exports = { SECTOR, HEADER, parseToc, FrameParser, trackPath, parseTrackPath, remember, keepOnly, trackInfo, wavHeader, sectorSpan, driveList, drives, readToc, readSectors, eject, available, _send: send, _setTimeout: setTimeoutMs };
