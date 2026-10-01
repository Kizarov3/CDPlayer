'use strict';
/**
 * Themes people make (Settings → THEME → + NEW THEME): six colors, a scene and maybe a background image. Each is kept
 * as one file in the data folder's themes/, in the same .cdtheme format it's shared in — or, without its image, as a
 * short "cdtheme:…" code to paste in a chat. Nothing read from a file or a code is used before parseTheme has checked it.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');

const BUILTIN = ['RED', 'BLUE', 'SUNSET', 'FOREST', 'GALAXY', 'OCEAN', 'MATRIX', 'AUTUMN', 'SNOW', 'AUTO'];
const SCENES = ['BARS', 'SNOW', 'GALAXY', 'OCEAN', 'MATRIX', 'AUTUMN'];
const COLOR_KEYS = ['bg', 'card', 'accent', 'accent2', 'text', 'muted'];
const MAX_IMAGE = 1.5 * 1024 * 1024;
const IMAGE_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
const clamp = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);

function cleanName(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim().toUpperCase().slice(0, 16).trim();
  return n && !/[\\/:*?"<>|\u0000-\u001f\u007f]/.test(n) ? n : null;
}

/** A theme as read from a file or a code → the theme, cleaned up, or null if it isn't one. */
function parseTheme(json) {
  if (!json || typeof json !== 'object' || json.cdtheme !== 1) return null;
  const name = cleanName(json.name);
  if (!name || !json.colors || typeof json.colors !== 'object') return null;
  const colors = {};
  for (const k of COLOR_KEYS) {
    const c = json.colors[k];
    if (!Array.isArray(c) || c.length !== 3 || !c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) return null;
    colors[k] = [...c];
  }
  const scene = json.scene == null ? 'BARS' : json.scene;
  if (!SCENES.includes(scene)) return null;
  const image = json.image == null ? null : json.image;
  if (image !== null && (typeof image !== 'string' || image.length > MAX_IMAGE || !IMAGE_URL.test(image))) return null;
  return { cdtheme: 1, name, colors, scene, image, blur: clamp(json.blur, 0, 40, 0), dim: clamp(json.dim, 0, 90, 30) };
}

/** `name`, or "NAME 2", "NAME 3"… if a built-in theme or one of `taken` already has it (still 16 characters at most). */
function uniqueName(name, taken) {
  const used = new Set([...BUILTIN, ...taken]);
  if (!used.has(name)) return name;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`, candidate = `${name.slice(0, 16 - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

// The code: version, scene, the 18 color values and the name, as bytes in base64url — about 50 characters.
const CODE_PREFIX = 'cdtheme:';
function encodeCode(theme) {
  const t = parseTheme(theme);
  if (!t || t.image) return null;
  const bytes = Buffer.concat([Buffer.from([1, SCENES.indexOf(t.scene)]), Buffer.from(COLOR_KEYS.flatMap((k) => t.colors[k])), Buffer.from(t.name, 'utf8')]);
  return CODE_PREFIX + bytes.toString('base64url');
}
function decodeCode(text) {
  if (typeof text !== 'string') return null;
  const s = text.replace(/\s+/g, '');
  if (!s.toLowerCase().startsWith(CODE_PREFIX)) return null;
  const body = s.slice(CODE_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return null;
  const b = Buffer.from(body, 'base64url');
  if (b.length < 21 || b[0] !== 1 || b[1] >= SCENES.length) return null;
  const colors = Object.fromEntries(COLOR_KEYS.map((k, i) => [k, [...b.subarray(2 + i * 3, 5 + i * 3)]]));
  return parseTheme({ cdtheme: 1, name: b.subarray(20).toString('utf8'), colors, scene: SCENES[b[1]] });
}

// ---- Where they're kept: <data dir>/themes/, a file per theme named after a hash of its name ----------------------

const MAX_FILE = 4 * 1024 * 1024;
const themesDir = () => path.join(store.dataDir(), 'themes');
const fileFor = (name) => path.join(themesDir(), `${crypto.createHash('sha1').update(name).digest('hex').slice(0, 16)}.cdtheme`);

function readThemeFile(p) {
  try {
    if (fs.statSync(p).size > MAX_FILE) return null;
    return parseTheme(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch { return null; }
}
/** Every theme kept, by name. Files that aren't themes are left out. */
function list() {
  let files;
  try { files = fs.readdirSync(themesDir()).filter((f) => f.endsWith('.cdtheme')); } catch { return []; }
  return files.map((f) => readThemeFile(path.join(themesDir(), f))).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}
/** Keeps a theme — a new one under a name nothing else has, or `oldName` edited (renamed: the old file goes). */
function save(theme, oldName = null) {
  const t = parseTheme(theme);
  if (!t) return null;
  t.name = uniqueName(t.name, list().map((x) => x.name).filter((n) => n !== oldName));
  try {
    fs.mkdirSync(themesDir(), { recursive: true });
    const target = fileFor(t.name), tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(t));
    fs.renameSync(tmp, target);
  } catch { return null; }
  if (oldName && oldName !== t.name) remove(oldName);
  return t;
}
function remove(name) {
  try { fs.unlinkSync(fileFor(name)); return true; } catch { return false; }
}
/** A .cdtheme someone shared → kept (under a new name if needed), or null if it isn't one. */
function importFile(p) {
  const t = readThemeFile(p);
  return t ? save(t) : null;
}
function exportFile(name, target) {
  const t = list().find((x) => x.name === name);
  if (!t) return false;
  try { fs.writeFileSync(target, JSON.stringify(t, null, 1)); return true; } catch { return false; }
}

module.exports = { BUILTIN, SCENES, COLOR_KEYS, parseTheme, uniqueName, encodeCode, decodeCode, list, save, remove, importFile, exportFile };
