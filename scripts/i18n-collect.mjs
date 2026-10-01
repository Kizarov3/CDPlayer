// The interface's texts as the code has them (every t('…') and the pages' data-i18n), and the tools that keep a language
// file (src/locales/<code>.json) in step with them. Used by `npm run i18n -- <code>` and by the tests.
import fs from 'node:fs';
import path from 'node:path';

const unescape = (s) => s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c));
const ENTITIES = { nbsp: '\u00a0', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const decode = (s) => s.replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (_, e) => ENTITIES[e]);

export function collectStrings(files) {
  const keys = new Set();
  for (const { path: p, text } of files) {
    if (p.endsWith('.html')) {
      for (const m of text.matchAll(/<[^>]*\bdata-i18n(?![-\w])[^>]*>([^<]+)</g)) keys.add(decode(m[1]).trim());
      for (const m of text.matchAll(/<[^>]*\bdata-i18n-title\b[^>]*>/g)) { const tm = /\btitle="([^"]*)"/.exec(m[0]); if (tm) keys.add(decode(tm[1])); }
    } else {
      for (const m of text.matchAll(/(?<![\w.$])t\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
        if (m[1] === '`' && m[2].includes('${')) continue;
        keys.add(unescape(m[2]));
      }
    }
  }
  return [...keys].sort();
}

/** Every source file whose text the interface shows: renderer and main JS, and the two pages. */
export function sourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['locales', 'decoders', 'encoders', 'fonts'].includes(e.name)) walk(p); }
      else if (/\.(js|html)$/.test(e.name)) out.push({ path: p, text: fs.readFileSync(p, 'utf8') });
    }
  };
  walk(root);
  return out;
}

export function syncLocale(existing, keys, code) {
  const out = { _language: existing._language ?? '', _locale: existing._locale || code };
  for (const k of keys) out[k] = existing[k] ?? '';
  return out;
}
export function coverage(dict, keys) {
  const done = keys.filter((k) => (typeof dict[k] === 'object' ? dict[k] && dict[k].other : dict[k])).length;
  return { done, total: keys.length };
}

// Literal interface text handed straight to the helpers that put it on screen, without t(): two capitals in a row
// (the interface writes its labels in capitals) or a sentence in a hint.
const SHOWN = /\b(setStatus|pill|title|row|hint|section)\(\s*(['"`])((?:\\.|(?!\2)[^\\])*)\2/g;
export function untranslated(files, allow) {
  const out = [];
  for (const { path: p, text } of files) {
    for (const m of text.matchAll(SHOWN)) {
      const s = unescape(m[3]);
      if (!/[A-Z]{2}|[A-Za-z]{3,} [a-z]{3,}/.test(s) || allow.includes(s)) continue;
      out.push({ path: p, text: s });
    }
  }
  return out;
}
/** Files already converted (each conversion task adds its own). */
export const CONVERTED = ['src/renderer/js/app.js', 'src/renderer/js/widgets.js', 'src/renderer/js/keys.js', 'src/renderer/js/panels.js', 'src/renderer/js/help.js', 'src/renderer/js/theme-editor.js'];
/** Literal text that is shown as it is in every language. */
export const ALLOW = [];
