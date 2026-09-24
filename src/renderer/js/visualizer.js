// Audio-reactive visualizer: five bars by default, or a themed shape (SNOW tree, GALAXY constellation, OCEAN
// waves, MATRIX rain, AUTUMN branch) driven by the same five levels. One class draws both the small one next to
// "NOW PLAYING" and the big one in Visualizer Mode.
import { colors, rgb, darker } from './theme.js';

const COUNT = 5;
const LIGHT_COLORS = [[232, 64, 64], [255, 205, 80], [96, 190, 255], [120, 220, 120], [255, 150, 220]];
const LEAF_COLORS = [[224, 122, 40], [200, 60, 46], [230, 176, 60], [180, 90, 40], [214, 140, 70]];
const LIGHT_POSITIONS = [[0.3, 0.42], [0.68, 0.42], [0.22, 0.64], [0.78, 0.64], [0.5, 0.82]];
const STAR_POSITIONS = [[0.1, 0.6], [0.32, 0.3], [0.54, 0.58], [0.76, 0.28], [0.94, 0.55]];

export class Visualizer {
  constructor(canvas, { big = false } = {}) {
    this.canvas = canvas;
    this.big = big;
    this.mode = 'BARS';
    this.active = false;
    this.levels = new Array(COUNT).fill(0);
  }
  setMode(mode) {
    this.mode = mode;
    if (!this.big) this.canvas.classList.toggle('custom', mode !== 'BARS');
  }
  setActive(on) { this.active = on; if (!on) this.levels.fill(0); }
  setLevels(fresh) { for (let i = 0; i < COUNT; i++) this.levels[i] = this.levels[i] * 0.35 + (fresh[i] || 0) * 0.65; }
  level(i) { const floor = this.mode === 'TREE' || this.mode === 'LEAVES' ? 0.12 : 0.1; return this.active ? Math.max(floor, this.levels[i]) : floor; }

  draw(now) {
    const c = this.canvas, dpr = window.devicePixelRatio || 1;
    let { width: w, height: h } = c.getBoundingClientRect();
    if (!w || !h) return;
    // Big custom shapes are drawn in a centered square so the tree/constellation keep their proportions.
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (this.big && this.mode !== 'BARS' && this.mode !== 'WAVES') {
      const s = Math.min(w, h, 780);
      g.translate((w - s) / 2, (h - s) / 2);
      w = h = s;
    } else if (this.big && this.mode === 'BARS') {
      const bw = Math.min(w, 900), bh = Math.min(h, 420);
      g.translate((w - bw) / 2, (h - bh) / 2);
      w = bw; h = bh;
    }
    this.w = w; this.h = h;
    const draw = { TREE: this.tree, CONSTELLATION: this.constellation, WAVES: this.waves, MATRIX_RAIN: this.matrix, LEAVES: this.leaves }[this.mode] || this.bars;
    draw.call(this, g, w, h, now);
  }

  sizeScale() { return Math.sqrt(Math.min(this.w, this.h) / 32); }
  glow(g, cx, cy, level, base) {
    const r = (1.4 + level * 3.2) * this.sizeScale();
    g.fillStyle = rgb(base, Math.min(255, 110 + level * 145) / 255);
    g.beginPath(); g.ellipse(cx, cy, r, r, 0, 0, Math.PI * 2); g.fill();
  }

