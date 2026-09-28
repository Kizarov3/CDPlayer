// Dust on the shelf: an album nobody's played or wiped in a month starts gathering it, a little more each week, up to a
// thick coat at six months. Rub the mouse back and forth over a spine to wipe it off. PULL ONE takes an album off the
// shelf at random, the dustier the likelier.

export const DUST_FROM_DAYS = 30, DUST_FULL_DAYS = 180;
const DAY = 86400000;

/** How dusty an album last played or wiped at `touched` is by `now`: 0 (clean) … 1 (thick). */
export function dustLevel(touched, now = Date.now()) {
  if (!touched) return 0;
  const days = (now - touched) / DAY;
  return Math.max(0, Math.min(1, (days - DUST_FROM_DAYS) / (DUST_FULL_DAYS - DUST_FROM_DAYS)));
}

/** A random album ({ touched }) off the shelf, weighted toward the ones left longest. → null when there are none. */
export function pickOne(albums, now = Date.now(), rnd = Math.random) {
  if (!albums.length) return null;
  const weights = albums.map((a) => 1 + 12 * dustLevel(a.touched, now));
  let r = rnd() * weights.reduce((s, w) => s + w, 0);
  for (let i = 0; i < albums.length; i++) { r -= weights[i]; if (r < 0) return albums[i]; }
  return albums[albums.length - 1];
}

const STROKE_PX = 6;   // a turn back after at least this far one way counts
const STROKE_MS = 600; // …and only if it came quickly after the last movement the other way

/**
 * Tells a wipe from the mouse just passing: fed the mouse's x over a spine, it counts each time the mouse turns back
 * after going a few pixels one way, briskly.
 */
export class Wiper {
  constructor() { this.dir = 0; this.run = 0; this.last = null; this.turnedAt = null; }
  /** → 1 when this movement finished a stroke, else 0. */
  move(x, t) {
    const last = this.last;
    this.last = { x, t };
    if (!last) return 0;
    const dx = x - last.x;
    if (!dx) return 0;
    const dir = Math.sign(dx);
    if (t - last.t > STROKE_MS) { this.dir = dir; this.run = Math.abs(dx); return 0; } // a pause: start over
    if (dir === this.dir) { this.run += Math.abs(dx); return 0; }
    const stroke = this.dir !== 0 && this.run >= STROKE_PX;
    this.dir = dir; this.run = Math.abs(dx);
    return stroke ? 1 : 0;
  }
}
