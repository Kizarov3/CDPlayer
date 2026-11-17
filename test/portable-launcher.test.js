'use strict';
// The Windows portable .exe's launcher (build/win/portable.nsi), put in place of electron-builder's by
// build/before-pack.js: the app unpacked once a version, not on every start (it took 13–38 s each time in a VM).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { portableTemplate } = require('../build/before-pack.js');

const ours = fs.readFileSync(path.join(__dirname, '..', 'build', 'win', 'portable.nsi'), 'utf8');
const code = ours.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

test('the template it replaces is where electron-builder reads it from', () => {
  const target = portableTemplate();
  assert.ok(fs.existsSync(target), target);
  assert.match(target, /templates[\\/]nsis[\\/]portable\.nsi$/);
});

test('a version is unpacked into its own lasting folder, and only when not already unpacked to the end', () => {
  assert.match(code, /StrCpy \$INSTDIR "\$appRoot\\\$\{VERSION\}"/);
  assert.match(code, /\$LOCALAPPDATA\\\$\{PRODUCT_NAME\}\\app/);
  assert.ok(!/\$TEMP|\$PLUGINSDIR\\app"/.test(code), 'not into TEMP');
  const check = code.indexOf('${IfNot} ${FileExists} "$INSTDIR\\.unpacked"'), unpack = code.indexOf('extractEmbeddedAppPackage', check), mark = code.indexOf('FileOpen $0 "$INSTDIR\\.unpacked" w');
  assert.ok(check > 0 && unpack > check && mark > unpack, 'checked, then unpacked, then marked as done — last');
});

test('the app is started from there with what the in-app updater needs, and nothing is deleted after it quits', () => {
  assert.match(code, /PORTABLE_EXECUTABLE_FILE", "\$EXEPATH"/);
  assert.match(code, /PORTABLE_EXECUTABLE_DIR", "\$EXEDIR"/);
  assert.match(code, /ExecWait '"\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}" \$R0' \$0/); // (quoted: a user name with a space)
  const after = code.slice(code.indexOf('ExecWait'));
  assert.ok(!/RMDir/.test(after), 'its folder stays for the next start');
});

test('older versions are removed when a new one is unpacked, never the one starting', () => {
  assert.match(code, /FindFirst \$found \$entry "\$appRoot\\\*"/);
  assert.match(code, /\$\{AndIf\} \$entry != "\$\{VERSION\}"/);
});
