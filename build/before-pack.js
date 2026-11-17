'use strict';
// electron-builder's beforePack: the macOS output-rate helper is built before the app is packed around it; for Linux,
// the AppStream entry (build/linux) is written out with this version and today's date, for linux.extraFiles to put
// in the AppImage's usr/share/metainfo; for Windows, the portable .exe's launcher is ours (build/win/portable.nsi: the
// app unpacked once a version, not on every start).
const fs = require('fs');
const path = require('path');
const { buildMacRate } = require('../scripts/build-mac-rate');

const METAINFO = 'com.kizarov3.cdplayer.metainfo.xml';

/** The AppStream entry with `version` and `date` (YYYY-MM-DD) in it. */
function metainfo(version, date) {
  return fs.readFileSync(path.join(__dirname, 'linux', METAINFO), 'utf8').replace(/@VERSION@/g, version).replace(/@DATE@/g, date);
}

/** electron-builder's portable launcher, which it reads from its templates with no option to give another. */
function portableTemplate() {
  const builder = path.dirname(require.resolve('app-builder-lib/package.json', { paths: [path.dirname(require.resolve('electron-builder/package.json'))] }));
  return path.join(builder, 'templates', 'nsis', 'portable.nsi');
}
function useOurPortableLauncher() {
  const ours = fs.readFileSync(path.join(__dirname, 'win', 'portable.nsi'), 'utf8'), target = portableTemplate();
  if (fs.readFileSync(target, 'utf8') !== ours) fs.writeFileSync(target, ours);
}

exports.default = async function beforePack(context) {
  if (context.electronPlatformName === 'darwin') buildMacRate();
  if (context.electronPlatformName === 'win32') useOurPortableLauncher();
  if (context.electronPlatformName === 'linux') {
    const out = path.join(__dirname, 'linux', 'generated');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, METAINFO), metainfo(context.packager.appInfo.version, new Date().toISOString().slice(0, 10)));
  }
};
exports.metainfo = metainfo;
exports.portableTemplate = portableTemplate;
