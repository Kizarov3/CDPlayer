'use strict';
/**
 * The words of an album's songs for its booklet, kept on disk once found, so it opens with them at once (looked up
 * one by one online they take seconds, each time). Only found ones, for a month: one not found may only be offline.
 * The player's own lookup — the song playing — isn't kept here: it asks afresh, as always.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEEP = 30 * 86400e3;
const VERSION = 1; // raised when the way lyrics are matched changes, so a wrong match isn't kept

function createBookletWords({ dir, find, now = Date.now }) {
  const fileOf = (q) => path.join(dir(), `${crypto.createHash('sha1').update([VERSION, q.artist, q.title, q.album, Math.round(q.duration || 0)].join('\n').toLowerCase()).digest('hex')}.json`);
  let swept = false;
  function sweep() { // (the first time one's kept)
    if (swept) return;
    swept = true;
    try { for (const f of fs.readdirSync(dir())) { const p = path.join(dir(), f); if (now() - fs.statSync(p).mtimeMs > KEEP) fs.rmSync(p, { force: true }); } } catch { /* none there */ }
  }
  return async function words(q) {
    if (!q || !q.title) return null;
    const file = fileOf(q);
    try {
      const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (kept.lyrics && now() - kept.fetched < KEEP) return { lyrics: kept.lyrics, source: kept.source };
    } catch { /* none kept */ }
    const got = await find(q);
    if (!got || !got.lyrics) return null;
    try { fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ lyrics: got.lyrics, source: got.source || null, fetched: now() })); sweep(); } catch { /* not kept, then */ }
    return { lyrics: got.lyrics, source: got.source || null };
  };
}

/** Keeps the `keep` folders in `dir` changed (touched) last. */
function pruneFolders(dir, keep) {
  try {
    const folders = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())
      .map((e) => { const p = path.join(dir, e.name); return { p, at: fs.statSync(p).mtimeMs }; }).sort((a, b) => b.at - a.at);
    for (const { p } of folders.slice(keep)) fs.rmSync(p, { recursive: true, force: true });
  } catch { /* none there */ }
}

module.exports = { createBookletWords, pruneFolders };