  bars(g, w, h) {
    const barW = Math.max(4, Math.floor(w / 22)), gap = Math.max(3, Math.floor(w / 45));
    const total = COUNT * barW + (COUNT - 1) * gap, startX = Math.floor((w - total) / 2), arc = Math.max(1, barW / 8);
    for (let i = 0; i < COUNT; i++) {
      const bh = Math.max(2, Math.floor(this.level(i) * h));
      g.fillStyle = rgb(i % 2 === 0 ? colors.accent : colors.accent2);
      g.beginPath(); g.roundRect(startX + i * (barW + gap), h - bh, barW, bh, arc); g.fill();
    }
  }
  tree(g, w, h) {
    const cx = w / 2, trunkW = Math.max(3, w / 8), trunkH = Math.max(3, h / 7);
    g.fillStyle = 'rgb(96,62,40)';
    g.fillRect(cx - trunkW / 2, h - trunkH, trunkW, trunkH);
    const tiers = 3, topY = 1, bottomY = h - trunkH + 1, tierH = (bottomY - topY) / tiers;
    g.fillStyle = rgb(darker(colors.accent2));
    for (let t = 0; t < tiers; t++) {
      const tierTop = topY + (t * tierH * 3) / 5, tierBottom = topY + (t + 1) * tierH + (t === tiers - 1 ? 2 : 0);
      const half = ((w / 2) * (t + 2)) / (tiers + 1);
      g.beginPath(); g.moveTo(cx, tierTop); g.lineTo(cx - half, tierBottom); g.lineTo(cx + half, tierBottom); g.closePath(); g.fill();
    }
    const star = 4 * this.sizeScale();
    g.fillStyle = 'rgb(255,214,90)';
    g.beginPath(); g.ellipse(cx, topY - 1 + star / 2, star / 2, star / 2, 0, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < COUNT; i++) this.glow(g, LIGHT_POSITIONS[i][0] * w, LIGHT_POSITIONS[i][1] * h, this.level(i), LIGHT_COLORS[i]);
  }
  constellation(g, w, h) {
    const xs = STAR_POSITIONS.map((p) => p[0] * w), ys = STAR_POSITIONS.map((p) => p[1] * h);
    let avg = 0;
    for (let i = 0; i < COUNT; i++) avg += this.level(i);
    avg /= COUNT;
    g.lineWidth = this.sizeScale();
    g.strokeStyle = rgb(colors.accent2, (60 + avg * 140) / 255);
    g.beginPath();
    for (let i = 0; i < COUNT; i++) i ? g.lineTo(xs[i], ys[i]) : g.moveTo(xs[i], ys[i]);
    g.stroke();
    for (let i = 0; i < COUNT; i++) this.glow(g, xs[i], ys[i], this.level(i), i % 2 === 0 ? colors.accent : colors.accent2);
  }
  waves(g, w, h, now) {
    const t = (now * 1e6) / 4e8;
    this.waveLayer(g, w, h, t, 0.8, colors.accent2, 110);
    this.waveLayer(g, w, h, t + 1.7, 0.92, colors.accent, 170);
  }
  waveLayer(g, w, h, t, baseline, color, alpha) {
    const segments = COUNT, total = segments * 6 + 1;
    g.fillStyle = rgb(color, alpha / 255);
    g.beginPath();
    for (let p = 0; p < total; p++) {
      const frac = p / (total - 1), segPos = frac * segments - 0.5;
      const a = Math.max(0, Math.min(segments - 1, Math.floor(segPos))), b = Math.min(segments - 1, a + 1);
      const blend = Math.max(0, Math.min(1, segPos - Math.floor(segPos)));
      const lvl = this.level(a) + (this.level(b) - this.level(a)) * blend;
      const amp = 0.6 + lvl * (h * 0.075);
      const y = h * baseline + Math.sin(frac * Math.PI * 1.6 + t) * amp;
      p ? g.lineTo(frac * w, y) : g.moveTo(frac * w, y);
    }
    g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.fill();
  }
  matrix(g, w, h) {
    const colW = w / COUNT;
    g.font = `bold ${Math.max(8, Math.floor(colW))}px monospace`;
    g.textAlign = 'center';
    for (let i = 0; i < COUNT; i++) {
      const lvl = this.level(i), glyphs = 1 + Math.floor(lvl * 4), cx = i * colW + colW / 2;
      for (let j = 0; j < glyphs; j++) {
        const alpha = Math.max(40, 255 - j * 70);
        g.fillStyle = rgb(colors.accent, Math.min(255, alpha * (0.5 + lvl * 0.6)) / 255);
        g.fillText(String(Math.floor(Math.random() * 10)), cx, h - j * (h / 6) - 3);
      }
    }
  }
  leaves(g, w, h) {
    const cx = w / 2;
    g.strokeStyle = 'rgb(96,62,40)';
    g.lineWidth = Math.max(1.5, w * 0.05);
    g.beginPath();
    g.moveTo(cx, h - 2); g.lineTo(cx, h * 0.25);
    g.moveTo(cx, h * 0.55); g.lineTo(w * 0.18, h * 0.35);
    g.moveTo(cx, h * 0.45); g.lineTo(w * 0.82, h * 0.28);
    g.stroke();
    for (let i = 0; i < COUNT; i++) {
      const lx = LIGHT_POSITIONS[i][0] * w, ly = LIGHT_POSITIONS[i][1] * h, lvl = this.level(i);
      const size = (2.2 + lvl * 3.6) * this.sizeScale();
      g.fillStyle = rgb(LEAF_COLORS[i], Math.min(255, 140 + lvl * 115) / 255);
      g.beginPath(); g.ellipse(lx, ly, size, size * 0.7, 0, 0, Math.PI * 2); g.fill();
    }
  }
}

/**
 * Beat detection — "energy vs. its own rolling average": broadband loudness spiking 40% above its last ~1.7s
 * average counts as a beat, which pulses the visualizer. Decays over about half a second.
 */
export class BeatDetector {
  constructor() { this.history = new Float64Array(106); this.index = 0; this.pulse = 0; }
  update(levels, dt) {
    const energy = levels.reduce((s, v) => s + v, 0) / levels.length;
    const avg = this.history.reduce((s, v) => s + v, 0) / this.history.length;
    const beat = energy > 0.015 && energy > avg * 1.4;
    this.history[this.index] = energy;
    this.index = (this.index + 1) % this.history.length;
    this.pulse = beat ? 1 : Math.max(0, this.pulse - ((0.15 * 16) / 70) * (dt / 16));
    return this.pulse > 0 ? levels.map((v) => Math.min(1, v * (1 + this.pulse * 0.6))) : levels;
  }
}
