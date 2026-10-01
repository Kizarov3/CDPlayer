'use strict';
/**
 * Which language the interface is in (Settings → LANGUAGE, or the system's), and t() for the main process's own text:
 * dialog titles, menus. The dictionaries are src/locales/<code>.json; English is the code itself.
 */
const fs = require('fs');
const path = require('path');
const { format } = require('./i18n-format');

const LOCALES = path.join(__dirname, '..', 'locales');
const CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

function readLocale(dir, code) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), 'utf8'));
    return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
  } catch { return null; }
}
/** The languages there are files for: [{ code, name }], by code. */
function listLocales(dir = LOCALES) {
  let files;
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  return files.map((f) => f.slice(0, -5)).filter((c) => CODE.test(c)).sort()
    .map((code) => { const d = readLocale(dir, code); return d && typeof d._language === 'string' && d._language ? { code, name: d._language } : null; })
    .filter(Boolean);
}
/** The language to use: the one picked (if its file is there), else the first system language with a file. */
function resolveLocale(choice, systemLanguages, available) {
  const lower = new Map(available.map((c) => [c.toLowerCase(), c]));
  if (choice === 'en') return 'en';
  if (choice && choice !== 'AUTO' && lower.has(choice.toLowerCase())) return lower.get(choice.toLowerCase());
  for (const tag of systemLanguages || []) {
    const parts = String(tag).toLowerCase().split(/[-_]/);
    if (parts[0] === 'en') return 'en';
    for (let i = parts.length; i > 0; i--) {
      const c = parts.slice(0, i).join('-');
      if (lower.has(c)) return lower.get(c);
    }
  }
  return 'en';
}

let loaded = { code: 'en', dict: {} };
function loadLocale(choice, systemLanguages, dir = LOCALES) {
  const code = resolveLocale(choice, systemLanguages, listLocales(dir).map((l) => l.code));
  const dict = code === 'en' ? null : readLocale(dir, code);
  loaded = dict ? { code, dict } : { code: 'en', dict: {} };
  return loaded;
}
const t = (text, vars) => format(loaded.dict, text, vars);
const current = () => loaded;

module.exports = { listLocales, resolveLocale, loadLocale, t, current };
