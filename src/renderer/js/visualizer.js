// Audio-reactive visualizer, drawn from the music's frequency spectrum — bass to treble — so each part of it
// follows its own slice of the music. Plain bars by default, or a themed scene (SNOW tree, GALAXY constellation,
// OCEAN waves, MATRIX rain, AUTUMN tree): full-screen and richly lit in Visualizer Mode (48 bands), and as a flat,
// minimal sketch of the same idea next to "NOW PLAYING" (16 bands). The Mini Mode window only gets five loudness
// levels over IPC, so it keeps a simple five-bar indicator (`spectrum: false`).
import { colors, rgb, darker } from './theme.js';

const COUNT = 5; // the five-level indicator's bars
const LIGHT_COLORS = [[232, 64, 64], [255, 205, 80], [96, 190, 255], [120, 220, 120], [255, 150, 220]];
const LEAF_COLORS = [[224, 122, 40], [200, 60, 46], [230, 176, 60], [180, 90, 40], [214, 140, 70]];
const MATRIX_GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BIG_BANDS = 48;
const SMALL_BANDS = 16;

// Small seeded random generator, so the scenes' layouts (stars, branches) are the same every time.
function seeded(seed) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

export class Visualizer {
  constructor(canvas, { big = false, spectrum = true } = {}) {
    this.canvas = canvas;
    this.big = big;
    this.useSpectrum = spectrum;
    this.mode = 'BARS';
    this.active = false;
    this.levels = new Array(COUNT).fill(0);
    this.n = big ? BIG_BANDS : SMALL_BANDS;
    this.spec = new Float32Array(this.n);   // smoothed spectrum, 0–1
    this.peaks = new Float32Array(this.n);  // the bars' falling peak markers
    this.ref = 0.5;                         // loudest recent band, for auto-gain
    this.scene = null;                      // cached layout of the current scene: { key, ... }
  }
  setMode(mode) { this.mode = mode; }
  setActive(on) { this.active = on; if (!on) this.levels.fill(0); }
  setLevels(fresh) { for (let i = 0; i < COUNT; i++) this.levels[i] = this.levels[i] * 0.35 + (fresh[i] || 0) * 0.65; }

