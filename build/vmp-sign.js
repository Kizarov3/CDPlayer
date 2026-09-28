'use strict';
// electron-builder afterPack: VMP-signs the packaged app with castLabs EVS, which Spotify's Widevine licence requires.
// It runs before Apple's code signature, the order castLabs requires. macOS and Windows only — Linux has no VMP.
// No EVS login (a fork's pull request has no secrets) → the build carries on unsigned and just can't play Spotify.
const { execFileSync } = require('child_process');

const python = process.platform === 'win32' ? 'python' : 'python3';

exports.default = async function vmpSign(context) {
  const platform = context.electronPlatformName;
  if (platform !== 'darwin' && platform !== 'win32') return;
  // A universal Mac build packs x64 and arm64 separately, then merges them: sign only the merged app.
  if (platform === 'darwin' && /-(x64|arm64)-temp$/.test(context.appOutDir)) return;
  if (!process.env.EVS_ACCOUNT_NAME && !process.env.CDPLAYER_VMP_LOCAL) {
    console.log('  • VMP signing skipped (no EVS_ACCOUNT_NAME) — this build cannot play Spotify');
    return;
  }
  execFileSync(python, ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir], { stdio: 'inherit' });
  execFileSync(python, ['-m', 'castlabs_evs.vmp', 'verify-pkg', context.appOutDir], { stdio: 'inherit' });
};
