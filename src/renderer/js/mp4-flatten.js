// The recorder's MP4 made a plain one. MediaRecorder writes a fragmented MP4 (a moov with no samples in it, then a
// moof + mdat every few seconds), and some players play only its first fragment — three seconds
// of the video. Here the fragments' samples are gathered into one sample table, the moov put first (ready to stream),
// and all the media after it in one mdat, as it was: nothing re-encoded.

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'moof', 'traf', 'edts', 'dinf']);

/** The boxes in bytes[start, end): [{ type, start, size, head }] (head: where its contents begin). */
function boxes(v, start, end) {
  const out = [];
  for (let p = start; p + 8 <= end;) {
    let size = v.getUint32(p), head = 8;
    const type = String.fromCharCode(v.getUint8(p + 4), v.getUint8(p + 5), v.getUint8(p + 6), v.getUint8(p + 7));
    if (size === 1) { size = Number(v.getBigUint64(p + 8)); head = 16; } else if (size === 0) size = end - p;
    if (size < head || p + size > end) break;
    out.push({ type, start: p, size, head: p + head });
    p += size;
  }
  return out;
}
const kids = (v, box) => boxes(v, box.head, box.start + box.size);
const find = (v, box, type) => kids(v, box).find((b) => b.type === type);

/** Turn a fragmented MP4 into a plain one. → the new bytes, or the same ones when it isn't fragmented (or can't be read). */
export function flattenMp4(bytes) {
  try { return flatten(bytes) || bytes; } catch { return bytes; }
}

