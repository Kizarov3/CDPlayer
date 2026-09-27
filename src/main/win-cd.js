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