  /**
   * A fresh spectrum of `this.n` bands (or null when nothing's playing, which lets it settle). Rises fast, falls
   * slower, and is scaled to the loudest recent moment so quiet and loud tracks both use the full range.
   */
  setSpectrum(fresh, dt) {
    const k = Math.min(1, dt / 16);
    let top = 0;
    if (fresh) for (let i = 0; i < this.n; i++) top = Math.max(top, fresh[i] || 0);
    this.ref = Math.max(0.45, top, this.ref * Math.pow(0.9994, dt));
    for (let i = 0; i < this.n; i++) {
      const v = fresh ? Math.min(1, (fresh[i] || 0) / this.ref) : 0, cur = this.spec[i];
      this.spec[i] = v > cur ? cur + (v - cur) * Math.min(1, 0.55 * k) : cur + (v - cur) * Math.min(1, 0.12 * k);
      this.peaks[i] = this.spec[i] >= this.peaks[i] ? this.spec[i] : Math.max(0, this.peaks[i] - 0.0009 * dt);
    }
  }
  band(i) { return this.spec[Math.max(0, Math.min(this.n - 1, i))]; }
  // The spectrum at a point across 0–1, blended between neighbouring bands so shapes that follow it stay smooth.
  bandAt(frac) {
    const x = Math.max(0, Math.min(this.n - 1, frac * (this.n - 1))), i = Math.floor(x);
    return this.band(i) + (this.band(i + 1) - this.band(i)) * (x - i);
  }
  // Element i of `count`, spread evenly over the bands (bass first).
  bandOf(i, count) { return this.band(Math.round((i / Math.max(1, count - 1)) * (this.n - 1))); }
  bass() { return this.rangeLevel(0, 0.125); }
  // Average of the bands between two points across 0–1.
  rangeLevel(from, to) {
    const i0 = Math.floor(from * this.n), i1 = Math.max(i0 + 1, Math.round(to * this.n));
    let s = 0;
    for (let i = i0; i < i1; i++) s += this.band(i);
    return s / (i1 - i0);
  }
  // A soft light: a bright core fading out into a glow. Radius in px.
  light(g, x, y, r, color, alpha) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${Math.min(1, alpha)})`);
    grad.addColorStop(0.18, rgb(color, Math.min(1, alpha)));
    grad.addColorStop(0.5, rgb(color, alpha * 0.35));
    grad.addColorStop(1, rgb(color, 0));
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  sceneFor(key, build) {
    if (!this.scene || this.scene.key !== key) this.scene = { key, ...build() };
    return this.scene;
  }

  draw(now) {
    const c = this.canvas, dpr = window.devicePixelRatio || 1;
    const { width: w, height: h } = c.getBoundingClientRect();
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!this.useSpectrum) { this.levelBars(g, w, h); return; }
    const scene = this.big
      ? { TREE: this.tree, CONSTELLATION: this.constellation, WAVES: this.waves, MATRIX_RAIN: this.matrix, LEAVES: this.leaves }[this.mode] || this.bars
      : { TREE: this.miniTree, CONSTELLATION: this.miniConstellation, WAVES: this.miniWaves, MATRIX_RAIN: this.miniMatrix, LEAVES: this.miniLeaves }[this.mode] || this.miniBars;
    scene.call(this, g, w, h, now);
  }

  // The Mini Mode window's indicator: five bars from five loudness levels.
  levelBars(g, w, h) {
    const barW = Math.max(4, Math.floor(w / 22)), gap = Math.max(3, Math.floor(w / 45));
    const total = COUNT * barW + (COUNT - 1) * gap, startX = Math.floor((w - total) / 2), arc = Math.max(1, barW / 8);
    for (let i = 0; i < COUNT; i++) {
      const level = this.active ? Math.max(0.1, this.levels[i]) : 0.1, bh = Math.max(2, Math.floor(level * h));
      g.fillStyle = rgb(i % 2 === 0 ? colors.accent : colors.accent2);
      g.beginPath(); g.roundRect(startX + i * (barW + gap), h - bh, barW, bh, arc); g.fill();
    }
  }

  // ---- Visualizer Mode (full screen) ------------------------------------------------------------------------------

  // The spectrum as bars, bass on the left: the theme's gradient, falling peak markers, and a faint reflection
  // under the baseline.
  bars(g, w, h) {
    const n = this.n, areaW = Math.min(w * 0.86, 1500), step = areaW / n, barW = step * 0.72;
    const left = (w - areaW) / 2 + (step - barW) / 2, base = h * 0.68, maxH = h * 0.52, radius = Math.min(barW / 2, 6);
    const grad = g.createLinearGradient(0, base - maxH, 0, base);
    grad.addColorStop(0, rgb(colors.accent2)); grad.addColorStop(1, rgb(colors.accent));
    const reflect = g.createLinearGradient(0, base, 0, base + maxH * 0.35);
    reflect.addColorStop(0, rgb(colors.accent, 0.22)); reflect.addColorStop(1, rgb(colors.accent, 0));
    for (let i = 0; i < n; i++) {
      const x = left + i * step, bh = Math.max(3, this.spec[i] * maxH);
      g.fillStyle = grad;
      g.beginPath(); g.roundRect(x, base - bh, barW, bh, [radius, radius, 0, 0]); g.fill();
      g.fillStyle = reflect;
      g.fillRect(x, base + 3, barW, bh * 0.35);
      g.fillStyle = rgb(colors.accent2, 0.9);
      g.fillRect(x, base - Math.max(3, this.peaks[i] * maxH) - 9, barW, 3);
    }
  }

  // SNOW: a big pine, its lights strung in rows — bass along the bottom, treble near the top — and a star that
  // swells with the bass.
  tree(g, w, h, now) {
    const H = Math.min(h * 0.82, w * 1.1), W = H * 0.66, cx = w / 2;
    const top = (h - H) / 2 + H * 0.04, trunkH = H * 0.1, bottom = (h + H) / 2 - trunkH, tiers = 3, tierH = (bottom - top) / tiers;
    const tier = (t) => ({ y0: top + (t * tierH * 3) / 5, y1: top + (t + 1) * tierH, half: ((W / 2) * (t + 2)) / (tiers + 1) });
    const halfAt = (y) => { let m = 0; for (let t = 0; t < tiers; t++) { const r = tier(t); if (y >= r.y0 && y <= r.y1) m = Math.max(m, (r.half * (y - r.y0)) / (r.y1 - r.y0)); } return m; };
    g.fillStyle = 'rgb(88,58,38)';
    g.fillRect(cx - W * 0.06, bottom - 1, W * 0.12, trunkH);
    const green = darker(colors.accent2);
    for (let t = 0; t < tiers; t++) {
      const r = tier(t), grad = g.createLinearGradient(cx - r.half, 0, cx + r.half, 0);
      grad.addColorStop(0, rgb(darker(green))); grad.addColorStop(0.5, rgb(green)); grad.addColorStop(1, rgb(darker(green)));
      g.fillStyle = grad;
      g.beginPath(); g.moveTo(cx, r.y0); g.lineTo(cx - r.half, r.y1); g.lineTo(cx + r.half, r.y1); g.closePath(); g.fill();
    }
    // Rows of lights, drooping like a garland, filled bottom-up with the spectrum.
    const rows = [11, 9, 7, 5, 3], lights = [];
    rows.forEach((count, row) => {
      const y = bottom - (row + 0.6) * ((bottom - top) / (rows.length + 0.9));
      const half = halfAt(y) * 0.84;
      for (let j = 0; j < count; j++) {
        const u = count === 1 ? 0.5 : j / (count - 1);
        lights.push([cx + (u * 2 - 1) * half, y + Math.sin(u * Math.PI) * tierH * 0.12]);
      }
    });
    const r0 = Math.max(4, H / 70);
    lights.forEach(([x, y], i) => {
      const lvl = this.bandOf(i, lights.length);
      this.light(g, x, y, r0 * (1.2 + lvl * 3.2), LIGHT_COLORS[i % LIGHT_COLORS.length], 0.35 + lvl * 0.65);
    });
    const bass = this.bass(), twinkle = 0.5 + 0.5 * Math.sin(now / 300);
    this.light(g, cx, top + r0, r0 * (3 + bass * 5 + twinkle), [255, 214, 90], 0.7 + bass * 0.3);
  }

  // GALAXY: a constellation of ~40 stars joined into a tree of lines — bass on the left, treble on the right. Stars
  // flare with their bands, and each line brightens with the two stars it joins.
  constellation(g, w, h, now) {
    const sc = this.sceneFor(`c${Math.round(w)}x${Math.round(h)}`, () => constellationLayout(40, 7, (a, r) => [w / 2 + Math.cos(a) * r * w * 0.4, h * 0.47 + Math.sin(a) * r * h * 0.34]));
    const lvl = sc.stars.map((_, i) => this.bandOf(i, sc.stars.length));
    g.lineWidth = 1.4;
    for (const [a, b] of sc.edges) {
      g.strokeStyle = rgb(colors.accent2, 0.15 + ((lvl[a] + lvl[b]) / 2) * 0.6);
      g.beginPath(); g.moveTo(...sc.stars[a]); g.lineTo(...sc.stars[b]); g.stroke();
    }
    const r0 = Math.max(3, Math.min(w, h) / 160);
    sc.stars.forEach(([x, y], i) => {
      const twinkle = 0.85 + 0.15 * Math.sin(now / 400 + i * 1.7);
      this.light(g, x, y, r0 * (1.5 + lvl[i] * 4.5) * twinkle, i % 2 ? colors.accent2 : colors.accent, 0.4 + lvl[i] * 0.6);
    });
  }

  // OCEAN: four wave layers — the back swell rides the bass, the front ripples the treble — and the front wave's
  // crest also follows the spectrum across the screen.
  waves(g, w, h, now) {
    const t = now / 1000, bases = [0.56, 0.64, 0.73, 0.82];
    const layers = [
      { bands: [0, 0.2], speed: 0.35, len: 1.1, color: mix(colors.accent2, [10, 20, 40], 0.45), alpha: 0.55 },
      { bands: [0.17, 0.42], speed: 0.55, len: 1.7, color: colors.accent2, alpha: 0.6 },
      { bands: [0.37, 0.67], speed: 0.8, len: 2.4, color: mix(colors.accent, colors.accent2, 0.5), alpha: 0.7 },
      { bands: [0.62, 1], speed: 1.1, len: 3.2, color: colors.accent, alpha: 0.85, follow: true },
    ];
    layers.forEach((L, k) => {
      const lvl = this.rangeLevel(L.bands[0], L.bands[1]), amp = h * (0.015 + lvl * 0.09), steps = 96, base = h * bases[k];
      g.beginPath();
      for (let p = 0; p <= steps; p++) {
        const u = p / steps, x = u * w;
        let y = base + Math.sin(u * Math.PI * 2 * L.len + t * L.speed * 2) * amp + Math.sin(u * Math.PI * 2 * L.len * 2.3 - t * L.speed * 3) * amp * 0.35;
        if (L.follow) y -= this.bandAt(u) * h * 0.07;
        p ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.lineTo(w, h); g.lineTo(0, h); g.closePath();
      const grad = g.createLinearGradient(0, base - h * 0.1, 0, h);
      grad.addColorStop(0, rgb(L.color, L.alpha)); grad.addColorStop(1, rgb(L.color, L.alpha * 0.25));
      g.fillStyle = grad; g.fill();
    });
  }

  // MATRIX: falling code rain across the screen. Every column belongs to a band: louder means it falls faster,
  // trails longer and glows brighter.
  matrix(g, w, h, now) {
    const size = Math.max(14, Math.round(Math.min(w, h) / 42)), cols = Math.floor(w / (size * 0.95));
    const sc = this.sceneFor(`m${cols}x${Math.round(h)}`, () => rainLayout(cols, h, now));
    const dt = Math.min(100, now - sc.last); sc.last = now;
    g.font = `bold ${size}px ui-monospace, Menlo, Consolas, monospace`;
    g.textAlign = 'center';
    const colW = w / cols;
    sc.drops.forEach((d, c) => {
      const lvl = this.bandAt(c / Math.max(1, cols - 1)), len = 5 + Math.round(lvl * 22);
      d.y += (0.05 + lvl * 0.5) * dt * (size / 18);
      if (d.y - len * size > h) { d.y = -sc.rand() * h * 0.3; }
      if (sc.rand() < 0.08) d.chars[Math.floor(sc.rand() * d.chars.length)] = MATRIX_GLYPHS[Math.floor(sc.rand() * MATRIX_GLYPHS.length)];
      const x = c * colW + colW / 2, head = Math.floor(d.y / size);
      for (let j = 0; j < len; j++) {
        const y = (head - j) * size;
        if (y < -size || y > h + size) continue;
        const fade = 1 - j / len, alpha = (0.18 + lvl * 0.82) * fade;
        g.fillStyle = j === 0 ? `rgba(225,255,230,${Math.min(1, 0.4 + lvl)})` : rgb(colors.accent, alpha);
        g.fillText(d.chars[(head - j + 400) % d.chars.length], x, y);
      }
    });
  }

  // AUTUMN: a branching tree whose ~40 leaves each follow a band (left to right, bass to treble): they swell,
  // brighten and sway with it.
  leaves(g, w, h, now) {
    const H = Math.min(h * 0.86, w * 0.95), cx = w / 2;
    const sc = this.sceneFor(`l${Math.round(w)}x${Math.round(h)}`, () => branchLayout(cx, (h + H) / 2, H * 0.3, Math.max(6, H / 30), 5));
    g.strokeStyle = 'rgb(92,60,38)'; g.lineCap = 'round';
    for (const [x1, y1, x2, y2, bw] of sc.branches) { g.lineWidth = bw; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
    const s0 = Math.max(6, H / 55);
    sc.tips.forEach(([x, y], i) => {
      const lvl = this.bandOf(i, sc.tips.length);
      const sway = Math.sin(now / 700 + i * 0.9) * (0.25 + lvl * 0.35), size = s0 * (0.8 + lvl * 1.4);
      g.save();
      g.translate(x, y); g.rotate(-0.6 + sway);
      g.fillStyle = rgb(LEAF_COLORS[i % LEAF_COLORS.length], 0.55 + lvl * 0.45);
      g.beginPath(); g.ellipse(0, 0, size, size * 0.55, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    });
  }

  // ---- Next to "NOW PLAYING": flat, minimal sketches of the same scenes -------------------------------------------

  // Ten slim bars growing up and down from the middle, in the theme's color.
  miniBars(g, w, h) {
    const n = 10, barW = 2.5, gap = (w - n * barW) / (n - 1), mid = h / 2;
    g.fillStyle = rgb(colors.accent);
    for (let i = 0; i < n; i++) {
      const bh = Math.max(barW, this.bandAt(i / (n - 1)) * (h - 2));
      g.beginPath(); g.roundRect(i * (barW + gap), mid - bh / 2, barW, bh, barW / 2); g.fill();
    }
  }
  // SNOW: a flat tree silhouette with a handful of lights that brighten with their bands.
  miniTree(g, w, h) {
    const H = h - 2, W = H * 0.72, cx = w / 2, top = 1;
    g.fillStyle = rgb(darker(colors.accent2));
    for (let t = 0; t < 3; t++) {
      const y0 = top + t * H * 0.22, y1 = top + H * (0.42 + t * 0.26), half = (W / 2) * (0.5 + t * 0.25);
      g.beginPath(); g.moveTo(cx, y0); g.lineTo(cx - half, y1); g.lineTo(cx + half, y1); g.closePath(); g.fill();
    }
    const spots = [[0, 0.88], [-0.55, 0.9], [0.55, 0.9], [-0.3, 0.62], [0.3, 0.62], [0, 0.36]];
    spots.forEach(([dx, dy], i) => {
      const lvl = this.bandOf(i, spots.length);
      g.fillStyle = rgb(LIGHT_COLORS[i % LIGHT_COLORS.length], 0.35 + lvl * 0.65);
      g.beginPath(); g.arc(cx + dx * W * 0.42, top + dy * H, 1 + lvl * 1.4, 0, Math.PI * 2); g.fill();
    });
  }
  // GALAXY: seven stars on thin lines; each star grows with its band.
  miniConstellation(g, w, h) {
    const sc = this.sceneFor(`mc${Math.round(w)}x${Math.round(h)}`, () => constellationLayout(7, 5, (a, r) => [w / 2 + Math.cos(a) * r * (w / 2 - 3), h / 2 + Math.sin(a) * r * (h / 2 - 3)]));
    g.lineWidth = 0.75; g.strokeStyle = rgb(colors.accent2, 0.35);
    g.beginPath();
    for (const [a, b] of sc.edges) { g.moveTo(...sc.stars[a]); g.lineTo(...sc.stars[b]); }
    g.stroke();
    g.fillStyle = rgb(colors.accent2);
    sc.stars.forEach(([x, y], i) => { g.beginPath(); g.arc(x, y, 0.9 + this.bandOf(i, sc.stars.length) * 1.8, 0, Math.PI * 2); g.fill(); });
  }
  // OCEAN: three thin wave lines — bass, mids, treble — rising and falling with their part of the music.
  miniWaves(g, w, h, now) {
    const t = now / 1000;
    [[0, 0.3, 1.2, 0.5], [0.3, 0.65, 2, 0.75], [0.65, 1, 2.8, 1]].forEach(([from, to, len, alpha], k) => {
      const amp = 1 + this.rangeLevel(from, to) * (h * 0.36), base = h * (0.3 + k * 0.2);
      g.strokeStyle = rgb(k === 2 ? colors.accent : colors.accent2, alpha); g.lineWidth = 1.25;
      g.beginPath();
      for (let p = 0; p <= 24; p++) {
        const u = p / 24, y = base + Math.sin(u * Math.PI * 2 * len + t * (1 + k)) * amp;
        p ? g.lineTo(u * w, y) : g.moveTo(u * w, y);
      }
      g.stroke();
    });
  }
  // MATRIX: a few columns of small falling dots; louder bands fall faster, with longer trails.
  miniMatrix(g, w, h, now) {
    const cols = 8, dot = 2, step = 3.5;
    const sc = this.sceneFor(`mm${Math.round(w)}x${Math.round(h)}`, () => rainLayout(cols, h, now));
    const dt = Math.min(100, now - sc.last); sc.last = now;
    const colW = w / cols;
    sc.drops.forEach((d, c) => {
      const lvl = this.bandAt(c / (cols - 1)), len = 2 + Math.round(lvl * 4);
      d.y += (0.01 + lvl * 0.05) * dt;
      if (d.y - len * step > h) d.y = -sc.rand() * h * 0.5;
      for (let j = 0; j < len; j++) {
        const y = d.y - j * step;
        if (y < -dot || y > h) continue;
        g.fillStyle = rgb(colors.accent, (0.3 + lvl * 0.7) * (1 - j / len));
        g.fillRect(c * colW + colW / 2 - dot / 2, y, dot, dot);
      }
    });
  }
  // AUTUMN: thin branches and a few small leaves that grow with their bands.
  miniLeaves(g, w, h, now) {
    const sc = this.sceneFor(`ml${Math.round(w)}x${Math.round(h)}`, () => branchLayout(w / 2, h, h * 0.42, 1.4, 3));
    g.strokeStyle = 'rgb(120,82,52)'; g.lineCap = 'round';
    for (const [x1, y1, x2, y2, bw] of sc.branches) { g.lineWidth = Math.max(0.6, bw); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
    sc.tips.forEach(([x, y], i) => {
      const lvl = this.bandOf(i, sc.tips.length), size = 1.2 + lvl * 1.8;
      g.fillStyle = rgb(LEAF_COLORS[i % LEAF_COLORS.length], 0.5 + lvl * 0.5);
      g.beginPath(); g.ellipse(x, y, size, size * 0.6, -0.6 + Math.sin(now / 700 + i) * 0.3, 0, Math.PI * 2); g.fill();
    });
  }
}

// ---- Scene layouts, built once per size ------------------------------------------------------------------------------

// `count` stars placed by `place(angle, radius 0–1)`, left to right, joined by a minimum spanning tree (Prim) —
// lines that look like drawn constellations, never a tangle.
function constellationLayout(count, seed, place) {
  const rand = seeded(seed), stars = [];
  for (let i = 0; i < count; i++) stars.push(place(rand() * Math.PI * 2, Math.sqrt(rand())));
  stars.sort((p, q) => p[0] - q[0]);
  const edges = [], inTree = [0], dist = stars.map((p) => Math.hypot(p[0] - stars[0][0], p[1] - stars[0][1])), from = stars.map(() => 0);
  while (inTree.length < stars.length) {
    let best = -1;
    for (let i = 0; i < stars.length; i++) if (!inTree.includes(i) && (best < 0 || dist[i] < dist[best])) best = i;
    edges.push([from[best], best]); inTree.push(best);
    for (let i = 0; i < stars.length; i++) { const d = Math.hypot(stars[i][0] - stars[best][0], stars[i][1] - stars[best][1]); if (d < dist[i]) { dist[i] = d; from[i] = best; } }
  }
  return { stars, edges };
}
// A tree grown from (x, y) upwards: branches [x1, y1, x2, y2, width] and leaf positions at the tips, left to right.
function branchLayout(x, y, trunk, width, depth) {
  const rand = seeded(11), branches = [], tips = [];
  const grow = (x1, y1, angle, len, bw, d) => {
    const x2 = x1 + Math.cos(angle) * len, y2 = y1 - Math.sin(angle) * len;
    branches.push([x1, y1, x2, y2, bw]);
    if (d === 0) { tips.push([x2, y2]); return; }
    const n = d > 3 ? 2 : 2 + (rand() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const spread = (i / (n - 1 || 1) - 0.5) * 1.1 + (rand() - 0.5) * 0.3;
      grow(x2, y2, angle + spread, len * (0.68 + rand() * 0.12), bw * 0.66, d - 1);
    }
  };
  grow(x, y, Math.PI / 2, trunk, width, depth);
  tips.sort((p, q) => p[0] - q[0]);
  return { branches, tips };
}
// Falling-code columns: where each drop is, and the characters it's made of.
function rainLayout(cols, h, now) {
  const rand = seeded(3);
  return { rand, last: now, drops: Array.from({ length: cols }, () => ({ y: -rand() * h, chars: Array.from({ length: 40 }, () => MATRIX_GLYPHS[Math.floor(rand() * MATRIX_GLYPHS.length)]) })) };
}
