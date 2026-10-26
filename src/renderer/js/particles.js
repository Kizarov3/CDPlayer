// Whole-window theme particles: SNOW (falling snow), OCEAN (rising bubbles), AUTUMN (tumbling leaves), GALAXY
// (twinkling stars + shooting stars), MATRIX (code rain), FOREST (a few fireflies). Drawn over the background, under
// the player, and kept off the disc and any open panel. Motion is tuned to the original 35ms tick.
import { colors, rgb } from './theme.js';

const COUNT = 140;
const MATRIX_COL = 16, MATRIX_TRAIL = 10;
const FIREFLIES = 18;
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
    this.glyphs = new Uint8Array(COUNT * MATRIX_TRAIL); // each column's digits, a few changed now and then
    this.sprites = null; // the digits (or a firefly's glow) drawn once, then copied: fillText 1400 times a frame cost
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
        // (spread wider than 16 px apart on a screen too wide for the columns there are)
        case 'MATRIX': this.x[i] = i * Math.max(MATRIX_COL, w / COUNT); this.y[i] = -R() * h - 20; this.speed[i] = 2 + R() * 4; break;
        // Fireflies keep low, under the trees: each wanders its own way and lights up now and then, for a moment.
        case 'FOREST': this.y[i] = h * (0.35 + 0.65 * R()); this.spin[i] = R() * Math.PI * 2; this.speed[i] = 0.35 + R() * 0.5; this.size[i] = 0.7 + R() * 0.6; break;
        default: break;
      }
    }
    for (let i = 0; i < this.glyphs.length; i++) this.glyphs[i] = Math.floor(R() * 10);
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
        for (let n = Math.round(12 * k); n > 0; n--) this.glyphs[Math.floor(Math.random() * this.glyphs.length)] = Math.floor(Math.random() * 10);
        break;
      case 'FOREST':
        for (let i = 0; i < FIREFLIES; i++) {
          this.spin[i] += (Math.sin(this.clock * 0.7 + this.phase[i] * 3) * 0.05) * k; // a slow, wavering heading
          this.x[i] += Math.cos(this.spin[i]) * this.speed[i] * 0.5 * k;
          this.y[i] += Math.sin(this.spin[i]) * this.speed[i] * 0.3 * k;
          if (this.x[i] < -20) this.x[i] = w + 20; else if (this.x[i] > w + 20) this.x[i] = -20;
          if (this.y[i] < h * 0.3) this.spin[i] = Math.abs(this.spin[i]) % Math.PI; // back down, under the canopy
          else if (this.y[i] > h + 10) this.spin[i] = -(Math.abs(this.spin[i]) % Math.PI);
        }
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
  // A sheet of `cols`×`rows` cells drawn once by `draw` at the screen's sharpness (again when `key` changes: the
  // theme's colour moving), and a way to copy cell (col, row) to x, y.
  sprite(name, key, draw, cell, cols, rows) {
    const dpr = window.devicePixelRatio || 1, full = `${name}|${key}|${dpr}`;
    if (!this.sprites || this.sprites.key !== full) {
      const c = new OffscreenCanvas(Math.ceil(cell.w * cols * dpr), Math.ceil(cell.h * rows * dpr)), s = c.getContext('2d');
      s.scale(dpr, dpr);
      draw(s, cell);
      const sw = cell.w * dpr, sh = cell.h * dpr;
      this.sprites = { key: full, draw: (g, col, row, x, y, w = cell.w, h = cell.h) => g.drawImage(c, col * sw, row * sh, sw, sh, x, y, w, h) };
    }
    return this.sprites;
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
        // Each column's first digit pale, the ones trailing it in the theme's colour, fading.
        const sheet = this.sprite('matrix', colors.accent.join(), (s, cell) => {
          s.font = 'bold 14px monospace'; s.textBaseline = 'alphabetic';
          for (let d = 0; d < 10; d++) {
            s.fillStyle = 'rgb(224,255,224)'; s.fillText(String(d), d * cell.w, 14);
            s.fillStyle = rgb(colors.accent); s.fillText(String(d), d * cell.w, 14 + cell.h);
          }
        }, { w: MATRIX_COL, h: 18 }, 10, 2);
        for (let i = 0; i < COUNT; i++) {
          if (this.x[i] > w) continue;
          for (let j = 0; j < MATRIX_TRAIL; j++) {
            const gy = this.y[i] - j * 16;
            if (gy < -16 || gy > h + 16) continue;
            g.globalAlpha = j === 0 ? 1 : Math.max(0, 200 - j * 22) / 255;
            sheet.draw(g, this.glyphs[i * MATRIX_TRAIL + j], j === 0 ? 0 : 1, this.x[i], gy - 14);
          }
        }
        g.globalAlpha = 1;
        break;
      }
      case 'FOREST': {
        const glow = this.sprite('firefly', '', (s, cell) => {
          const c = cell.w / 2, grad = s.createRadialGradient(c, c, 0, c, c, c);
          grad.addColorStop(0, 'rgba(250,255,210,1)'); grad.addColorStop(0.12, 'rgba(214,246,120,0.9)');
          grad.addColorStop(0.4, 'rgba(178,224,70,0.28)'); grad.addColorStop(1, 'rgba(160,214,60,0)');
          s.fillStyle = grad; s.fillRect(0, 0, cell.w, cell.h);
        }, { w: 28, h: 28 }, 1, 1);
        for (let i = 0; i < FIREFLIES; i++) {
          // lit a moment in every few seconds, at its own pace: a quick glow up, a slower fade
          const t = (this.clock * this.speed[i] * 2.2 + this.phase[i]) % (Math.PI * 2), on = t < 1.4 ? Math.sin((t / 1.4) * Math.PI) : 0;
          const a = 0.06 + 0.94 * on * on;
          if (a < 0.02) continue;
          const r = 14 * this.size[i] * (0.75 + 0.25 * on);
          g.globalAlpha = a;
          glow.draw(g, 0, 0, this.x[i] - r, this.y[i] - r, r * 2, r * 2);
        }
        g.globalAlpha = 1;
        break;
      }
      default: break;
    }
  }
}