function flatten(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const top = boxes(v, 0, bytes.length);
  const ftyp = top.find((b) => b.type === 'ftyp'), moov = top.find((b) => b.type === 'moov');
  if (!ftyp || !moov || !top.some((b) => b.type === 'moof')) return null;
  const mvhd = find(v, moov, 'mvhd');
  const movieScale = v.getUint32(mvhd.head + (v.getUint8(mvhd.head) ? 20 : 12));

  // Each track: its boxes, and the defaults its fragments lean on (trex).
  const tracks = new Map();
  for (const trak of kids(v, moov).filter((b) => b.type === 'trak')) {
    const tkhd = find(v, trak, 'tkhd'), mdia = find(v, trak, 'mdia'), mdhd = find(v, mdia, 'mdhd');
    const id = v.getUint32(tkhd.head + (v.getUint8(tkhd.head) ? 20 : 12));
    const stbl = find(v, find(v, mdia, 'minf'), 'stbl');
    tracks.set(id, { trak, tkhd, mdhd, stbl, scale: v.getUint32(mdhd.head + (v.getUint8(mdhd.head) ? 20 : 12)),
      defaults: { duration: 0, size: 0, flags: 0 }, samples: [], chunks: [], end: 0 });
  }
  const mvex = find(v, moov, 'mvex');
  for (const trex of mvex ? kids(v, mvex).filter((b) => b.type === 'trex') : []) {
    const t = tracks.get(v.getUint32(trex.head + 4));
    if (t) t.defaults = { duration: v.getUint32(trex.head + 12), size: v.getUint32(trex.head + 16), flags: v.getUint32(trex.head + 20) };
  }

  // The fragments' runs, in the order they're in the file: each one a chunk of samples lying together.
  const runs = [];
  for (const moof of top.filter((b) => b.type === 'moof')) {
    for (const traf of kids(v, moof).filter((b) => b.type === 'traf')) {
      const tfhd = find(v, traf, 'tfhd');
      const tf = v.getUint32(tfhd.head) & 0xffffff;
      const t = tracks.get(v.getUint32(tfhd.head + 4));
      if (!t) continue;
      let q = tfhd.head + 8, base = moof.start;
      if (tf & 0x1) { base = Number(v.getBigUint64(q)); q += 8; }
      if (tf & 0x2) q += 4;
      const d = { ...t.defaults };
      if (tf & 0x8) { d.duration = v.getUint32(q); q += 4; }
      if (tf & 0x10) { d.size = v.getUint32(q); q += 4; }
      if (tf & 0x20) { d.flags = v.getUint32(q); q += 4; }
      // A gap before this fragment (where it says its first sample is decoded) goes onto the sample before it.
      const tfdt = find(v, traf, 'tfdt');
      if (tfdt) {
        const at = v.getUint8(tfdt.head) ? Number(v.getBigUint64(tfdt.head + 4)) : v.getUint32(tfdt.head + 4);
        const last = t.samples[t.samples.length - 1];
        if (last && at > t.end) last.duration += at - t.end;
        if (at > t.end) t.end = at;
      }
      for (const trun of kids(v, traf).filter((b) => b.type === 'trun')) {
        const rf = v.getUint32(trun.head) & 0xffffff, count = v.getUint32(trun.head + 4);
        let r = trun.head + 8, offset = base;
        if (rf & 0x1) { offset = base + v.getInt32(r); r += 4; }
        let firstFlags = null;
        if (rf & 0x4) { firstFlags = v.getUint32(r); r += 4; }
        let size = 0;
        for (let i = 0; i < count; i++) {
          const s = { duration: d.duration, size: d.size, flags: i === 0 && firstFlags !== null ? firstFlags : d.flags, cto: 0 };
          if (rf & 0x100) { s.duration = v.getUint32(r); r += 4; }
          if (rf & 0x200) { s.size = v.getUint32(r); r += 4; }
          if (rf & 0x400) { s.flags = v.getUint32(r); r += 4; }
          if (rf & 0x800) { s.cto = v.getInt32(r); r += 4; }
          t.samples.push(s);
          t.end += s.duration;
          size += s.size;
        }
        if (!count) continue;
        if (offset + size > bytes.length) return null;
        const chunk = { track: t, from: offset, size, count };
        t.chunks.push(chunk);
        runs.push(chunk);
      }
    }
  }
  if (!runs.length) return null;

  // The new moov: the same, but each track's sample table made from its samples, the durations filled in, no mvex.
  // Made twice: once to know its size (and so where the media starts), then with the chunks' real offsets.
  const mediaSize = runs.reduce((n, c) => n + c.size, 0);
  const big = mediaSize + bytes.length > 0xffffffff;
  const movieLength = Math.max(...[...tracks.values()].map((t) => Math.round(t.end * movieScale / t.scale)));
  const makeMoov = () => {
    const parts = [patchDuration(bytes, v, mvhd, 0, movieLength)];
    for (const t of tracks.values()) parts.push(trakBox(bytes, v, t, movieScale, big));
    for (const b of kids(v, moov)) if (!['mvhd', 'trak', 'mvex'].includes(b.type)) parts.push(bytes.subarray(b.start, b.start + b.size));
    return box('moov', parts);
  };
  for (const c of runs) c.at = 0;
  const ftypBytes = bytes.subarray(ftyp.start, ftyp.start + ftyp.size);
  const mdatHead = mediaSize + 8 > 0xffffffff ? 16 : 8;
  let at = ftypBytes.length + makeMoov().length + mdatHead;
  for (const c of runs) { c.at = at; at += c.size; }
  const newMoov = makeMoov();

  const out = new Uint8Array(at);
  out.set(ftypBytes, 0);
  out.set(newMoov, ftypBytes.length);
  const o = new DataView(out.buffer);
  let p = ftypBytes.length + newMoov.length;
  if (mdatHead === 16) { o.setUint32(p, 1); setType(out, p + 4, 'mdat'); o.setBigUint64(p + 8, BigInt(mediaSize + 16)); } else { o.setUint32(p, mediaSize + 8); setType(out, p + 4, 'mdat'); }
  for (const c of runs) out.set(bytes.subarray(c.from, c.from + c.size), c.at);
  return out;
}

