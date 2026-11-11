'use strict';
// electron-builder's beforePack: the macOS output-rate helper is built before the app is packed around it; for Linux,
// the AppStream entry (build/linux) is written out with this version and today's date, for linux.extraFiles to put
// in the AppImage's usr/share/metainfo.
const fs = require('fs');
const path = require('path');
const { buildMacRate } = require('../scripts/build-mac-rate');

const METAINFO = 'com.kizarov3.cdplayer.metainfo.xml';

/** The AppStream entry with `version` and `date` (YYYY-MM-DD) in it. */
function metainfo(version, date) {
  return fs.readFileSync(path.join(__dirname, 'linux', METAINFO), 'utf8').replace(/@VERSION@/g, version).replace(/@DATE@/g, date);
}

exports.default = async function beforePack(context) {
  if (context.electronPlatformName === 'darwin') buildMacRate();
  if (context.electronPlatformName === 'linux') {
    const out = path.join(__dirname, 'linux', 'generated');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, METAINFO), metainfo(context.packager.appInfo.version, new Date().toISOString().slice(0, 10)));
  }
};
exports.metainfo = metainfo;
