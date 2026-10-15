// The guide's geometry: where the bubble goes beside what it points at. Pure, for node --test; tour-view.js draws it.

const GAP = 14, MARGIN = 12, ARROW_INSET = 16;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** One rectangle round several ({ left, top, right, bottom }), or null for none. */
export function unionRect(rects) {
  if (!rects.length) return null;
  const left = Math.min(...rects.map((r) => r.left)), top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.right)), bottom = Math.max(...rects.map((r) => r.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/**
 * Where a bubble of `bubble`'s size ({ width, height }) goes beside `target` in a `view` ({ width, height }): below it,
 * else above, else to the right, else the left — the first side with room, else the roomiest — kept inside the window.
 * → { side, x, y, arrow } (arrow: how far along the bubble's edge its pointer sits, toward the target's middle).
 */
export function placeBubble(target, bubble, view) {
  const room = {
    below: view.height - target.bottom - GAP - MARGIN, above: target.top - GAP - MARGIN,
    right: view.width - target.right - GAP - MARGIN, left: target.left - GAP - MARGIN,
  };
  const need = { below: bubble.height, above: bubble.height, right: bubble.width, left: bubble.width };
  const order = ['below', 'above', 'right', 'left'];
  const side = order.find((s) => room[s] >= need[s]) || order.reduce((a, b) => (room[b] - need[b] > room[a] - need[a] ? b : a));
  const cx = (target.left + target.right) / 2, cy = (target.top + target.bottom) / 2;
  const maxX = view.width - bubble.width - MARGIN, maxY = view.height - bubble.height - MARGIN;
  if (side === 'below' || side === 'above') {
    const x = clamp(cx - bubble.width / 2, MARGIN, maxX);
    const y = clamp(side === 'below' ? target.bottom + GAP : target.top - GAP - bubble.height, MARGIN, maxY);
    return { side, x, y, arrow: clamp(cx - x, ARROW_INSET, bubble.width - ARROW_INSET) };
  }
  const x = clamp(side === 'right' ? target.right + GAP : target.left - GAP - bubble.width, MARGIN, maxX);
  const y = clamp(cy - bubble.height / 2, MARGIN, maxY);
  return { side, x, y, arrow: clamp(cy - y, ARROW_INSET, bubble.height - ARROW_INSET) };
}