function setType(out, p, type) { for (let i = 0; i < 4; i++) out[p + i] = type.charCodeAt(i); }

/** A box of the given type around the parts (Uint8Arrays). */
function box(type, parts) {
  const size = 8 + parts.reduce((n, x) => n + x.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  setType(out, 4, type);
  let p = 8;
  for (const x of parts) { out.set(x, p); p += x.length; }
  return out;
}
/** A full box (version 0, no flags) of 32-bit numbers. */
function fullBox(type, words) {
  const body = new Uint8Array(4 + words.length * 4);
  const d = new DataView(body.buffer);
  words.forEach((w, i) => d.setUint32(4 + i * 4, w >>> 0));
  return box(type, [body]);
}

/** A copy of mvhd / tkhd / mdhd with its duration set (`skip`: how many 32-bit fields come before the duration, after the times). */
function patchDuration(bytes, v, b, skip, duration) {
  const copy = bytes.slice(b.start, b.start + b.size);
  const d = new DataView(copy.buffer);
  const v1 = v.getUint8(b.head) === 1;
  const p = (b.head - b.start) + 4 + (v1 ? 16 : 8) + 4 + skip * 4;
  if (v1) d.setBigUint64(p, BigInt(duration)); else d.setUint32(p, Math.min(duration, 0xffffffff));
  return copy;
}

function trakBox(bytes, v, t, movieScale, big) {
  const sub = (b) => bytes.subarray(b.start, b.start + b.size);
  // tkhd: track id sits where mvhd's timescale is, so the duration is one field further on.
  const tkhd = patchDuration(bytes, v, t.tkhd, 1, Math.round(t.end * movieScale / t.scale));
  const mdhd = patchDuration(bytes, v, t.mdhd, 0, t.end);
  const s = t.samples;
  const stts = [];
  for (const x of s) { const last = stts[stts.length - 1]; if (last && last[1] === x.duration) last[0]++; else stts.push([1, x.duration]); }
  const tables = [sub(find(v, t.stbl, 'stsd')), fullBox('stts', [stts.length, ...stts.flat()])];
  if (s.some((x) => x.cto)) {
    const ctts = [];
    for (const x of s) { const last = ctts[ctts.length - 1]; if (last && last[1] === x.cto) last[0]++; else ctts.push([1, x.cto]); }
    tables.push(fullBox('ctts', [ctts.length, ...ctts.flat()]));
  }
  // Every sample a sync sample (audio) needs no stss; otherwise the ones whose "non-sync" flag is off.
  const sync = [];
  s.forEach((x, i) => { if (!(x.flags & 0x10000)) sync.push(i + 1); });
  if (sync.length < s.length) tables.push(fullBox('stss', [sync.length, ...sync]));
  const stsc = [];
  t.chunks.forEach((c, i) => { if (!stsc.length || stsc[stsc.length - 1][1] !== c.count) stsc.push([i + 1, c.count, 1]); });
  tables.push(fullBox('stsc', [stsc.length, ...stsc.flat()]));
  tables.push(fullBox('stsz', [0, s.length, ...s.map((x) => x.size)]));
  tables.push(big ? fullBox('co64', [t.chunks.length, ...t.chunks.flatMap((c) => [Math.floor(c.at / 2 ** 32), c.at % 2 ** 32])])
    : fullBox('stco', [t.chunks.length, ...t.chunks.map((c) => c.at)]));
  const stbl = box('stbl', tables);
  // Rebuild trak → mdia → minf around the new stbl, keeping every other box as it was.
  const rebuild = (b, inner) => box(b.type, kids(v, b).map((k) => inner[k.type] || sub(k)));
  const mdia = find(v, t.trak, 'mdia'), minf = find(v, mdia, 'minf');
  const newMinf = rebuild(minf, { stbl });
  const newMdia = rebuild(mdia, { mdhd, minf: newMinf });
  return rebuild(t.trak, { tkhd, mdia: newMdia });
}
