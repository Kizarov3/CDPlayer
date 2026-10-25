'use strict';
/**
 * A .zip unpacked into a folder — enough for yt-dlp's releases (stored and deflated files, no zip64), with nothing to
 * install: no unzip on every Linux, none built into Windows' Node. A file meant to be run keeps being runnable; a name
 * leading out of the folder (an absolute path, "..") is refused.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function entries(zip) {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('Not a zip');
  const count = zip.readUInt16LE(end + 10);
  const list = [];
  for (let i = 0, at = zip.readUInt32LE(end + 16); i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('Broken zip');
    const nameLength = zip.readUInt16LE(at + 28), extra = zip.readUInt16LE(at + 30), comment = zip.readUInt16LE(at + 32);
    list.push({
      name: zip.toString('utf8', at + 46, at + 46 + nameLength), method: zip.readUInt16LE(at + 10),
      size: zip.readUInt32LE(at + 20), mode: zip.readUInt32LE(at + 38) >>> 16, local: zip.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + extra + comment;
  }
  return list;
}

function extract(zip, dir) {
  const root = path.resolve(dir);
  for (const e of entries(zip)) {
    const to = path.resolve(root, e.name);
    if (path.isAbsolute(e.name) || (to !== root && !to.startsWith(root + path.sep))) throw new Error(`Bad name in zip: ${e.name}`);
    if (e.name.endsWith('/')) { fs.mkdirSync(to, { recursive: true }); continue; }
    if (zip.readUInt32LE(e.local) !== 0x04034b50) throw new Error('Broken zip');
    const start = e.local + 30 + zip.readUInt16LE(e.local + 26) + zip.readUInt16LE(e.local + 28);
    const packed = zip.subarray(start, start + e.size);
    const data = e.method === 0 ? packed : e.method === 8 ? zlib.inflateRawSync(packed) : null;
    if (!data) throw new Error(`Unknown packing in zip: ${e.method}`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, data, { mode: e.mode & 0o111 ? 0o755 : 0o644 });
  }
}

module.exports = { extract, entries };
