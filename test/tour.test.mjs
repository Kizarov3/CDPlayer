import test from 'node:test';
import assert from 'node:assert';
import { placeBubble, unionRect } from '../src/renderer/js/tour.js';

const view = { width: 1600, height: 900 };
const bubble = { width: 320, height: 160 };
const inside = (b) => b.x >= 12 && b.y >= 12 && b.x + bubble.width <= view.width - 12 && b.y + bubble.height <= view.height - 12;

test('the bubble goes where there\'s room, beside what it points at, and never off the window', () => {
  const top = placeBubble({ left: 1400, top: 20, right: 1500, bottom: 50 }, bubble, view); // a header button
  assert.strictEqual(top.side, 'below');
  assert.ok(inside(top) && top.y > 50);
  const low = placeBubble({ left: 600, top: 840, right: 1000, bottom: 880 }, bubble, view); // the hint line
  assert.strictEqual(low.side, 'above');
  assert.ok(inside(low) && low.y + bubble.height < 840);
  const tall = placeBubble({ left: 200, top: 100, right: 700, bottom: 800 }, bubble, view); // the disc
  assert.strictEqual(tall.side, 'right');
  assert.ok(inside(tall) && tall.x > 700);
  assert.ok(tall.arrow >= 16 && tall.arrow <= bubble.height - 16, 'the arrow points into the bubble');
});

test('one spotlight round several elements (LYRICS, KARAOKE and TAGS together)', () => {
  assert.deepStrictEqual(unionRect([{ left: 10, top: 20, right: 50, bottom: 40 }, { left: 60, top: 18, right: 90, bottom: 44 }]), { left: 10, top: 18, right: 90, bottom: 44, width: 80, height: 26 });
  assert.strictEqual(unionRect([]), null);
});
