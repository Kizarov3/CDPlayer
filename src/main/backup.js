'use strict';
/**
 * A backup of what's yours in CDPlayer, in one .cdbackup file: the queue and the changer, HISTORY, plays, dust, sticky
 * notes, shrink-wrap, settings, EQ presets, your music folders' list and your themes — for a new computer, or after
 * reinstalling. Not in it: sign-ins (Spotify's and Discogs' keys, the phone remote's pairing), which shouldn't travel
 * in a file that can be sent around, and caches, which come back by themselves. Your music isn't in it either.
 *
 * Restoring makes the data folder what the backup kept: a file it didn't have goes too (no notes then, none now). What
 * was there before is copied into before-restore/ first.
 */
const fs = require('fs');
const path = require('path');

const FORMAT = 'cdplayer-backup';
const FILES = [
  'queue.txt', 'changer.txt', 'changer-queue.txt', 'settings.txt', 'eq-presets.txt', 'history.txt', 'plays.txt',
  'lastplayed.txt', 'firstplayed.txt', 'dust.txt', 'notes.txt', 'dividers.txt', 'missing-hidden.txt', 'wrap.txt', 'music-folders.txt',
  'lastpath.txt', 'onboarded', 'lastversion.txt', 'mini-position.txt', 'moves-declined.txt', 'tags-before.json', 'album-runs.json', 'skipped.txt', 'streams.json', 'imports.json', 'device-sound.json',
];
const THEMES = 'themes', THEME_FILE = /^[0-9a-f]{16}\.cdtheme$/;
const BEFORE = 'before-restore';
const MAX_BYTES = 256 * 1024 * 1024;

// What a backup may hold: the files above, and themes/<hash>.cdtheme — never a path that leads anywhere else.
const allowed = (name) => FILES.includes(name) || (name.startsWith(`${THEMES}/`) && THEME_FILE.test(name.slice(THEMES.length + 1)));

function ownFiles(dir) {
  const names = FILES.filter((f) => { try { return fs.statSync(path.join(dir, f)).isFile(); } catch { return false; } });
  let themes = [];
  try { themes = fs.readdirSync(path.join(dir, THEMES)).filter((f) => THEME_FILE.test(f)).map((f) => `${THEMES}/${f}`); } catch { /* none */ }
  return [...names, ...themes];
}

/** The backup of the data folder `dir`, as the text of a .cdbackup file. */
function make(dir, { version, now = Date.now() } = {}) {
  const files = {};
  for (const name of ownFiles(dir)) files[name] = fs.readFileSync(path.join(dir, ...name.split('/'))).toString('base64');
  return JSON.stringify({ format: FORMAT, version: 1, app: version || null, made: now, files });
}

/** A .cdbackup file's text → { made, app, files: { name: Buffer } }, or null when it isn't one. */
function read(text) {
  if (typeof text !== 'string' || text.length > MAX_BYTES * 1.4) return null;
  let b;
  try { b = JSON.parse(text); } catch { return null; }
  if (!b || b.format !== FORMAT || b.version !== 1 || !b.files || typeof b.files !== 'object') return null;
  const files = {};
  for (const [name, data] of Object.entries(b.files)) {
    if (!allowed(name) || typeof data !== 'string') return null;
    files[name] = Buffer.from(data, 'base64');
  }
  return { made: Number(b.made) || null, app: typeof b.app === 'string' ? b.app : null, files };
}

const write = (target, bytes) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(`${target}.tmp`, bytes);
  fs.renameSync(`${target}.tmp`, target);
};

/** Makes `dir` what the backup (read()'s) kept; what was there goes into before-restore/ first. */
function restore(dir, backup) {
  const before = path.join(dir, BEFORE);
  fs.rmSync(before, { recursive: true, force: true });
  for (const name of ownFiles(dir)) {
    const from = path.join(dir, ...name.split('/'));
    write(path.join(before, ...name.split('/')), fs.readFileSync(from));
    if (!(name in backup.files)) fs.rmSync(from, { force: true });
  }
  for (const [name, bytes] of Object.entries(backup.files)) write(path.join(dir, ...name.split('/')), bytes);
}

// A backup made by itself once a day, into backups/ in the data folder: the newest KEEP kept, so a song history cleared,
// a restore regretted or a file broken can be undone from the day before — RESTORE… opens there.
const DAILY = 'backups', KEEP = 7, DAY = 20 * 3600e3; // (a day, give or take: CDPlayer started each morning makes one each)
const dailyDir = (dir) => path.join(dir, DAILY);
/** Makes today's backup in `dir`/backups/ if the newest there is older than a day; → its path, or null. */
function keepDaily(dir, { version, now = Date.now() } = {}) {
  if (!ownFiles(dir).length) return null;
  const to = dailyDir(dir);
  let kept = [];
  try { kept = fs.readdirSync(to).filter((f) => /^CDPlayer \d{4}-\d{2}-\d{2}\.cdbackup$/.test(f)).sort(); } catch { /* none yet */ }
  const newest = kept.length ? fs.statSync(path.join(to, kept[kept.length - 1])).mtimeMs : 0;
  if (now - newest < DAY) return null;
  const name = `CDPlayer ${new Date(now).toISOString().slice(0, 10)}.cdbackup`, target = path.join(to, name);
  write(target, make(dir, { version, now }));
  fs.utimesSync(target, now / 1000, now / 1000);
  for (const old of [...new Set([...kept, name])].sort().slice(0, -KEEP)) fs.rmSync(path.join(to, old), { force: true });
  return target;
}

module.exports = { make, read, restore, keepDaily, dailyDir, FILES };
