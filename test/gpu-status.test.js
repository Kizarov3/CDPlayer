'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { softwareCompositing } = require('../src/main/gpu-status');

test('the window is put together by the processor when Chromium says compositing is software or unavailable', () => {
  assert.strictEqual(softwareCompositing({ gpu_compositing: 'enabled' }), false);
  assert.strictEqual(softwareCompositing({ gpu_compositing: 'enabled_on' }), false);
  assert.strictEqual(softwareCompositing({ gpu_compositing: 'disabled_software' }), true); // --disable-gpu, a VM's screen
  assert.strictEqual(softwareCompositing({ gpu_compositing: 'unavailable_software' }), true);
  assert.strictEqual(softwareCompositing({ gpu_compositing: 'disabled_off' }), true);
  assert.strictEqual(softwareCompositing({}), false); // not known yet: as with a graphics card
  assert.strictEqual(softwareCompositing(null), false);
});
