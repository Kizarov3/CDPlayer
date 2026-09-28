'use strict';
// electron-builder afterSign: the Windows half of build/vmp-sign.js.
const { vmpSign } = require('./vmp-sign');

exports.default = (context) => vmpSign(context, { hook: 'afterSign' });
