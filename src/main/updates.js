'use strict';
/**
 * Updates from inside the app. Every check asks GitHub for the latest published release and compares it with the
 * running version — nothing is remembered between checks, so the pill always names the newest release there is right
 * now (the renderer asks at launch and every 15 minutes). When GitHub can't be reached the result says so, and the
 * pill stays as it was.
 *
 * Clicking the pill downloads this system's file from that release (the .dmg, the portable .exe or the .AppImage);
 * clicking it again quits, and a small script swaps the new app in for this one once it has exited and opens it.
 * electron-updater can't do this here — Squirrel.Mac wants a Developer ID signature (ours is ad hoc) and it has
 * nothing for a portable .exe. Where the app can't be replaced in place (run from the disk image, from a folder it
 * can't write to, or not as an AppImage), the download is saved to Downloads and opened or shown instead.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { httpFetch } = require('./http');
const LATEST_RELEASE_API = 'https://api.github.com/repos/Kizarov3/CDPlayer/releases/latest';
const RELEASES_PAGE = 'https://github.com/Kizarov3/CDPlayer/releases/latest';
const TIMEOUT_MS = 8000;
const STALL_MS = 60000; // a download that's had nothing for this long is given up (the connection's gone)
// The release's file for each system, by the end of its name (package.json → build → artifactName).
const ASSET_SUFFIX = { darwin: '-mac.dmg', win32: '-windows.exe', linux: '-linux.AppImage' };

function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? m.slice(1).map(Number) : null;
}
function isNewer(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

// This system's download in a release's assets: { name, url, size, sha256 } or null.
function pickAsset(assets, platform = process.platform) {
  const suffix = ASSET_SUFFIX[platform];
  const a = suffix && (assets || []).find((x) => x && typeof x.name === 'string' && x.name.endsWith(suffix) && x.browser_download_url);
  if (!a) return null;
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(a.digest || '');
  return { name: a.name, url: a.browser_download_url, size: Number(a.size) || 0, sha256: digest ? digest[1].toLowerCase() : null };
}

// → { version, asset } for the latest release, or null when there's none worth announcing.
async function fetchLatestRelease(currentVersion) {
  const res = await httpFetch(LATEST_RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `CDPlayer/${currentVersion}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return null; // no releases published at all
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  // A release whose downloads aren't attached yet (CI still building) isn't worth announcing.
  if (json.draft || json.prerelease || !Array.isArray(json.assets) || !json.assets.length) return null;
  if (!parseVersion(json.tag_name)) return null;
  return { version: json.tag_name.trim().replace(/^v/, ''), asset: pickAsset(json.assets) };
}

// → { version, asset } when a newer release than currentVersion is out (asset null when it has no file for this
//   system), null when currentVersion is the newest, and { offline: true } when GitHub couldn't be reached.
async function checkForUpdate(currentVersion, { fetchLatest = fetchLatestRelease } = {}) {
  let latest;
  try {
    latest = await fetchLatest(currentVersion);
  } catch {
    return { offline: true };
  }
  return latest && isNewer(latest.version, currentVersion) ? { version: latest.version, asset: latest.asset || null } : null;
}

/**
 * How this copy of the app gets replaced: { kind: 'replace', target } — the .app bundle, portable .exe or .AppImage
 * the new one is put in place of — or { kind: 'open' } when it can't be (the download is opened or shown instead).
 */
function installPlan({ platform = process.platform, execPath = process.execPath, env = process.env, canWrite = writable } = {}) {
  let target = null;
  if (platform === 'darwin') {
    const m = /^(.+?\.app)\/Contents\/MacOS\//.exec(execPath);
    // Still on the disk image, or translocated by Gatekeeper (opened where it was downloaded): read-only either way.
    if (m && !m[1].startsWith('/Volumes/') && !m[1].includes('/AppTranslocation/')) target = m[1];
  } else if (platform === 'win32') {
    target = env.PORTABLE_EXECUTABLE_FILE || null; // set by the portable .exe's launcher; absent in win-unpacked
  } else if (platform === 'linux') {
    target = env.APPIMAGE || null; // set by the AppImage runtime; absent for a packaged (AUR) install
  }
  if (target && canWrite(path.dirname(target)) && canWrite(target)) return { kind: 'replace', target };
  return { kind: 'open' };
}
// Whether a file or folder can be written. A folder is tried for real — a file made and removed in it — as on Windows
// the access check only looks at the read-only flag, not the folder's permissions (C:\Program Files says yes).
function writable(p) {
  try {
    if (fs.statSync(p).isDirectory()) {
      const probe = path.join(p, `.cdplayer-write-test-${process.pid}`);
      fs.writeFileSync(probe, '');
      fs.rmSync(probe, { force: true });
      return true;
    }
    fs.accessSync(p, fs.constants.W_OK);
    return true;
  } catch { return false; }
}

