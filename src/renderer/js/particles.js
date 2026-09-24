// Whole-window theme particles: SNOW (falling snow), OCEAN (rising bubbles), AUTUMN (tumbling leaves), GALAXY
// (twinkling stars + shooting stars), MATRIX (code rain). Drawn over everything but kept off the disc and any
// open panel, like the Java version's clipped glass pane. Motion is tuned to the original 35ms tick.
import { colors, rgb } from './theme.js';

const COUNT = 140;
const MATRIX_COL = 16;
const LEAF_PALETTE = [[224, 122, 40], [200, 60, 46], [230, 176, 60], [180, 90, 40], [214, 140, 70]].map((c) => rgb(c, 210 / 255));

export class Particles {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = 'NONE';
    this.x = new Float64Array(COUNT); this.y = new Float64Array(COUNT);
    this.speed = new Float64Array(COUNT); this.phase = new Float64Array(COUNT);
    this.size = new Float64Array(COUNT); this.spin = new Float64Array(COUNT);
    this.shooting = [];
    this.clock = 0;
    this.w = 0; this.h = 0;
  }
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.canvas.style.display = mode === 'NONE' ? 'none' : 'block';
    this.seed();
  }
  seed() {
    const w = Math.max(1, this.w), h = Math.max(1, this.h), R = Math.random;
    this.shooting = [];
    for (let i = 0; i < COUNT; i++) {
      this.x[i] = R() * w; this.y[i] = R() * h; this.phase[i] = R() * Math.PI * 2;
      switch (this.mode) {
        case 'SNOW': this.speed[i] = 0.6 + R() * 1.6; this.size[i] = 1.2 + R() * 2.3; break;
        case 'OCEAN': this.speed[i] = 0.3 + R() * 0.9; this.size[i] = 1.4 + R() * 2.8; break;
        case 'AUTUMN': this.speed[i] = 0.4 + R() * 1.0; this.size[i] = 2.6 + R() * 2.6; this.spin[i] = R() * Math.PI * 2; break;
        case 'GALAXY': this.speed[i] = 0.4 + R() * 1.6; this.size[i] = 0.6 + R() * 1.6; break;
        case 'MATRIX': this.x[i] = i * MATRIX_COL; this.y[i] = -R() * h - 20; this.speed[i] = 2 + R() * 4; break;
        default: break;
      }
    }
  }
  advance(k) {
    const w = this.w, h = this.h;
    this.clock += 0.035 * k;
    const fall = (dir) => {
      for (let i = 0; i < COUNT; i++) {
        this.y[i] += this.speed[i] * dir * k;
        this.x[i] += Math.sin(this.y[i] * 0.02 + this.phase[i]) * 0.6 * k;
        if (dir > 0 && this.y[i] > h) { this.y[i] = -4; this.x[i] = Math.random() * w; }
        else if (dir < 0 && this.y[i] < -4) { this.y[i] = h + 4; this.x[i] = Math.random() * w; }
        if (this.x[i] < -6) this.x[i] = w + 6; else if (this.x[i] > w + 6) this.x[i] = -6;
      }
    };
    switch (this.mode) {
      case 'SNOW': fall(1); break;
      case 'OCEAN': fall(-1); break;
      case 'AUTUMN': fall(1); for (let i = 0; i < COUNT; i++) this.spin[i] += (0.02 + this.speed[i] * 0.015) * k; break;
      case 'MATRIX':
        for (let i = 0; i < COUNT; i++) { this.y[i] += this.speed[i] * k; if (this.y[i] > h + 160) this.y[i] = -Math.random() * h * 0.6 - 20; }
        break;
      case 'GALAXY':
        if (this.shooting.length < 2 && Math.random() < 0.012 * k) {
          this.shooting.push({ x: Math.random() * w * 0.5, y: Math.random() * h * 0.4, vx: 6 + Math.random() * 5, vy: 3 + Math.random() * 2.5, life: 1 });
        }
        for (const s of this.shooting) { s.x += s.vx * k; s.y += s.vy * k; s.life -= 0.02 * k; }
        this.shooting = this.shooting.filter((s) => s.life > 0 && s.x < w + 40 && s.y < h + 40);
        break;
      default: break;
    }
  }

  /** @param exclusions rects (viewport CSS px) the particles must not paint over — the disc and any open card. */
  frame(dt, exclusions) {
    if (this.mode === 'NONE') return;
    const c = this.canvas, dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth, h = window.innerHeight;
    if (w !== this.w || h !== this.h) {
      const first = !this.w;
      this.w = w; this.h = h;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      if (first || this.mode !== 'NONE') this.seed(); // spread across the whole new size right away
    }
    this.advance(Math.min(4, dt / 35));
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    this.paint(g, w, h);
    // Punch the disc and any open card back out (clearing, rather than clipping, so overlapping areas stay clear).
    for (const r of exclusions) g.clearRect(r.x, r.y, r.w, r.h);
  }
  paint(g, w, h) {
    const dot = (x, y, r) => { g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); };
    switch (this.mode) {
      case 'SNOW':
        g.fillStyle = 'rgba(255,255,255,0.86)';
        g.beginPath(); for (let i = 0; i < COUNT; i++) dot(this.x[i], this.y[i], this.size[i]); g.fill();
        break;
      case 'OCEAN':
        g.fillStyle = 'rgba(210,245,250,0.51)';
        g.beginPath(); for (let i = 0; i < COUNT; i++) dot(this.x[i], this.y[i], this.size[i]); g.fill();
        break;
      case 'AUTUMN':
        for (let i = 0; i < COUNT; i++) {
          g.fillStyle = LEAF_PALETTE[i % LEAF_PALETTE.length];
          g.beginPath(); g.ellipse(this.x[i], this.y[i], this.size[i], this.size[i] * 0.6, this.spin[i], 0, Math.PI * 2); g.fill();
        }
        break;
      case 'GALAXY':
        for (let i = 0; i < COUNT; i++) {
          const tw = 0.5 + 0.5 * Math.sin(this.clock * (0.6 + this.speed[i]) + this.phase[i]);
          g.fillStyle = `rgba(255,255,255,${Math.min(255, 80 + tw * 175) / 255})`;
          g.beginPath(); dot(this.x[i], this.y[i], this.size[i] * (0.7 + tw * 0.5)); g.fill();
        }
        g.lineWidth = 1.4; g.lineCap = 'round';
        for (const s of this.shooting) {
          const n = Math.hypot(s.vx, s.vy);
          g.strokeStyle = `rgba(255,255,255,${Math.max(0, Math.min(1, s.life * 0.9))})`;
          g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x - (s.vx / n) * 26, s.y - (s.vy / n) * 26); g.stroke();
        }
        break;
      case 'MATRIX': {
        g.font = 'bold 14px monospace';
        g.textAlign = 'left';
        const trail = [];
        for (let j = 1; j < 10; j++) trail[j] = rgb(colors.accent, Math.max(0, 200 - j * 22) / 255);
        for (let i = 0; i < COUNT; i++) {
          if (this.x[i] > w) continue;
          for (let j = 0; j < 10; j++) {
            const gy = this.y[i] - j * 16;
            if (gy < -16 || gy > h + 16) continue;
            g.fillStyle = j === 0 ? 'rgb(224,255,224)' : trail[j];
            g.fillText(String(Math.floor(Math.random() * 10)), this.x[i], gy);
          }
        }
        break;
      }
      default: break;
    }
  }
}
