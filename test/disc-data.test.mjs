import test from 'node:test';
import assert from 'node:assert';
import { discLayout, radiusAt, trackAt, R0, R1, CD_SECONDS } from '../src/renderer/js/disc-data.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('tracks are written from the middle out, each ring taking room in proportion to its length', () => {
  const layout = discLayout([240, 480, 120]);
  const [a, b, c] = layout.tracks;
  close(a.r0, R0);
  assert.ok(a.r0 < a.r1 && a.r1 === b.r0 && b.r1 === c.r0, 'one after another');
  close((b.r1 ** 2 - b.r0 ** 2) / (a.r1 ** 2 - a.r0 ** 2), 2); // twice as long, twice the area
  close((c.r1 ** 2 - c.r0 ** 2) / (a.r1 ** 2 - a.r0 ** 2), 0.5);
  assert.ok(layout.end < R1, 'a short disc leaves its edge unwritten');
});

test('a full 74 minutes reaches the edge; a longer disc is squeezed to fit', () => {
  close(discLayout([CD_SECONDS]).end, R1);
  close(discLayout([CD_SECONDS, 600]).end, R1);
});

test('where the laser is: at a track\'s start, its ring\'s inner edge', () => {
  const layout = discLayout([240, 480, 120]);
  close(radiusAt(layout, 0), R0);
  close(radiusAt(layout, 240), layout.tracks[1].r0);
  close(radiusAt(layout, 99999), layout.end);
  close(radiusAt(layout, -5), R0);
});

test('which track is under the pointer: by its ring; none on the hub or the unwritten edge', () => {
  const layout = discLayout([240, 480, 120]);
  const mid = (t) => (t.r0 + t.r1) / 2;
  assert.strictEqual(trackAt(layout, mid(layout.tracks[0])), 0);
  assert.strictEqual(trackAt(layout, mid(layout.tracks[1])), 1);
  assert.strictEqual(trackAt(layout, layout.tracks[2].r0), 2);
  assert.strictEqual(trackAt(layout, R0 - 0.05), -1);
  assert.strictEqual(trackAt(layout, (layout.end + R1) / 2), -1);
  assert.strictEqual(trackAt(discLayout([]), 0.6), -1);
});
