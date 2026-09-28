import test from 'node:test';
import assert from 'node:assert';
import { dustLevel, pickOne, Wiper, DUST_FROM_DAYS, DUST_FULL_DAYS } from '../src/renderer/js/shelf-dust.js';

const DAY = 86400000, now = Date.UTC(2026, 8, 28);

test(`clean for ${DUST_FROM_DAYS} days, then dustier up to ${DUST_FULL_DAYS} days, and no dustier after`, () => {
  assert.strictEqual(dustLevel(now, now), 0);
  assert.strictEqual(dustLevel(now - (DUST_FROM_DAYS - 1) * DAY, now), 0);
  const mid = dustLevel(now - ((DUST_FROM_DAYS + DUST_FULL_DAYS) / 2) * DAY, now);
  assert.ok(mid > 0.3 && mid < 0.7, `${mid}`);
  assert.strictEqual(dustLevel(now - DUST_FULL_DAYS * DAY, now), 1);
  assert.strictEqual(dustLevel(now - 1000 * DAY, now), 1);
  assert.strictEqual(dustLevel(null, now), 0); // nothing known: clean
});

test('PULL ONE favours the dusty albums, but any can come out', () => {
  const albums = [{ id: 'fresh', touched: now }, { id: 'dusty', touched: now - 400 * DAY }];
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const picks = { fresh: 0, dusty: 0 };
  for (let i = 0; i < 2000; i++) picks[pickOne(albums, now, rnd).id]++;
  assert.ok(picks.dusty > picks.fresh * 5, JSON.stringify(picks));
  assert.ok(picks.fresh > 0, JSON.stringify(picks));
  assert.strictEqual(pickOne([], now, rnd), null);
  assert.strictEqual(pickOne([albums[0]], now, rnd).id, 'fresh');
});

test('a wipe is the mouse going back and forth over a spine, not just passing by', () => {
  const w = new Wiper();
  let strokes = 0;
  const move = (x, t) => { strokes += w.move(x, t); };
  for (let x = 0; x <= 30; x += 5) move(x, x); // across once, one way
  assert.strictEqual(strokes, 0);
  let t = 40;
  for (const x of [20, 8, 0, 12, 26, 14, 2]) move(x, (t += 20)); // back, forth, back
  assert.strictEqual(strokes, 3);
});

test('jitter of a pixel or two, or a slow drift back later, is not a wipe', () => {
  const w = new Wiper();
  let strokes = 0;
  for (const [x, t] of [[10, 0], [11, 10], [10, 20], [11, 30], [10, 40]]) strokes += w.move(x, t);
  assert.strictEqual(strokes, 0);
  const slow = new Wiper();
  strokes = 0;
  for (const [x, t] of [[0, 0], [20, 50], [0, 3000]]) strokes += slow.move(x, t);
  assert.strictEqual(strokes, 0);
});
