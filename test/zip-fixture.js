'use strict';
// A .zip made in memory, as yt-dlp's releases and the services' exports come.
function makeZip(files) {
  const zlib = require('zlib');
  const locals = [], centrals = [];
  let at = 0;
  for (const { name, data, deflate, mode = 0o644 } of files) {
    const packed = deflate ? zlib.deflateRawSync(data) : data, n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38); central.writeUInt32LE(at, 42);
    locals.push(local, n, packed); centrals.push(central, n);
    at += 30 + n.length + packed.length;
  }
  const dir = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat([...locals, dir, end]);
}
module.exports = { makeZip };