/**
 * Downloads `asset` into `dir` as its own name, checking its size and (when GitHub gave one) its SHA-256.
 * onProgress(fraction) as it comes in. → the file's path. A part-done or bad file is removed.
 */
async function downloadAsset(asset, dir, onProgress = () => {}, { fetchImpl = httpFetch, stallMs = STALL_MS } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, asset.name);
  const part = `${file}.part`;
  // Given up when nothing arrives for stallMs — while connecting or mid-way (Wi-Fi gone, the Mac asleep) — rather than
  // hanging at "DOWNLOADING n%" for good.
  const abort = new AbortController();
  let stall = null;
  const quiet = () => { clearTimeout(stall); stall = setTimeout(() => abort.abort(new Error('the download stalled')), stallMs); };
  quiet();
  try {
    const res = await fetchImpl(asset.url, { headers: { 'User-Agent': 'CDPlayer' }, signal: abort.signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = asset.size || Number(res.headers.get('content-length')) || 0;
    const hash = crypto.createHash('sha256');
    let got = 0, lastReport = 0;
    const count = new Transform({
      transform(chunk, _enc, done) {
        quiet();
        got += chunk.length;
        hash.update(chunk);
        const now = Date.now();
        if (total && now - lastReport > 250) { lastReport = now; onProgress(Math.min(1, got / total)); }
        done(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body), count, fs.createWriteStream(part), { signal: abort.signal });
    if (asset.size && got !== asset.size) throw new Error(`got ${got} of ${asset.size} bytes`);
    if (asset.sha256 && hash.digest('hex') !== asset.sha256) throw new Error('checksum mismatch');
    fs.renameSync(part, file);
    onProgress(1);
    return file;
  } catch (e) {
    fs.rmSync(part, { force: true });
    throw abort.signal.aborted ? abort.signal.reason : e;
  } finally {
    clearTimeout(stall);
  }
}

// Single-quoted for sh / PowerShell.
const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * The script that, once process `pid` has exited, puts `file` (the download) in place of `target` and opens it.
 * If the swap fails, the old app is opened again and the download shown, so nothing is lost.
 * → { name, text } — the file name to write it as, and its contents.
 */
function installScript(platform, { pid, file, target }) {
  if (platform === 'darwin') {
    const T = shQuote(target), F = shQuote(file);
    return { name: 'install.sh', text: `#!/bin/sh
# CDPlayer's updater: wait for the old app to quit, copy the new one off the disk image in its place, open it.
while kill -0 ${pid} 2>/dev/null; do sleep 0.3; done
mnt=$(mktemp -d /tmp/cdplayer-update.XXXXXX)
fail() { hdiutil detach -quiet "$mnt" 2>/dev/null; rmdir "$mnt" 2>/dev/null; rm -rf ${shQuote(`${target}.new`)}; open ${T}; open -R ${F}; rm -f "$0"; exit 1; }
hdiutil attach -nobrowse -readonly -noautoopen -mountpoint "$mnt" ${F} >/dev/null 2>&1 ||
  diskutil image attach --mountOptions nobrowse --readOnly --mountPoint "$mnt" ${F} >/dev/null 2>&1 || fail
app=$(find "$mnt" -maxdepth 1 -name '*.app' | head -n 1)
[ -n "$app" ] || fail
rm -rf ${shQuote(`${target}.new`)}
ditto "$app" ${shQuote(`${target}.new`)} || fail
hdiutil detach -quiet "$mnt"; rmdir "$mnt" 2>/dev/null
rm -rf ${shQuote(`${target}.old`)}
mv ${T} ${shQuote(`${target}.old`)} || fail
if mv ${shQuote(`${target}.new`)} ${T}; then rm -rf ${shQuote(`${target}.old`)}; else mv ${shQuote(`${target}.old`)} ${T}; fail; fi
xattr -dr com.apple.quarantine ${T} 2>/dev/null
rm -f ${F}
open ${T}
rm -f "$0"
` };
  }
  if (platform === 'win32') {
    const T = psQuote(target), F = psQuote(file);
    return { name: 'install.ps1', text: `# CDPlayer's updater: wait for the old app to quit, copy the new .exe over it, start it.
try { Wait-Process -Id ${pid} -Timeout 60 -ErrorAction Stop } catch {}
# The portable launcher holds its .exe until it has cleaned up after the app, so keep trying for a while.
$deadline = (Get-Date).AddSeconds(60)
while ($true) {
  try { Copy-Item -LiteralPath ${F} -Destination ${T} -Force -ErrorAction Stop; break }
  catch {
    if ((Get-Date) -gt $deadline) { Start-Process -FilePath ${T}; Start-Process explorer.exe -ArgumentList ('/select,"' + ${F} + '"'); Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue; exit 1 }
    Start-Sleep -Milliseconds 500
  }
}
Remove-Item -LiteralPath ${F} -Force -ErrorAction SilentlyContinue
Start-Process -FilePath ${T}
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
` };
  }
  const T = shQuote(target), F = shQuote(file);
  return { name: 'install.sh', text: `#!/bin/sh
# CDPlayer's updater: wait for the old app to quit, put the new AppImage in its place, start it.
while kill -0 ${pid} 2>/dev/null; do sleep 0.3; done
chmod +x ${F}
if cp -f ${F} ${shQuote(`${target}.new`)} && mv -f ${shQuote(`${target}.new`)} ${T}; then rm -f ${F}; else rm -f ${shQuote(`${target}.new`)}; fi
nohup ${T} >/dev/null 2>&1 &
rm -f "$0"
` };
}

/**
 * The PowerShell command that has Windows itself (WMI's Win32_Process.Create) start `commandLine`, with no window,
 * and exits with Create's result (0 = started). A process CDPlayer starts the ordinary way is closed along with it,
 * `detached` or not (it shares CDPlayer's job), so the installer would die the moment CDPlayer quits; one WMI starts
 * belongs to nobody and outlives it.
 */
function wmiStartCommand(commandLine) {
  return [
    "$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }",
    `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psQuote(commandLine)}; ProcessStartupInformation = $si }`,
    'exit [int]$r.ReturnValue',
  ].join('; ');
}

/**
 * Writes installScript's script next to the download and starts it so that it outlives this process. → a Promise
 * that settles once it's started — CDPlayer should quit only then. Windows: by WMI (see wmiStartCommand), or, if that
 * fails, the ordinary way; elsewhere a detached process outlives its parent anyway.
 */
function startInstaller(platform, { pid, file, target }, { run = execFile, start = spawn } = {}) {
  const { name, text } = installScript(platform, { pid, file, target });
  const script = path.join(path.dirname(file), name);
  fs.writeFileSync(script, text, { mode: 0o755 });
  if (platform !== 'win32') {
    start('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref();
    return Promise.resolve();
  }
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script];
  const commandLine = ['powershell.exe', ...args].map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(' ');
  return new Promise((resolve) => {
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', wmiStartCommand(commandLine)], { windowsHide: true, timeout: 20000 }, (e) => {
      if (e) start('powershell.exe', args, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); // better than nothing
      resolve();
    });
  });
}

// Where a download goes: a temporary folder when it's swapped in and removed, Downloads when the person opens it.
const downloadDir = (plan, downloadsDir) => (plan.kind === 'replace' ? path.join(os.tmpdir(), 'cdplayer-update') : downloadsDir);

module.exports = { checkForUpdate, isNewer, pickAsset, installPlan, writable, downloadAsset, installScript, startInstaller, wmiStartCommand, downloadDir, RELEASES_PAGE };
