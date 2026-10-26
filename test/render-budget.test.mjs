import test from 'node:test';
import assert from 'node:assert';
import { frameGap, glowSize, BACKGROUND_FRAME_MS, MAX_GLOW_SIDE } from '../src/renderer/js/render-budget.js';

test('full frame rate only when watched and drawn by the graphics card', () => {
  assert.strictEqual(frameGap({ watched: true, software: false }), 0);
  assert.strictEqual(frameGap({ watched: false, software: false }), BACKGROUND_FRAME_MS);
  assert.strictEqual(frameGap({ watched: true, software: true }), BACKGROUND_FRAME_MS); // a VM's screen: drawn by the processor
  assert.strictEqual(frameGap({ watched: false, software: true }), BACKGROUND_FRAME_MS);
  assert.strictEqual(BACKGROUND_FRAME_MS, 1000 / 30);
});

test('behind other windows with the music paused: 10 frames a second; watched, paused changes nothing', () => {
  assert.strictEqual(frameGap({ watched: false, software: false, playing: false }), 100);
  assert.strictEqual(frameGap({ watched: false, software: true, playing: false }), 100);
  assert.strictEqual(frameGap({ watched: true, software: false, playing: false }), 0);
  assert.strictEqual(frameGap({ watched: true, software: true, playing: false }), 1000 / 15); // a VM's screen, paused
  assert.strictEqual(frameGap({ watched: false, software: false, playing: true }), BACKGROUND_FRAME_MS);
});

test('the cover glow stays 48 px for the graphics card to stretch, and is stretched once to the window without one', () => {
  assert.deepStrictEqual(glowSize({ software: false, width: 1280, height: 800, dpr: 2 }), { width: 48, height: 48 });
  assert.deepStrictEqual(glowSize({ software: true, width: 1280, height: 800, dpr: 1 }), { width: 1280, height: 800 });
  assert.deepStrictEqual(glowSize({ software: true, width: 1280, height: 800, dpr: 1.5 }), { width: 1920, height: 1200 });
  const big = glowSize({ software: true, width: 1920, height: 1080, dpr: 2 }); // capped: no 16 MB background
  assert.ok(Math.max(big.width, big.height) <= MAX_GLOW_SIDE, JSON.stringify(big));
  assert.strictEqual(Math.round((big.width / big.height) * 100), Math.round((1920 / 1080) * 100));
  assert.deepStrictEqual(glowSize({ software: true, width: 0, height: 0, dpr: 1 }), { width: 48, height: 48 }); // not laid out yet
});
