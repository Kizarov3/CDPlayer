import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { flattenMp4 } from '../src/renderer/js/mp4-flatten.js';

// fragmented.mp4: 2.5 s of H.264 + AAC as the recorder writes it (empty moov, a moof + mdat per second).
const fragmented = new Uint8Array(fs.readFileSync(new URL('./fixtures/fragmented.mp4', import.meta.url)));

const top = (b) => {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength), out = [];
  for (let p = 0; p + 8 <= b.length;) { const size = v.getUint32(p); out.push({ type: String.fromCharCode(...b.subarray(p + 4, p + 8)), p, size }); p += size; }
  return out;
};
const findBoxes = (b, type) => { const out = []; for (let i = 4; i + 4 <= b.length; i++) if (String.fromCharCode(...b.subarray(i, i + 4)) === type) out.push(i - 4); return out; };

test('a fragmented MP4 made plain: ftyp, moov, one mdat; no fragments left; the same media', () => {
  const flat = flattenMp4(fragmented);
  assert.deepStrictEqual(top(flat).map((b) => b.type), ['ftyp', 'moov', 'mdat']);
  assert.strictEqual(findBoxes(flat, 'moof').length, 0);
  assert.strictEqual(findBoxes(flat, 'mvex').length, 0);
  const media = (b) => top(b).filter((x) => x.type === 'mdat').reduce((n, x) => n + x.size - 8, 0);
  assert.strictEqual(media(flat), media(fragmented));
  // The movie says how long it is: 2.5 s (mvhd version 0 or 1).
  const v = new DataView(flat.buffer), mvhd = findBoxes(flat, 'mvhd')[0];
  const v1 = flat[mvhd + 8] === 1;
  const scale = v.getUint32(mvhd + 12 + (v1 ? 16 : 8));
  const length = v1 ? Number(v.getBigUint64(mvhd + 32)) : v.getUint32(mvhd + 24);
  assert.ok(Math.abs(length / scale - 2.5) < 0.1, `${length / scale} s`);
  // Every sample's bytes where the table says: the chunk offsets point inside the mdat.
  const mdat = top(flat).find((b) => b.type === 'mdat');
  for (const stco of findBoxes(flat, 'stco')) {
    const n = v.getUint32(stco + 12);
    for (let i = 0; i < n; i++) { const at = v.getUint32(stco + 16 + i * 4); assert.ok(at >= mdat.p + 8 && at < mdat.p + mdat.size); }
  }
});

test('an MP4 that is already plain, or not an MP4 at all, comes back as it was', () => {
  const flat = flattenMp4(fragmented);
  assert.strictEqual(flattenMp4(flat), flat);
  const junk = new Uint8Array([1, 2, 3, 4, 5]);
  assert.strictEqual(flattenMp4(junk), junk);
});
