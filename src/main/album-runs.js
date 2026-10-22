'use strict';
/**
 * Albums heard as albums. A run is an album played from its first song, each song after the one before: heard to its
 * last song it's PLAYED THROUGH (counted, for the booklet); left on the way, it's where a bookmark sticks out of its
 * spine on the shelf, to pick up from the song that was playing. Shuffled, or started part-way, is no run. A long
 * pause between two songs (a night) still is: a CD left in the player.
 * Kept in album-runs.json: { through: { [album id]: { n, last } }, runs: { [album id]: { next, last } } }.
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
 * A song heard: track `index` of an album of `length` songs (its id). → { state, through: true when this finished a
 * run }. `state` is changed in place.
 */
function heard(state, id, index, length, now = Date.now()) {
  const run = state.runs[id];
  if (index === 0) {
    if (length === 1) { delete state.runs[id]; return finish(state, id, now); }
    keepLast(state.runs, id, { next: 1, last: now });
  } else if (run && run.next === index) {
    if (index === length - 1) { delete state.runs[id]; return finish(state, id, now); }
    keepLast(state.runs, id, { next: index + 1, last: now });
  } else if (run && index !== run.next - 1) {
    delete state.runs[id]; // a song out of order (the one playing again is no break)
  }
  return { state, through: false };
}
function finish(state, id, now) {
  keepLast(state.through, id, { n: ((state.through[id] && state.through[id].n) || 0) + 1, last: now });
  return { state, through: true };
}

/** Where an album was left: { track (the index of the song that was playing), at }, or null. */
function bookmark(state, id, length, now = Date.now()) {
  const run = state.runs[id];
  if (!run || run.next < MIN_HEARD || run.next >= length + 1 || now - run.last > BOOKMARK_DAYS * 86400e3) return null;
  return { track: run.next - 1, at: run.last };
}

const throughCount = (state, id) => (state.through[id] && state.through[id].n) || 0;

/** Lists moved with their albums (relocate.js's moved ids). */
function moveIds(state, moveId) {
  const move = (m) => Object.fromEntries(Object.entries(m).map(([id, v]) => [moveId(id), v]));
  return { through: move(state.through), runs: move(state.runs) };
}

module.exports = { parse, heard, bookmark, throughCount, moveIds, empty };
