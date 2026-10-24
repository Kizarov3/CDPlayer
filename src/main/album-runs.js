'use strict';
/**
 * Albums heard as albums. A run is an album played from its first song, each song after the one before: heard to its
 * last song it's PLAYED THROUGH (counted, for the booklet); left on the way, it's where a bookmark sticks out of its
 * spine on the shelf, to pick up from the song that was playing. Shuffled, or started part-way, is no run. A long
 * pause between two songs (a night) still is: a CD left in the player.
 * Songs marked not to be played are passed over: the run goes on past them, and ends at the last one to play.
 * Kept in album-runs.json: { through: { [album id]: { n, last } }, runs: { [album id]: { next, at, n, last } } } (a run:
 * the next song to play, the one heard last, how many heard; runs from before 2.18.1 have only `next`).
 */
const BOOKMARK_DAYS = 60;   // a run left longer than this is forgotten
const MIN_HEARD = 2;        // songs heard before it counts as started (one song is just a song)
const LIMIT = 5000;         // albums kept in each list; the oldest go first

const empty = () => ({ through: {}, runs: {} });

function parse(text) {
  try {
    const r = JSON.parse(text || '');
    return r && typeof r.through === 'object' && typeof r.runs === 'object' ? r : empty();
  } catch { return empty(); }
}

function keepLast(map, key, value) {
  delete map[key];
  map[key] = value;
  const keys = Object.keys(map);
  for (const k of keys.slice(0, Math.max(0, keys.length - LIMIT))) delete map[k];
}

/**
 * A song heard: track `index` of an album of `length` songs (its id). `skip(i)`: track i is one not to play. → { state,
 * through: true when this finished a run }. `state` is changed in place.
 */
function heard(state, id, index, length, now = Date.now(), skip = () => false) {
  const from = (i) => { let k = i; while (k < length && skip(k)) k++; return k; }; // the next one to play from i on (length: none)
  const run = state.runs[id];
  const on = (n) => { // heard in order: the run goes on, or it's over
    const next = from(index + 1);
    if (next >= length) { delete state.runs[id]; return finish(state, id, now); }
    keepLast(state.runs, id, { next, at: index, n, last: now });
    return { state, through: false };
  };
  if (index === 0 || index === from(0)) return on(1); // its first song (the first to play)
  const at = run ? (run.at != null ? run.at : run.next - 1) : -1; // the one heard last
  if (run && index > at && index <= from(run.next)) return on((run.n || run.next) + 1); // the next (or one passed over before it, played anyway)
  if (run && index !== at) delete state.runs[id]; // a song out of order (the one playing again is no break)
  return { state, through: false };
}
function finish(state, id, now) {
  keepLast(state.through, id, { n: ((state.through[id] && state.through[id].n) || 0) + 1, last: now });
  return { state, through: true };
}

/** Where an album was left: { track (the index of the song that was playing), at }, or null. */
function bookmark(state, id, length, now = Date.now()) {
  const run = state.runs[id];
  if (!run || (run.n || run.next) < MIN_HEARD || run.next >= length + 1 || now - run.last > BOOKMARK_DAYS * 86400e3) return null;
  return { track: run.at != null ? run.at : run.next - 1, at: run.last };
}

const throughCount = (state, id) => (state.through[id] && state.through[id].n) || 0;

/** Lists moved with their albums (relocate.js's moved ids). */
function moveIds(state, moveId) {
  const move = (m) => Object.fromEntries(Object.entries(m).map(([id, v]) => [moveId(id), v]));
  return { through: move(state.through), runs: move(state.runs) };
}

module.exports = { parse, heard, bookmark, throughCount, moveIds, empty };
