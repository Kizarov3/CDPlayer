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
  miniPosition: 'mini-position.txt', plays: 'plays.txt', lastPlayed: 'lastplayed.txt', dust: 'dust.txt', notes: 'notes.txt', hiddenMissing: 'missing-hidden.txt', wrap: 'wrap.txt', firstPlayed: 'firstplayed.txt', shelfColors: 'shelf-colors.json',
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
// gains, waveform, mini mode, window bounds, ambient background, then Discord status, disc noise and saving found
// art & lyrics into files, the lyrics offset in ms, how the shelf is sorted, disc wear, the audio output ("id<TAB>name") and the language (AUTO, en or a locale code), then the sound quality (HIGH, LOSSLESS or HIRES), spatial audio (1/0) and its amount (0–100), the disc's shine (1/0) (CDPlayer 2 only). Missing trailing
// lines keep their defaults.
const DEFAULT_SETTINGS = {
  volume: 100, crossfade: 0, mono: false, animations: true, theme: 'RED', eq: new Array(10).fill(0),
  waveform: true, miniMode: false, bounds: null, ambient: true, discord: true, discNoise: false, saveFound: false, lyricsOffset: 0, shelfSort: 'ARTIST', discWear: true, output: null, language: 'AUTO', quality: 'HIGH', spatial: false, spatialAmount: 50, discShine: true,
};
const SHELF_SORTS = ['ARTIST', 'NEW', 'PLAYED', 'YEAR', 'COLOR', 'PRICE'];
const QUALITIES = ['HIGH', 'LOSSLESS', 'HIRES'];
const LANGUAGE = /^(AUTO|[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)$/;
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
  s.discNoise = l.length >= 12 && l[11].trim() === '1';
  s.saveFound = l.length >= 13 && l[12].trim() === '1';
  if (l.length >= 14 && l[13].trim()) s.lyricsOffset = Math.max(-500, Math.min(500, Math.round(int(l[13], 0) / 50) * 50));
  if (l.length >= 15 && SHELF_SORTS.includes(l[14].trim())) s.shelfSort = l[14].trim();
  s.discWear = l.length < 16 || l[15].trim() !== '0';
  if (l.length >= 17 && l[16].includes('\t')) { const [id, label] = l[16].split('\t'); if (id) s.output = { id, label: label || '' }; }
  const language = l.length >= 18 ? l[17].trim() : '';
  s.language = LANGUAGE.test(language) ? language : 'AUTO';
  s.quality = l.length >= 19 && QUALITIES.includes(l[18].trim()) ? l[18].trim() : 'HIGH';
  s.spatial = l.length >= 20 && l[19].trim() === '1';
  s.spatialAmount = l.length >= 21 && l[20].trim() ? Math.max(0, Math.min(100, int(l[20], 50))) : 50;
  s.discShine = l.length < 22 || l[21].trim() !== '0';
  return s;
}
function writeSettings(s) {
  const eq = s.eq.map((g) => (Number.isInteger(g) ? g.toFixed(1) : String(g))).join(',');
  const b = s.bounds ? `${s.bounds.x},${s.bounds.y},${s.bounds.width},${s.bounds.height}` : '';
  const content = [s.volume, s.crossfade, s.mono ? 1 : 0, s.animations ? 1 : 0, s.theme, eq, s.waveform ? 1 : 0,
    s.miniMode ? 1 : 0, b, s.ambient ? 1 : 0, s.discord === false ? 0 : 1, s.discNoise ? 1 : 0, s.saveFound ? 1 : 0, s.lyricsOffset || 0,
    SHELF_SORTS.includes(s.shelfSort) ? s.shelfSort : 'ARTIST', s.discWear === false ? 0 : 1,
    s.output && s.output.id ? `${s.output.id}\t${String(s.output.label || '').replace(/[\t\n]/g, ' ')}` : '',
    LANGUAGE.test(s.language || '') ? s.language : 'AUTO',
    QUALITIES.includes(s.quality) ? s.quality : 'HIGH', s.spatial ? 1 : 0,
    Math.max(0, Math.min(100, Math.round(Number.isFinite(s.spatialAmount) ? s.spatialAmount : 50))), s.discShine === false ? 0 : 1].join('\n') + '\n';
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

// plays.txt — "count<TAB>path" per line: how many times each track was played (for the booklet). CDPlayer 2 only.
const PLAYS_LIMIT = 5000;
function readPlayCounts() {
  const counts = new Map();
  for (const line of lines(readText(FILES.plays))) {
    const tab = line.indexOf('\t'), n = parseInt(line.slice(0, tab), 10), p = line.slice(tab + 1).trim();
    if (tab > 0 && n > 0 && p) counts.set(p, n);
  }
  return counts;
}
function writePlayCounts(counts) {
  const entries = [...counts].filter(([p]) => safePath(p)).slice(-PLAYS_LIMIT); // the most recently played are last
  return writeText(FILES.plays, entries.map(([p, n]) => `${n}\t${p}`).join('\n') + (entries.length ? '\n' : ''));
}

// lastplayed.txt — "ms<TAB>path" per line: when each track was last played (for dust on the shelf). CDPlayer 2 only.
function readTimes(file) {
  const times = new Map();
  for (const line of lines(readText(file))) {
    const tab = line.indexOf('\t'), t = Number(line.slice(0, tab)), p = line.slice(tab + 1).trim();
    if (tab > 0 && t > 0 && p) times.set(p, t);
  }
  return times;
}
function writeTimes(file, times) {
  const entries = [...times].filter(([p]) => safePath(p)).slice(-PLAYS_LIMIT); // the most recently played are last
  return writeText(file, entries.map(([p, t]) => `${t}\t${p}`).join('\n') + (entries.length ? '\n' : ''));
}
const readLastPlayed = () => readTimes(FILES.lastPlayed);
const writeLastPlayed = (times) => writeTimes(FILES.lastPlayed, times);
// firstplayed.txt — the same, for when each track was first played (for the booklet's "1st spin"). CDPlayer 2 only.
const readFirstPlayed = () => readTimes(FILES.firstPlayed);
const writeFirstPlayed = (times) => writeTimes(FILES.firstPlayed, times);

// dust.txt — "since <ms>": when dust started gathering on the shelf (so an update doesn't find it all dusty at once),
// then "ms<TAB>album id" (JSON: an id has line breaks in it) for each album wiped clean. CDPlayer 2 only.
function readDust() {
  const dust = { since: null, wiped: new Map() };
  for (const line of lines(readText(FILES.dust))) {
    const since = /^since (\d+)$/.exec(line.trim());
    if (since) { dust.since = Number(since[1]); continue; }
    const tab = line.indexOf('\t'), t = Number(line.slice(0, tab));
    try { const id = JSON.parse(line.slice(tab + 1)); if (tab > 0 && t > 0 && typeof id === 'string') dust.wiped.set(id, t); } catch { /* a broken line */ }
  }
  return dust;
}
function writeDust({ since, wiped }) {
  const body = [...wiped].map(([id, t]) => `${t}\t${JSON.stringify(id)}`);
  return writeText(FILES.dust, [`since ${since || Date.now()}`, ...body].join('\n') + '\n');
}

// notes.txt — "album id<TAB>note" per line, both as JSON (either can have line breaks in it): the sticky notes on
// albums on the shelf. An empty note isn't kept. CDPlayer 2 only.
function readNotes() {
  const notes = new Map();
  for (const line of lines(readText(FILES.notes))) {
    const tab = line.indexOf('\t');
    try {
      const id = JSON.parse(line.slice(0, tab)), text = JSON.parse(line.slice(tab + 1));
      if (tab > 0 && typeof id === 'string' && typeof text === 'string' && text) notes.set(id, text);
    } catch { /* a broken line */ }
  }
  return notes;
}
function writeNotes(notes) {
  const body = [...notes].filter(([, text]) => text).map(([id, text]) => `${JSON.stringify(id)}\t${JSON.stringify(text)}`);
  return writeText(FILES.notes, body.join('\n') + (body.length ? '\n' : ''));
}

// missing-hidden.txt — a MusicBrainz release-group ID per line: missing albums the user said NOT INTERESTED to, so
// they don't stand on the shelf again. CDPlayer 2 only.
const GROUP_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function readHiddenMissing() {
  return new Set(lines(readText(FILES.hiddenMissing)).map((l) => l.trim()).filter((id) => GROUP_ID.test(id)));
}
function writeHiddenMissing(ids) {
  const body = [...ids].filter((id) => GROUP_ID.test(String(id)));
  return writeText(FILES.hiddenMissing, body.join('\n') + (body.length ? '\n' : ''));
}

// wrap.txt — "since <ms>": when new albums began coming shrink-wrapped (those on the shelf before are unwrapped), then
// the IDs (JSON: an ID has line breaks in it) of albums unwrapped by hand before they were played. CDPlayer 2 only.
function readWrap() {
  const wrap = { since: null, torn: new Set() };
  for (const line of lines(readText(FILES.wrap))) {
    const since = /^since (\d+)$/.exec(line.trim());
    if (since) { wrap.since = Number(since[1]); continue; }
    try { const id = JSON.parse(line); if (typeof id === 'string') wrap.torn.add(id); } catch { /* a broken line */ }
  }
  return wrap;
}
function writeWrap({ since, torn }) {
  return writeText(FILES.wrap, [`since ${since || Date.now()}`, ...[...torn].map((id) => JSON.stringify(id))].join('\n') + '\n');
}

// shelf-colors.json — each album's colours as the shelf worked them out from its cover: { [album id]: { key (of the
// cover they came from), spine: [r, g, b], main: [r, g, b] } }, so a colour-sorted shelf stands at once. CDPlayer 2 only.
function readShelfColors() {
  try { const c = JSON.parse(readText(FILES.shelfColors) || ''); return c && c.version === 1 && c.colors ? c.colors : {}; } catch { return {}; }
}
const writeShelfColors = (colors) => writeText(FILES.shelfColors, JSON.stringify({ version: 1, colors }));

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
  readPlayCounts, writePlayCounts, readLastPlayed, writeLastPlayed, readFirstPlayed, writeFirstPlayed, readDust, writeDust, readNotes, writeNotes, readHiddenMissing, writeHiddenMissing, readWrap, writeWrap, readShelfColors, writeShelfColors,
  readEqPresets, writeEqPresets, readLastPath, writeLastPath, isOnboarded, markOnboarded, readLastVersion, writeLastVersion,
};
