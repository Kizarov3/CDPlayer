'use strict';
// electron-builder's beforePack: the macOS output-rate helper is built before the app is packed around it.
const { buildMacRate } = require('../scripts/build-mac-rate');

exports.default = async function beforePack(context) {
  if (context.electronPlatformName === 'darwin') buildMacRate();
};
