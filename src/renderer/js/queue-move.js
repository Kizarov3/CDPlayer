// Moving a queue row: the one rule for the drag (a step at a time) and for the phone (a whole move at once).

const whole = (n, length) => Number.isInteger(n) && n >= 0 && n < length;

/** `queue` with the row at `from` moved to `to` → { queue, index }, a new array; `index` (the song playing) follows
 *  its row, by place — not by path, which may be in the queue twice. Out of range → the inputs, unchanged. */
export function moveItem(queue, index, from, to) {
  if (!whole(from, queue.length) || !whole(to, queue.length)) return { queue, index };
  if (from === to) return { queue: queue.slice(), index };
  const next = queue.slice();
  next.splice(to, 0, next.splice(from, 1)[0]);
  let at = index;
  if (index === from) at = to;
  else if (from < index && to >= index) at = index - 1;
  else if (from > index && to <= index) at = index + 1;
  return { queue: next, index: at };
}
