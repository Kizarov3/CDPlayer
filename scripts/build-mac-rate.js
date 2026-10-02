'use strict';
// Builds src/main/mac-rate/rate.swift into build/bin/mac-rate, one binary for Apple Silicon and Intel. Only on a Mac
// (it needs Xcode's command line tools); elsewhere, and when the binary is newer than its source, it does nothing.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'src', 'main', 'mac-rate', 'rate.swift');
const out = path.join(root, 'build', 'bin', 'mac-rate');

function buildMacRate() {
  if (process.platform !== 'darwin') return null;
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(source).mtimeMs) return out;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const parts = [['arm64-apple-macos11', `${out}-arm64`], ['x86_64-apple-macos10.15', `${out}-x64`]];
  for (const [target, file] of parts) execFileSync('xcrun', ['swiftc', '-O', '-target', target, '-o', file, source], { stdio: 'inherit' });
  execFileSync('lipo', ['-create', '-output', out, ...parts.map(([, file]) => file)], { stdio: 'inherit' });
  for (const [, file] of parts) fs.rmSync(file, { force: true });
  return out;
}

module.exports = { buildMacRate };
if (require.main === module) buildMacRate();
