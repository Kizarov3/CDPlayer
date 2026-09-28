import test from 'node:test';
import assert from 'node:assert';
import { angleDelta, jogSeconds, coast, releaseVelocity, SLOW_SECONDS_PER_TURN, FAST_SECONDS_PER_TURN } from '../src/renderer/js/jog.js';

const TAU = Math.PI * 2;
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('the angle moved between two readings takes the short way round, across ±π', () => {
  near(angleDelta(0.1, 0.3), 0.2);
  near(angleDelta(Math.PI - 0.1, -Math.PI + 0.1), 0.2);  // clockwise over the left edge
  near(angleDelta(-Math.PI + 0.1, Math.PI - 0.1), -0.2);
});

test('turned slowly, a whole turn moves a couple of seconds; clockwise forward, anticlockwise back', () => {
  // A turn over two seconds, in 60 frames a second.
  let s = 0;
  for (let i = 0; i < 120; i++) s += jogSeconds(TAU / 120, 1000 / 60);
  near(s, SLOW_SECONDS_PER_TURN, 1e-9);
  near(jogSeconds(-TAU / 120, 1000 / 60), -SLOW_SECONDS_PER_TURN / 120);
});

test('turned fast, a turn goes further — up to half a minute', () => {
  const medium = jogSeconds(TAU / 20, 1000 / 60) * 20;  // 3 turns a second
  assert.ok(medium > 10 && medium < FAST_SECONDS_PER_TURN, `${medium}`);
  near(jogSeconds(TAU / 4, 1000 / 60) * 4, FAST_SECONDS_PER_TURN);  // 15 turns a second: capped
  assert.strictEqual(jogSeconds(0, 16), 0);
});

test('let go with a spin, the disc coasts and slows to a stop', () => {
  let v = 0.02, frames = 0; // rad/ms
  while (v && frames < 1000) { v = coast(v, 16); frames++; }
  assert.strictEqual(v, 0);
  assert.ok(frames > 10 && frames < 200, `${frames} frames`);
  assert.ok(coast(-0.02, 16) < 0 && coast(-0.02, 16) > -0.02);
});

test('the spin it is let go with: the hand\'s last moment of movement, or none if it had stopped', () => {
  const samples = [{ t: 0, a: 0 }, { t: 50, a: 0.5 }, { t: 100, a: 1.5 }, { t: 116, a: 1.82 }];
  near(releaseVelocity(samples, 120), (1.82 - 0.5) / 66);  // the last ~80 ms
  assert.strictEqual(releaseVelocity(samples, 300), 0);    // held still before letting go
  assert.strictEqual(releaseVelocity([{ t: 0, a: 0 }], 10), 0);
});
