// The interface's texts as the code has them (every t('…') and the pages' data-i18n), and the tools that keep a language
// file (src/locales/<code>.json) in step with them. Used by `npm run i18n -- <code>` and by the tests.
import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const unescape = (s) => s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c));
const ENTITIES = { nbsp: '\u00a0', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const decode = (s) => s.replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (_, e) => ENTITIES[e]);

export function collectStrings(files) {
  const keys = new Set();
  for (const { path: p, text } of files) {
    if (p.endsWith('.html')) {
      for (const m of text.matchAll(/<[^>]*\bdata-i18n(?![-\w])[^>]*>([^<]+)</g)) keys.add(decode(m[1]).trim());
      for (const m of text.matchAll(/<[^>]*\bdata-i18n-title\b[^>]*>/g)) { const tm = /\btitle="([^"]*)"/.exec(m[0]); if (tm) keys.add(decode(tm[1])); }
      for (const m of text.matchAll(/<[^>]*\bdata-i18n-placeholder\b[^>]*>/g)) { const pm = /\bplaceholder="([^"]*)"/.exec(m[0]); if (pm) keys.add(decode(pm[1])); }
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
export const CONVERTED = ['src/renderer/js/app.js', 'src/renderer/js/widgets.js', 'src/renderer/js/keys.js', 'src/renderer/js/panels.js', 'src/renderer/js/help.js', 'src/renderer/js/theme-editor.js',
  'src/renderer/js/shelf.js', 'src/renderer/js/shelf-missing.js', 'src/renderer/js/shelf-notes.js', 'src/renderer/js/shelf-order.js', 'src/renderer/js/shelf-receipt.js',
  'src/renderer/js/booklet.js', 'src/renderer/js/booklet-content.js', 'src/renderer/js/disc.js', 'src/renderer/js/karaoke.js', 'src/renderer/js/mini.js',
  'src/renderer/js/share-card.js', 'src/renderer/js/share-video.js', 'src/renderer/js/output.js'];
/** Literal text that is shown as it is in every language. */
export const ALLOW = [];

// The names a function, block or loop declares itself (parameters, const/let/var, function names, catch and for-of
// bindings) — not those of functions inside it.
const NESTED = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
function namesOf(pattern, out) {
  if (!pattern) return out;
  if (pattern.type === 'Identifier') out.add(pattern.name);
  else if (pattern.type === 'ObjectPattern') for (const p of pattern.properties) namesOf(p.type === 'RestElement' ? p.argument : p.value, out);
  else if (pattern.type === 'ArrayPattern') for (const p of pattern.elements) namesOf(p, out);
  else if (pattern.type === 'AssignmentPattern') namesOf(pattern.left, out);
  else if (pattern.type === 'RestElement') namesOf(pattern.argument, out);
  return out;
}
function declares(scope) {
  const names = new Set();
  if (NESTED.has(scope.type)) { for (const p of scope.params) namesOf(p, names); if (scope.id && scope.type === 'FunctionExpression') names.add(scope.id.name); }
  if (scope.type === 'CatchClause') namesOf(scope.param, names);
  if (/^For(Of|In)?Statement$/.test(scope.type)) { const init = scope.init || scope.left; if (init && init.type === 'VariableDeclaration') for (const d of init.declarations) namesOf(d.id, names); }
  const body = scope.type === 'BlockStatement' ? scope.body : NESTED.has(scope.type) && scope.body.type === 'BlockStatement' ? scope.body.body : [];
  for (const stmt of body) {
    if (stmt.type === 'VariableDeclaration') for (const d of stmt.declarations) namesOf(d.id, names);
    if (stmt.type === 'FunctionDeclaration') names.add(stmt.id.name);
  }
  return names;
}
/** Lines where t('…') is called inside a scope that has its own t — which would hide the translating t(). */
export function hiddenT(text) {
  const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const lines = new Set();
  walk.ancestor(ast, {
    CallExpression(node, _s, ancestors) {
      if (node.callee.type !== 'Identifier' || node.callee.name !== 't') return;
      if (ancestors.slice(0, -1).some((a) => a.type !== 'Program' && declares(a).has('t'))) lines.add(node.loc.start.line);
    },
  });
  return [...lines].sort((a, b) => a - b);
}
