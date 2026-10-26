// HI-FI's level meters, in the deck's display as on a CD player's front: a row of segments for each side, L over R
// with the scale between them, lit in the display's colour and faintly there when off. Each follows the music up quick
// and falls back slow (a VU meter's ~300 ms), and the highest segment it reached stays lit a moment (peak hold).
// Meters that haven't moved by a segment aren't drawn again.
import { colors } from './theme.js';

const RISE = 0.012, FALL = 0.005; // how far a meter follows, per ms, rising and falling
const LOW = -20, HIGH = 3; // dB, as a VU meter's scale
const MARKS = [-20, -10, -7, -5, -3, -1, 0, 1, 3];
const HOLD = 900; // ms the peak stays before it falls too
const SEG = 4, GAP = 2; // a segment's width and the gap after it, px
const dbOf = (level) => 20 * Math.log10(Math.max(level, 1e-4) / 0.7); // (0 VU where the music is at its usual loudness)
const fraction = (db) => (Math.max(LOW, Math.min(HIGH, db)) - LOW) / (HIGH - LOW);

export class VuMeters {
  constructor(canvas) { this.canvas = canvas; this.levels = [LOW, LOW]; this.peaks = [LOW, LOW]; this.held = [0, 0]; this.drawn = null; }

  /** Fresh levels ([left, right], 0–1, or null: nothing playing) and the ms since the last. */
  set(levels, dt) {
    for (let i = 0; i < 2; i++) {
      const to = levels ? dbOf(levels[i]) : LOW, from = this.levels[i];
      const now = this.levels[i] = from + (to - from) * Math.min(1, dt * (to > from ? RISE : FALL));
      if (now >= this.peaks[i]) { this.peaks[i] = now; this.held[i] = HOLD; }
      else if ((this.held[i] -= dt) < 0) this.peaks[i] = Math.max(now, this.peaks[i] - dt * 0.02);
    }
  }

  draw() {
    const c = this.canvas, dpr = window.devicePixelRatio || 1;
    const { width: w, height: h } = c.getBoundingClientRect();
    if (!w || !h) return;
    const left = 18, right = 22, n = Math.max(10, Math.floor((w - left - right + GAP) / (SEG + GAP)));
    const lit = this.levels.map((db) => Math.round(fraction(db) * n)), peak = this.peaks.map((db) => Math.round(fraction(db) * n));
    const key = `${w}x${h}|${lit}|${peak}|${colors.accent}`;
    if (key === this.drawn) return;
    this.drawn = key;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const [r, gr, b] = colors.accent, on = `rgb(${r}, ${gr}, ${b})`, glow = `rgba(${r}, ${gr}, ${b}, .22)`, off = `rgba(${r}, ${gr}, ${b}, .13)`;
    const bar = 7, rows = [1, h - bar - 1], zero = Math.round(fraction(0) * n);
    const family = getComputedStyle(document.body).fontFamily;
    g.font = `bold 9px ${family}`; g.textBaseline = 'middle';
    for (let i = 0; i < 2; i++) {
      const y = rows[i];
      g.textAlign = 'left'; g.fillStyle = `rgba(${r}, ${gr}, ${b}, .72)`; g.fillText(i ? 'R' : 'L', 0, y + bar / 2 + .5);
      for (let s = 0; s < n; s++) {
        const x = left + s * (SEG + GAP), isLit = s < lit[i] || (s === peak[i] - 1 && peak[i] > 0);
        // past 0 the segments are taller, as the red end of a meter's scale
        const tall = s >= zero ? 1 : 0;
        if (isLit) { g.fillStyle = glow; g.fillRect(x - 1.5, y - 1.5 - tall, SEG + 3, bar + 3 + tall * 2); }
        g.fillStyle = isLit ? on : off;
        g.fillRect(x, y - tall, SEG, bar + tall * 2);
      }
    }
    // The scale between the rows: its marks, 0 and past it brighter.
    g.textAlign = 'center';
    const mid = h / 2;
    for (const m of MARKS) {
      const x = left + Math.min(n - 1, Math.round(fraction(m) * n)) * (SEG + GAP) - GAP / 2;
      g.fillStyle = `rgba(${r}, ${gr}, ${b}, ${m >= 0 ? .85 : .5})`;
      g.fillText(m > 0 ? `+${m}` : String(m), x, mid + .5);
    }
    g.textAlign = 'right'; g.fillStyle = `rgba(${r}, ${gr}, ${b}, .5)`; g.fillText('dB', w, mid + .5);
  }
}
