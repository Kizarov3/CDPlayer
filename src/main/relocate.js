'use strict';
/**
 * Moved music. Plays, first and last plays and HISTORY are kept by each song's path, so a music folder moved or renamed
 * (a new drive, a new computer) leaves them behind: the booklet's tally marks, the dust, LAST PLAYED. A song they know
 * that's gone, and a song on the shelf whose path ends the same way — the same file in the same folder, and as much of
 * the path above as it takes to tell it from any other — are taken to be one song, moved. The moves come in groups
 * (this folder is that one now) for the shelf to ask about: nothing moves until the user says so.
 */

const SEP = /[\\/]+/;
const parts = (p) => String(p).split(SEP).filter(Boolean);
const lower = (s) => s.toLowerCase();

// The path with its last n parts taken off, and no separator at its end ("/a/b/c", 2 → "/a").
function prefixOf(p, n) {
  let s = String(p);
  for (let i = 0; i < n; i++) s = s.replace(/[\\/]*[^\\/]+[\\/]*$/, '');
  return s;
}

function commonTail(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && lower(a[a.length - 1 - n]) === lower(b[b.length - 1 - n])) n++;
  return n;
}

/**
 * gone: paths the history knows that aren't there any more; present: the shelf's songs.
 * → { moves: Map(old → new), groupOf: Map(old → its group's key), groups: [{ key, from, to, count }] } (the most
 * songs first). A song that could be either of two on the shelf is left where it was.
 */
function findMoves(gone, present) {
  const byTail = new Map();
  for (const p of present) {
    const ps = parts(p);
    if (ps.length < 2) continue;
    const key = lower(ps.slice(-2).join('/'));
    if (!byTail.has(key)) byTail.set(key, []);
    byTail.get(key).push({ path: p, ps });
  }
  const moves = new Map(), groupOf = new Map(), groups = new Map();
  for (const old of gone) {
    const os = parts(old);
    if (os.length < 2) continue;
    const candidates = byTail.get(lower(os.slice(-2).join('/')));
    if (!candidates) continue;
    let best = null, bestTail = 0, tie = false;
    for (const c of candidates) {
      const n = commonTail(os, c.ps);
      if (n > bestTail) { best = c; bestTail = n; tie = false; } else if (n === bestTail) tie = true;
    }
    if (!best || tie) continue;
    moves.set(old, best.path);
    const from = prefixOf(old, bestTail), to = prefixOf(best.path, bestTail), key = `${from}\n${to}`;
    groupOf.set(old, key);
    if (!groups.has(key)) groups.set(key, { key, from, to, count: 0 });
    groups.get(key).count++;
  }
  return { moves, groupOf, groups: [...groups.values()].sort((a, b) => b.count - a.count) };
}

/** Only the moves of one group (its key). */
function movesOf(found, key) {
  return new Map([...found.moves].filter(([old]) => found.groupOf.get(old) === key));
}

// A map with its keys moved, in its order (the most recently played stay last); two that become one are combined.
function moveKeys(map, moves, combine) {
  const out = new Map();
  for (const [k, v] of map) {
    const key = moves.get(k) || k;
    const value = out.has(key) ? combine(out.get(key), v) : v;
    out.delete(key);
    out.set(key, value);
  }
  return out;
}

/** The plays maps ({ counts, last, first }, by path) with the moved songs under their new paths. */
function movePlays({ counts, last, first }, moves) {
  return {
    counts: moveKeys(counts, moves, (a, b) => a + b),
    last: moveKeys(last, moves, Math.max),
    first: moveKeys(first, moves, Math.min),
  };
}

/** HISTORY's paths, newest first by when each was last played (those with no time last, as they were). */
function newestFirst(paths, last) {
  return paths.map((p, i) => ({ p, i, at: last.get(p) || 0 }))
    .sort((a, b) => (b.at - a.at) || (a.i - b.i)).map((e) => e.p);
}

/** HISTORY with the moved songs under their new paths, each once. */
function moveHistory(paths, moves) {
  return [...new Set(paths.map((p) => moves.get(p) || p))];
}

/**
 * An album's id as the shelf makes it: "artist\nalbum\nfolder" (the folder only when nobody's named the artist) or
 * "\n\nfolder" for untagged music. Its folder moved with the group (from → to), or the id as it was.
 */
function moveAlbumId(id, from, to) {
  const ps = String(id).split('\n');
  if (ps.length !== 3 || !ps[2] || !from) return id;
  const folder = ps[2];
  if (!folder.startsWith(from) || (folder.length > from.length && !SEP.test(folder[from.length]))) return id;
  const sep = (to.includes('\\') || /^[a-z]:$/i.test(to)) && !to.includes('/') ? '\\' : '/'; // a Windows drive's
  ps[2] = to + folder.slice(from.length).replace(/[\\/]+/g, sep);
  return ps.join('\n');
}

module.exports = { findMoves, movesOf, movePlays, newestFirst, moveHistory, moveAlbumId, prefixOf };
