import test from 'node:test';
import assert from 'node:assert';

globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1 };
const { Disc } = await import('../src/renderer/js/disc.js');

test('the tray runs out on the frames, and is done when it\'s there', async () => {
  const d = new Disc({ addEventListener() {}, getContext: () => null, style: {} });
  let done = false;
  d.setTray(true).then(() => { done = true; });
  d.stepTray(300); await null;
  assert.strictEqual(done, false);
  d.stepTray(400); await null; await null;
  assert.strictEqual(d.trayT, 1);
  assert.strictEqual(done, true);
});

test('no frames to run the tray: it\'s put where it was going after a while, so E isn\'t left waiting on it for good', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const d = new Disc({ addEventListener() {}, getContext: () => null, style: {} });
  let done = false;
  d.setTray(true).then(() => { done = true; });
  t.mock.timers.tick(1000); await null;
  assert.strictEqual(done, false, 'not before twice its time');
  t.mock.timers.tick(1000); await null; await null;
  assert.strictEqual(done, true);
  assert.strictEqual(d.trayT, 1);
  assert.strictEqual(d.trayDone, null);
});
