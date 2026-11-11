'use strict';
// node scripts/appimage-update-info.js <file.AppImage> [<update information>]
// Writes the AppImage's update information into its runtime's .upd_info section (the AppImage spec's "embedded update
// information"), so AppImageUpdate, appimaged and the like can update it from the .zsync published beside it, and
// the AppImage catalog finds it. electron-builder leaves the section empty. Without a second argument, the latest
// GitHub release's CDPlayer-…-linux.AppImage.zsync. Prints the runtime's size (where the squashfs starts).
const fs = require('fs');

const UPDATE_INFO = 'gh-releases-zsync|Kizarov3|CDPlayer|latest|CDPlayer-*-linux.AppImage.zsync';

/** The ELF64 runtime's sections: { name: { offset, size } }, and where it ends. */
function sections(buf) {
  if (buf.readUInt32BE(0) !== 0x7f454c46 || buf[4] !== 2 || buf[5] !== 1) throw new Error('not a 64-bit little-endian ELF');
  const shoff = Number(buf.readBigUInt64LE(0x28)), shentsize = buf.readUInt16LE(0x3a), shnum = buf.readUInt16LE(0x3c), shstrndx = buf.readUInt16LE(0x3e);
  const header = (i) => { const o = shoff + i * shentsize; return { name: buf.readUInt32LE(o), offset: Number(buf.readBigUInt64LE(o + 0x18)), size: Number(buf.readBigUInt64LE(o + 0x20)) }; };
  const names = header(shstrndx), out = {};
  for (let i = 0; i < shnum; i++) {
    const h = header(i), at = names.offset + h.name;
    out[buf.toString('latin1', at, buf.indexOf(0, at))] = { offset: h.offset, size: h.size };
  }
  return { sections: out, end: shoff + shnum * shentsize };
}

/** `info` written into `file`'s .upd_info (zero-padded). → the runtime's size. */
function writeUpdateInfo(file, info = UPDATE_INFO) {
  const fd = fs.openSync(file, 'r+');
  try {
    const head = Buffer.alloc(256 * 1024);
    fs.readSync(fd, head, 0, head.length, 0);
    const { sections: s, end } = sections(head), slot = s['.upd_info'];
    if (!slot) throw new Error('no .upd_info section in the AppImage runtime');
    const bytes = Buffer.from(info, 'utf8');
    if (bytes.length >= slot.size) throw new Error(`update information longer than .upd_info's ${slot.size} bytes`);
    const filled = Buffer.alloc(slot.size); bytes.copy(filled);
    fs.writeSync(fd, filled, 0, filled.length, slot.offset);
    return end;
  } finally { fs.closeSync(fd); }
}

if (require.main === module) {
  const [file, info] = process.argv.slice(2);
  if (!file) { console.error('usage: appimage-update-info.js <file.AppImage> [<update information>]'); process.exit(2); }
  console.log(writeUpdateInfo(file, info || UPDATE_INFO));
}
module.exports = { sections, writeUpdateInfo, UPDATE_INFO };
