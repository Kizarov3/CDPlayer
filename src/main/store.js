'use strict';
/**
 * Persistent state, stored in exactly the same place and line-based formats as the original Java CDPlayer
 * (~/.cdplayer on macOS/Linux, %LOCALAPPDATA%\CDPlayer on Windows) so an existing queue, history, settings, EQ
 * presets and Spotify sign-in carry straight over. CDPLAYER_HOME overrides the location (used by tests so they
 * never touch a real user's state).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { entryExists } = require('./cue');

let resolvedDir = null;
function dataDir() {
  if (process.env.CDPLAYER_HOME) return process.env.CDPLAYER_HOME;
  if (resolvedDir) return resolvedDir;
  const unixStyle = path.join(os.homedir(), '.cdplayer');
  if (process.platform === 'win32') {
    // The Windows-only Java fork kept its data in %LOCALAPPDATA%\CDPlayer, while the cross-platform Java build used
    // ~\.cdplayer on Windows too — pick up whichever one this user already has.
    const local = path.join(process.env.LOCALAPPDATA || os.homedir(), 'CDPlayer');
    resolvedDir = !fs.existsSync(local) && fs.existsSync(unixStyle) ? unixStyle : local;
  } else {
    resolvedDir = unixStyle;
  }
  return resolvedDir;
}

const file = (name) => path.join(dataDir(), name);
const FILES = {
  queue: 'queue.txt', onboarded: 'onboarded', lastVersion: 'lastversion.txt', lastPath: 'lastpath.txt',
  settings: 'settings.txt', eqPresets: 'eq-presets.txt', history: 'history.txt', spotify: 'spotify.txt',
  miniPosition: 'mini-position.txt',
};

function readText(name) {
  try { return fs.readFileSync(file(name), 'utf8'); } catch { return null; }
}
function writeText(name, content) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    // Write-then-rename so a crash mid-write can never leave a half-written state file behind.
    const target = file(name), tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, target);
    return true;
  } catch { return false; }
}
// Same semantics as Java's Files.readAllLines: a final line terminator doesn't start another (empty) line.
const lines = (text) => {
  if (text == null || text === '') return [];
  const l = text.split(/\r?\n/);
  if (l[l.length - 1] === '') l.pop();
  return l;
};
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const safePath = (p) => typeof p === 'string' && !/[\r\n]/.test(p);

// settings.txt — one value per line, in the Java app's order: volume, crossfade, mono, animations, theme, EQ
// gains, waveform, mini mode, window bounds, ambient background, then Discord status (CDPlayer 2 only). Missing
// trailing lines keep their defaults.
const DEFAULT_SETTINGS = {
  volume: 100, crossfade: 0, mono: false, animations: true, theme: 'RED', eq: new Array(10).fill(0),
  waveform: true, miniMode: false, bounds: null, ambient: true, discord: true,
};
function readSettings() {
  const l = lines(readText(FILES.settings));
  const s = { ...DEFAULT_SETTINGS, eq: DEFAULT_SETTINGS.eq.slice() };
  if (l.length < 3) return s;
  const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
  s.volume = Math.max(0, Math.min(100, int(l[0], 100)));
  s.crossfade = Math.max(0, Math.min(15, int(l[1], 0)));
  s.mono = l[2].trim() === '1';
  s.animations = l.length < 4 || l[3].trim() === '1';
  if (l.length >= 5 && l[4].trim()) s.theme = l[4].trim();
  if (l.length >= 6 && l[5].trim()) {
    const parts = l[5].split(',').map(Number);
    if (parts.length === 10 && parts.every(Number.isFinite)) s.eq = parts;
  }
  s.waveform = l.length < 7 || l[6].trim() === '1';
  s.miniMode = l.length >= 8 && l[7].trim() === '1';
  if (l.length >= 9 && l[8].trim()) {
    const b = l[8].split(',').map((v) => parseInt(v, 10));
    if (b.length === 4 && b.every(Number.isFinite)) s.bounds = { x: b[0], y: b[1], width: b[2], height: b[3] };
  }
  s.ambient = l.length < 10 || l[9].trim() === '1';
  s.discord = l.length < 11 || l[10].trim() === '1';
  return s;
}
function writeSettings(s) {
  const eq = s.eq.map((g) => (Number.isInteger(g) ? g.toFixed(1) : String(g))).join(',');
  const b = s.bounds ? `${s.bounds.x},${s.bounds.y},${s.bounds.width},${s.bounds.height}` : '';
  const content = [s.volume, s.crossfade, s.mono ? 1 : 0, s.animations ? 1 : 0, s.theme, eq, s.waveform ? 1 : 0,
    s.miniMode ? 1 : 0, b, s.ambient ? 1 : 0, s.discord === false ? 0 : 1].join('\n') + '\n';
  return writeText(FILES.settings, content);
}

// queue.txt — "index,positionMicros" then one absolute path per line (a cue sheet track is "<.cue path>#<number>"). Missing files are dropped on restore,
// remapping the saved index so it still points at the same track.
function readQueue() {
  const l = lines(readText(FILES.queue));
  if (!l.length || !l[0].trim()) return null;
  const [idx, pos] = l[0].trim().split(',');
  const savedIndex = parseInt(idx, 10), savedPosition = parseInt(pos, 10) || 0;
  const paths = [];
  let mapped = -1;
  for (let i = 1; i < l.length; i++) {
    const p = l[i].trim();
    if (!p) continue;
    if (entryExists(p)) { if (i - 1 === savedIndex) mapped = paths.length; paths.push(p); }
  }
  if (!paths.length) return null;
  const index = mapped >= 0 ? mapped : Math.max(0, Math.min(Number.isFinite(savedIndex) ? savedIndex : 0, paths.length - 1));
  return { paths, index, positionMicros: savedPosition };
}
function writeQueue({ paths, index, positionMicros }) {
  const body = paths.filter(safePath).join('\n');
  return writeText(FILES.queue, `${index},${Math.max(0, Math.round(positionMicros || 0))}\n${body}${body ? '\n' : ''}`);
}

const HISTORY_LIMIT = 50;
function readHistory() {
  return lines(readText(FILES.history)).map((p) => p.trim()).filter((p) => p && entryExists(p)).slice(0, HISTORY_LIMIT);
}
function writeHistory(paths) {
  const body = paths.filter(safePath).slice(0, HISTORY_LIMIT).join('\n');
  return writeText(FILES.history, body ? `${body}\n` : '');
}

function readEqPresets() {
  const out = [];
  for (const line of lines(readText(FILES.eqPresets))) {
    const bar = line.lastIndexOf('|');
    if (bar < 1) continue;
    const name = line.slice(0, bar).trim();
    const gains = line.slice(bar + 1).split(',').map(Number);
    if (name && gains.length === 10 && gains.every(Number.isFinite)) out.push({ name, gains });
  }
  return out;
}
function writeEqPresets(presets) {
  return writeText(FILES.eqPresets, presets.map((p) => `${p.name}|${p.gains.join(',')}`).join('\n') + (presets.length ? '\n' : ''));
}

function readLastPath() {
  const t = readText(FILES.lastPath);
  const p = t && t.trim();
  return p || null;
}
function writeLastPath(dir) { if (dir && safePath(dir)) writeText(FILES.lastPath, dir); }

const isOnboarded = () => isFile(file(FILES.onboarded));
const markOnboarded = () => writeText(FILES.onboarded, '');
const readLastVersion = () => { const t = readText(FILES.lastVersion); return t && t.trim() ? t.trim() : null; };
const writeLastVersion = (v) => writeText(FILES.lastVersion, v);

module.exports = {
  dataDir, file, FILES, readText, writeText, isFile, isDir,
  readSettings, writeSettings, DEFAULT_SETTINGS, readQueue, writeQueue, readHistory, writeHistory, HISTORY_LIMIT,
  readEqPresets, writeEqPresets, readLastPath, writeLastPath, isOnboarded, markOnboarded, readLastVersion, writeLastVersion,
};
