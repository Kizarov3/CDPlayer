'use strict';
// VMP-signs the packaged app with castLabs EVS, which Spotify's Widevine licence requires. macOS and Windows only —
// Linux has no VMP. Each system at its own step of electron-builder, so nothing changes the files after signing:
//   macOS: afterPack, before Apple's code signature (the order castLabs requires);
//   Windows: afterSign, because electron-builder writes the icon and version into the exe after afterPack.
// No EVS login (a fork's pull request has no secrets) → the build carries on unsigned and just can't play Spotify.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const python = process.platform === 'win32' ? 'python' : 'python3';
const STEP = { darwin: 'afterPack', win32: 'afterSign' };

/** Every castLabs .sig file under `dir` (the VMP signatures, one per signed binary). */
function sigFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  let found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) found = found.concat(sigFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.sig')) found.push(full);
  }
  return found;
}

async function vmpSign(context, { hook, env = process.env, exec = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' }) }) {
  const platform = context.electronPlatformName;
  if (STEP[platform] !== hook) return;
  // A universal Mac build packs x64 and arm64 separately, then merges them: sign only the merged app. castLabs ships
  // each architecture with its own .sig files, which differ, and the merge refuses differing files — so they go here,
  // and the merged app is signed afresh.
  if (platform === 'darwin' && /-(x64|arm64)-temp$/.test(context.appOutDir)) {
    for (const sig of sigFiles(context.appOutDir)) fs.unlinkSync(sig);
    return;
  }
  if (!env.EVS_ACCOUNT_NAME && !env.CDPLAYER_VMP_LOCAL) {
    console.log('  • VMP signing skipped (no EVS_ACCOUNT_NAME) — this build cannot play Spotify');
    return;
  }
  exec(python, ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir]);
  exec(python, ['-m', 'castlabs_evs.vmp', 'verify-pkg', context.appOutDir]);
}

exports.vmpSign = vmpSign;
exports.default = (context) => vmpSign(context, { hook: 'afterPack' });
