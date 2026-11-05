// The middle of a disc in a photo of it: where its hole really is. A scan's disc is rarely in the middle of the picture,
// and one that's cut off by the picture's edge can't be measured from its outline; turning a disc round any other point
// shows the scan's hole beside the hole drawn, and makes the disc wobble.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * The hole's middle, from the round edges of the hub: each edge in the middle of the disc votes along its slope for
 * where its circle's middle would be, and a circle's edges all agree. Accepted only if one circle's edge really goes
 * most of the way round that point (print and scratches don't).
 * `grey`: w × h values (0…255); `guess`: { x, y, r } the disc as seen from its outline. → { x, y } | null (none seen).
 */
export function holeCentre(grey, w, h, guess) {
  const reach = guess.r * 0.14, rMin = guess.r * 0.07, rMax = guess.r * 0.26, area = reach + rMax;
  const x0 = Math.max(1, Math.floor(guess.x - area)), x1 = Math.min(w - 2, Math.ceil(guess.x + area));
  const y0 = Math.max(1, Math.floor(guess.y - area)), y1 = Math.min(h - 2, Math.ceil(guess.y + area));
  const edges = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * w + x, tl = grey[i - w - 1], t = grey[i - w], tr = grey[i - w + 1], l = grey[i - 1], r = grey[i + 1], bl = grey[i + w - 1], b = grey[i + w], br = grey[i + w + 1];
    const gx = tr + 2 * r + br - tl - 2 * l - bl, gy = bl + 2 * b + br - tl - 2 * t - tr, mag = Math.hypot(gx, gy);
    if (mag > 120) edges.push({ x, y, ux: gx / mag, uy: gy / mag });
  }
  if (edges.length < 12) return null;

  // The votes, on a grid over where the hole could be.
  const side = Math.ceil(reach * 2) + 1, left = guess.x - reach, top = guess.y - reach, votes = new Float32Array(side * side);
  for (const e of edges) for (const dir of [1, -1]) for (let d = rMin; d <= rMax; d += 1) {
    const cx = Math.round(e.x + dir * e.ux * d - left), cy = Math.round(e.y + dir * e.uy * d - top);
    if (cx >= 0 && cy >= 0 && cx < side && cy < side) votes[cy * side + cx]++;
  }
  let best = -1, bx = 0, by = 0;
  for (let y = 1; y < side - 1; y++) for (let x = 1; x < side - 1; x++) {
    let v = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) v += votes[(y + a) * side + x + b];
    if (v > best) { best = v; bx = x; by = y; }
  }
  if (best <= 0) return null;
  const peak = { x: bx + left, y: by + top };

  // Is there a circle there? Edges facing that point, by how far off they are: the best ring's, and how far round it goes.
  const rings = new Map();
  for (const e of edges) {
    const dx = e.x - peak.x, dy = e.y - peak.y, d = Math.hypot(dx, dy);
    if (d < rMin || d > rMax || Math.abs((dx * e.ux + dy * e.uy) / d) < 0.9) continue;
    const key = Math.round(d / 2);
    if (!rings.has(key)) rings.set(key, []);
    rings.get(key).push(e);
  }
  let ring = null, round = 0;
  for (const [key, list] of rings) {
    const near = [...list, ...(rings.get(key + 1) || [])], sectors = new Set(near.map((e) => Math.floor(((Math.atan2(e.y - peak.y, e.x - peak.x) + Math.PI) / (Math.PI * 2)) * 16) % 16));
    if (sectors.size > round) { round = sectors.size; ring = near; }
  }
  if (!ring || round < 11) return null;

  // Its middle more exactly than the grid's: the mean of where those edges point.
  const dist = ring.reduce((a, e) => a + Math.hypot(e.x - peak.x, e.y - peak.y), 0) / ring.length;
  let sx = 0, sy = 0;
  for (const e of ring) {
    const dot = (e.x - peak.x) * e.ux + (e.y - peak.y) * e.uy, s = dot >= 0 ? 1 : -1;
    sx += e.x - s * e.ux * dist; sy += e.y - s * e.uy * dist;
  }
  return { x: clamp(sx / ring.length, left, left + reach * 2), y: clamp(sy / ring.length, top, top + reach * 2) };
}
