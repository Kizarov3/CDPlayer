'use strict';
/**
 * The tags a file had before CDPlayer first wrote over them — FIX TAGS, or found lyrics saved into it — so the Tags panel
 * can PUT BACK THE ORIGINAL. Each field is noted the first time it's changed and kept as it was through later changes;
 * putting them back forgets them. Covers aren't kept (a picture is large, and writing one never takes another away).
 * Kept in tags-before.json: { [path]: { at, tags: { field: value } } }.
 */
const LIMIT = 20000; // files; the oldest go first

/** The record with what `changes` will write over in the file whose tags are `now`. */
function remember(record, p, now, changes, at = Date.now()) {
  const keys = Object.keys(changes).filter((k) => k !== 'cover' && k in now);
  if (!keys.length) return record;
  const entry = record[p] || { at, tags: {} };
  for (const k of keys) if (!(k in entry.tags)) entry.tags[k] = now[k] ?? null;
  const out = { ...record };
  delete out[p];
  out[p] = entry; // the most recently changed last
  const paths = Object.keys(out);
  for (const old of paths.slice(0, Math.max(0, paths.length - LIMIT))) delete out[old];
  return out;
}

/** What to write to put the file's original tags back, or null. Fields that are already as they were are left out. */
function original(record, p, now) {
  const entry = record[p];
  if (!entry) return null;
  const changes = {};
  for (const [k, v] of Object.entries(entry.tags)) if (String(now[k] ?? '') !== String(v ?? '')) changes[k] = v;
  return Object.keys(changes).length ? { at: entry.at, changes } : null;
}

function parse(text) {
  try { const r = JSON.parse(text || ''); return r && typeof r === 'object' && !Array.isArray(r) ? r : {}; } catch { return {}; }
}

module.exports = { remember, original, parse };
