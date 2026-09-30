'use strict';
/**
 * One play of a track: its count goes up, it's the last played now, and — only when this is its very first play —
 * it's noted as first played now. A track played before first plays were being noted has no first date, rather
 * than a made-up one. Most recently played last, in every map, so the oldest are dropped first.
 * plays: { counts, last, first } (Maps by path). → the new count.
 */
function recordPlay({ counts, last, first }, p, now) {
  const n = (counts.get(p) || 0) + 1;
  counts.delete(p); counts.set(p, n);
  last.delete(p); last.set(p, now);
  if (n === 1 && !first.has(p)) first.set(p, now);
  return n;
}
module.exports = { recordPlay };
