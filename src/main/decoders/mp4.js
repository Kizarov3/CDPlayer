'use strict';

/**
 * Minimal ISO-BMFF (MP4/M4A) demuxer — just enough to find the first audio track, identify its codec, pull out
 * its codec-specific config, and list every packet's byte range. Used to route Apple Lossless files (which
 * Chromium can't decode) to the pure-JS ALAC decoder, while AAC files are streamed straight to Chromium untouched.
 */

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf']);

function readBoxes(buf, start, end, visit) {
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    let header = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(pos + 8)); header = 16; }
    else if (size === 0) size = end - pos;
    if (size < header || pos + size > end) break;
    if (visit(type, pos + header, pos + size) === false) return;
    pos += size;
  }
}

function findAudioTrack(buf) {
  let moov = null;
  readBoxes(buf, 0, buf.length, (type, start, end) => {
    if (type === 'moov') { moov = [start, end]; return false; }
  });
  if (!moov) return null;
  let found = null;
  readBoxes(buf, moov[0], moov[1], (type, start, end) => {
    if (type !== 'trak' || found) return;
    const boxes = {};
    const collect = (s, e) => readBoxes(buf, s, e, (t, bs, be) => {
      if (CONTAINERS.has(t)) collect(bs, be);
      else if (!boxes[t]) boxes[t] = [bs, be];
    });
    collect(start, end);
    const hdlr = boxes.hdlr;
    if (hdlr && buf.toString('latin1', hdlr[0] + 8, hdlr[0] + 12) === 'soun' && boxes.stsd) found = boxes;
  });
  return found;
}

function parseMp4Audio(buf) {
  const boxes = findAudioTrack(buf);
  if (!boxes) return null;
  const [stsdStart] = boxes.stsd;
  // stsd: version/flags (4) + entry count (4), then the first sample entry box.
  const entryPos = stsdStart + 8;
  const entrySize = buf.readUInt32BE(entryPos);
  const codec = buf.toString('latin1', entryPos + 4, entryPos + 8);
  const entryEnd = entryPos + entrySize;
  const channels = buf.readUInt16BE(entryPos + 24);
  const sampleRate = buf.readUInt32BE(entryPos + 32) >>> 16;

  let config = null;
  if (codec === 'alac') {
    // The 24-byte ALACSpecificConfig sits in a child 'alac' box (size 36: header 8 + version/flags 4 + config 24).
    // QuickTime-style v1/v2 sound descriptions put extra fields before it, so search instead of assuming an offset.
    for (let p = entryPos + 8; p + 36 <= entryEnd; p++) {
      if (buf.toString('latin1', p + 4, p + 8) === 'alac' && buf.readUInt32BE(p) >= 36) {
        config = buf.subarray(p + 12, p + 36);
        break;
      }
    }
  }

  const sizes = [];
  if (boxes.stsz) {
    const s = boxes.stsz[0];
    const uniform = buf.readUInt32BE(s + 4), count = buf.readUInt32BE(s + 8);
    for (let i = 0; i < count; i++) sizes.push(uniform || buf.readUInt32BE(s + 12 + i * 4));
  }
  const chunkOffsets = [];
  if (boxes.stco) {
    const s = boxes.stco[0], count = buf.readUInt32BE(s + 4);
    for (let i = 0; i < count; i++) chunkOffsets.push(buf.readUInt32BE(s + 8 + i * 4));
  } else if (boxes.co64) {
    const s = boxes.co64[0], count = buf.readUInt32BE(s + 4);
    for (let i = 0; i < count; i++) chunkOffsets.push(Number(buf.readBigUInt64BE(s + 8 + i * 8)));
  }
  const stsc = [];
  if (boxes.stsc) {
    const s = boxes.stsc[0], count = buf.readUInt32BE(s + 4);
    for (let i = 0; i < count; i++) stsc.push({ firstChunk: buf.readUInt32BE(s + 8 + i * 12), samplesPerChunk: buf.readUInt32BE(s + 12 + i * 12) });
  }

  // Expand the chunk/sample tables into one flat list of packet byte ranges.
  const packets = [];
  let sample = 0;
  for (let c = 0; c < chunkOffsets.length && sample < sizes.length; c++) {
    let perChunk = 0;
    for (const entry of stsc) if (entry.firstChunk <= c + 1) perChunk = entry.samplesPerChunk; else break;
    let offset = chunkOffsets[c];
    for (let i = 0; i < perChunk && sample < sizes.length; i++, sample++) {
      packets.push([offset, sizes[sample]]);
      offset += sizes[sample];
    }
  }
  return { codec, channels, sampleRate, config, packets };
}

module.exports = { parseMp4Audio };
