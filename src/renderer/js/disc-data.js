// The data side of the disc (B, or the ⟲ on the case): where each track is written. A CD is written from the middle
// out at a constant linear speed, so the area of disc a track takes up is in proportion to its length, and its ring's
// radius goes as the square root of time: r = √(r₀² + (r₁² − r₀²)·t / T). A disc shorter than 74 minutes leaves its
// edge unwritten; a longer one is squeezed to fit. Radii are fractions of the disc's.

export const R0 = 0.4, R1 = 0.96, CD_SECONDS = 74 * 60;

/** Track lengths (s) → { tracks: [{ r0, r1, start, end }], total, end (the written area's edge) }. */
export function discLayout(durations) {
  const total = durations.reduce((s, d) => s + Math.max(0, d || 0), 0);
  const T = Math.max(CD_SECONDS, total);
  const r = (t) => Math.sqrt(R0 * R0 + ((R1 * R1 - R0 * R0) * t) / T);
  let t = 0;
  const tracks = durations.map((d) => {
    const start = t;
    t += Math.max(0, d || 0);
    return { r0: r(start), r1: r(t), start, end: t };
  });
  return { tracks, total, end: r(total), T };
}

/** Where the laser is `seconds` into the disc: its radius. */
export function radiusAt(layout, seconds) {
  const t = Math.max(0, Math.min(layout.total, seconds || 0));
  return Math.sqrt(R0 * R0 + ((R1 * R1 - R0 * R0) * t) / layout.T);
}

/** The track whose ring is at `radius`, or -1 (the hub, or the unwritten edge). */
export function trackAt(layout, radius) {
  return layout.tracks.findIndex((t, i) => radius >= t.r0 && (radius < t.r1 || (i === layout.tracks.length - 1 && radius <= t.r1)));
}
