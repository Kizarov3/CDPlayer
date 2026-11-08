import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { flattenMp4, mp4Reach } from '../src/renderer/js/mp4-flatten.js';

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

const durations = (b) => {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength), out = [];
  for (const mdhd of findBoxes(b, 'mdhd')) { const v1 = b[mdhd + 8] === 1; out.push((v1 ? Number(v.getBigUint64(mdhd + 32)) : v.getUint32(mdhd + 24)) / v.getUint32(mdhd + (v1 ? 28 : 20))); }
  return out;
};
const sampleCounts = (b) => findBoxes(b, 'stsz').map((p) => new DataView(b.buffer, b.byteOffset).getUint32(p + 16));

test('cut to a length: both tracks end there, with only the samples before it', () => {
  const whole = flattenMp4(fragmented), cut = flattenMp4(fragmented, 1.5);
  for (const d of durations(cut)) assert.ok(Math.abs(d - 1.5) < 0.001, `${d} s`);
  sampleCounts(cut).forEach((n, i) => assert.ok(n < sampleCounts(whole)[i] * 0.7 && n > sampleCounts(whole)[i] * 0.5, `${n}`));
  // the sample sizes still add up to the media kept
  const v = new DataView(cut.buffer), mdat = top(cut).find((x) => x.type === 'mdat');
  const kept = findBoxes(cut, 'stsz').reduce((n, p) => { let m = 0; for (let i = 0; i < v.getUint32(p + 16); i++) m += v.getUint32(p + 20 + i * 4); return n + m; }, 0);
  assert.strictEqual(kept, mdat.size - 8);
});

test('no cut asked: the longer track cut to the shorter (no frozen picture under the sound)', () => {
  const d = durations(flattenMp4(fragmented));
  assert.ok(Math.abs(d[0] - d[1]) < 0.001, d.join(' / '));
});

test('how far the recorder has got, piece by piece', () => {
  // fed as the recorder hands them: ftyp + moov, then each moof + mdat
  const pieces = top(fragmented), r = mp4Reach(), starts = pieces.filter((p) => p.type === 'moof').map((p) => p.p);
  const cuts = [0, ...starts, fragmented.length], got = [];
  for (let i = 0; i + 1 < cuts.length; i++) got.push({ ...r(fragmented.subarray(cuts[i], cuts[i + 1])) });
  assert.strictEqual(got[0].vide, undefined);
  for (let i = 2; i < got.length; i++) assert.ok(got[i].vide > got[i - 1].vide);
  assert.ok(Math.abs(got[got.length - 1].vide - 2.52) < 0.05 && Math.abs(got[got.length - 1].soun - 2.52) < 0.05, JSON.stringify(got.at(-1)));
});
