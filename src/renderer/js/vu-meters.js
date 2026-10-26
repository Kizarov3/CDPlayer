// HI-FI's two VU meters, left and right, as on a deck's front: a warm lit face, the scale from −20 to +3 with its red
// end, a needle each that swings up quick and falls back slow (a real meter's ~300 ms). Still needles aren't drawn again.
import { colors, rgb } from './theme.js';

const RISE = 0.012, FALL = 0.005; // how far a needle follows, per ms, rising and falling
const MARKS = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
const SWING = 0.82; // half the needle's sweep, in radians
const angleOf = (db) => SWING * (2 * (Math.max(-20, Math.min(3, db)) + 20) / 23 - 1);
const dbOf = (level) => 20 * Math.log10(Math.max(level, 1e-4) / 0.7); // (0 VU where the music is at its usual loudness)

export class VuMeters {
  constructor(canvas) { this.canvas = canvas; this.needles = [-20, -20]; this.drawn = null; }

  /** Fresh levels ([left, right], 0–1, or null: nothing playing) and the ms since the last. */
  set(levels, dt) {
    for (let i = 0; i < 2; i++) {
      const to = levels ? dbOf(levels[i]) : -20, from = this.needles[i];
      this.needles[i] = from + (to - from) * Math.min(1, dt * (to > from ? RISE : FALL));
    }
  }

  draw() {
    const c = this.canvas, dpr = window.devicePixelRatio || 1;
    const { width: w, height: h } = c.getBoundingClientRect();
    if (!w || !h) return;
    const key = `${w}x${h}|${this.needles.map((n) => n.toFixed(1))}|${colors.accent}`;
    if (key === this.drawn) return;
    this.drawn = key;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const gap = 14, mw = (w - gap) / 2;
    for (let i = 0; i < 2; i++) this.meter(g, i * (mw + gap), 0, mw, h, this.needles[i], i ? 'R' : 'L');
  }

  meter(g, x, y, w, h, db, side) {
    // The window: a dark bezel, the face lit warm from behind (tinted with the theme's accent), glass over it.
    g.save();
    g.beginPath(); g.roundRect(x, y, w, h, 8); g.fillStyle = '#0c0b0a'; g.fill();
    const fx = x + 5, fy = y + 5, fw = w - 10, fh = h - 10;
    g.beginPath(); g.roundRect(fx, fy, fw, fh, 5); g.clip();
    const a = colors.accent, face = g.createRadialGradient(fx + fw / 2, fy + fh * 1.1, fh * 0.2, fx + fw / 2, fy + fh * 0.9, fw * 0.75);
    face.addColorStop(0, `rgb(${Math.round(250 * 0.8 + a[0] * 0.2)}, ${Math.round(226 * 0.8 + a[1] * 0.2)}, ${Math.round(170 * 0.8 + a[2] * 0.2)})`);
    face.addColorStop(1, `rgb(${Math.round(180 * 0.8 + a[0] * 0.2)}, ${Math.round(140 * 0.8 + a[1] * 0.2)}, ${Math.round(80 * 0.8 + a[2] * 0.2)})`);
    g.fillStyle = face; g.fillRect(fx, fy, fw, fh);
    // The scale: an arc round the needle's pivot (below the face), black to 0, red past it, marks and numbers.
    const px = fx + fw / 2, py = fy + fh * 1.05, r = Math.min(fh * 0.82, fw * 0.62);
    g.lineWidth = 2;
    g.strokeStyle = '#1a1612'; g.beginPath(); g.arc(px, py, r, -Math.PI / 2 + angleOf(-20), -Math.PI / 2 + angleOf(0)); g.stroke();
    g.strokeStyle = '#b3261e'; g.lineWidth = 5; g.beginPath(); g.arc(px, py, r + 1.5, -Math.PI / 2 + angleOf(0), -Math.PI / 2 + angleOf(3)); g.stroke();
    g.font = `bold ${Math.max(8, Math.round(fh * 0.1))}px ${getComputedStyle(document.body).fontFamily}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const m of MARKS) {
      const t = -Math.PI / 2 + angleOf(m), cos = Math.cos(t), sin = Math.sin(t), long = [-20, -10, -5, 0, 3].includes(m);
      g.strokeStyle = m > 0 ? '#b3261e' : '#1a1612'; g.lineWidth = long ? 1.6 : 1;
      g.beginPath(); g.moveTo(px + cos * r, py + sin * r); g.lineTo(px + cos * (r + (long ? 8 : 5)), py + sin * (r + (long ? 8 : 5))); g.stroke();
      if (long) { g.fillStyle = m > 0 ? '#b3261e' : '#1a1612'; g.fillText(m > 0 ? `+${m}` : String(m), px + cos * (r + 17), py + sin * (r + 17)); }
    }
    g.fillStyle = 'rgba(26, 22, 18, .85)';
    g.font = `bold ${Math.max(9, Math.round(fh * 0.13))}px ${getComputedStyle(document.body).fontFamily}`;
    g.fillText('VU', px, fy + fh * 0.62);
    g.font = `${Math.max(8, Math.round(fh * 0.09))}px ${getComputedStyle(document.body).fontFamily}`;
    g.textAlign = 'left'; g.fillText(side, fx + 9, fy + fh - 11);
    // The needle, with its shadow on the face.
    const t = -Math.PI / 2 + angleOf(db), len = r + 6;
    for (const [dx, colour, width] of [[2.5, 'rgba(0, 0, 0, .18)', 2], [0, '#15120f', 1.5]]) {
      g.strokeStyle = colour; g.lineWidth = width;
      g.beginPath(); g.moveTo(px + dx, py); g.lineTo(px + dx + Math.cos(t) * len, py + Math.sin(t) * len); g.stroke();
    }
    // Glass: a soft sheen across the top.
    const glass = g.createLinearGradient(0, fy, 0, fy + fh);
    glass.addColorStop(0, 'rgba(255, 255, 255, .28)'); glass.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
    g.fillStyle = glass; g.fillRect(fx, fy, fw, fh);
    g.restore();
    g.strokeStyle = 'rgba(255, 255, 255, .08)'; g.lineWidth = 1; g.beginPath(); g.roundRect(x + .5, y + .5, w - 1, h - 1, 8); g.stroke();
  }
}
