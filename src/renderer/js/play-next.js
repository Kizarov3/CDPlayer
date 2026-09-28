// PLAY NEXT: songs put straight after the one playing, which play next and in order — shuffled or not — before the
// queue carries on as usual. They're a run of the queue, { start, end } (end exclusive), kept in step as it changes.

/** `items` put to play next in `queue` (playing `index`) → { queue, nextUp }; after any already to play next. */
export function insertNext(queue, index, nextUp, items) {
  const stillAhead = nextUp && nextUp.start <= index + 1 && nextUp.end > index + 1;
  const at = stillAhead ? nextUp.end : index + 1;
  return {
    queue: [...queue.slice(0, at), ...items, ...queue.slice(at)],
    nextUp: { start: stillAhead ? nextUp.start : at, end: at + items.length },
  };
}

/** The song to play after `index` when it's one put to play next, or -1 to go by the usual order. */
export function pinnedNext(index, nextUp, length) {
  const next = index + 1;
  return nextUp && next >= nextUp.start && next < nextUp.end && next < length ? next : -1;
}

/** The run after the song at `removed` leaves the queue (null once none of it is left). */
export function afterRemove(nextUp, removed) {
  if (!nextUp) return null;
  if (removed < nextUp.start) return { start: nextUp.start - 1, end: nextUp.end - 1 };
  if (removed < nextUp.end) return nextUp.end - 1 > nextUp.start ? { start: nextUp.start, end: nextUp.end - 1 } : null;
  return nextUp;
}
