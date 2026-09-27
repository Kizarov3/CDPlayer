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
