'use strict';
/**
 * Whether Chromium puts the window together on the processor rather than the graphics card (app.getGPUFeatureStatus):
 * in a virtual machine with no 3D (UTM's VirtIO, Hyper-V's basic display), with --disable-gpu, or after the graphics
 * process has crashed too often. The player then draws less (render-budget.js). Not known yet → as with a card.
 */
function softwareCompositing(status) {
  const c = status && status.gpu_compositing;
  return typeof c === 'string' && !c.startsWith('enabled');
}

module.exports = { softwareCompositing };
