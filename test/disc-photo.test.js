const test = require('node:test');
const assert = require('node:assert');
const { bestDiscPhoto, pickDiscPhoto, GOOD_WIDTH } = require('../src/main/disc-photo');

const after = (ms, photo) => () => new Promise((ok) => setTimeout(() => ok(photo), ms));
const failing = (ms) => () => new Promise((_, no) => setTimeout(() => no(new Error('no disc')), ms));

test('the biggest photo of those found, not the first in', async () => {
  const best = await bestDiscPhoto([{ ask: after(1, { art: 'small', width: 350 }) }, { ask: after(15, { art: 'big', width: 800 }) }, { ask: after(5, { art: 'mid', width: 500 }) }]);
  assert.strictEqual(best.art, 'big');
});

test('one big enough ends the wait', async () => {
  const start = Date.now();
  const best = await bestDiscPhoto([{ ask: after(5, { art: 'big', width: GOOD_WIDTH }) }, { ask: after(5000, { art: 'late', width: 2000 }) }]);
  assert.strictEqual(best.art, 'big');
  assert.ok(Date.now() - start < 1000);
});

test('a slow answer is not waited for long once there is a photo', async () => {
  const start = Date.now();
  const best = await bestDiscPhoto([{ ask: after(1, { art: 'small', width: 350 }) }, { ask: after(5000, { art: 'late', width: 900 }) }], { wait: 30 });
  assert.strictEqual(best.art, 'small');
  assert.ok(Date.now() - start < 1000);
});

test('a photo of two discs counts for half: it wins only when much the bigger, and never ends the wait', async () => {
  assert.strictEqual((await bestDiscPhoto([{ ask: after(1, { art: 'set', width: 1200 }), multi: true }, { ask: after(10, { art: 'one', width: 700 }) }])).art, 'one');
  assert.strictEqual((await bestDiscPhoto([{ ask: after(1, { art: 'set', width: 1200 }), multi: true }, { ask: after(10, { art: 'one', width: 350 }) }])).art, 'set');
});

test('as good as each other: the one ranked first', () => {
  assert.strictEqual(pickDiscPhoto([{ art: 'second', width: 1500, order: 1 }, { art: 'first', width: GOOD_WIDTH, order: 0 }]).art, 'first');
  assert.strictEqual(pickDiscPhoto([]), null);
});

test('those that fail are passed over; none found is null', async () => {
  assert.strictEqual((await bestDiscPhoto([{ ask: failing(1) }, { ask: after(5, { art: 'one', width: 400 }) }])).art, 'one');
  assert.strictEqual(await bestDiscPhoto([{ ask: failing(1) }, { ask: after(1, null) }]), null);
  assert.strictEqual(await bestDiscPhoto([]), null);
});
