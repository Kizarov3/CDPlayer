// Themes: palette definitions, the live (possibly mid-transition) colors every canvas reads each frame, the
// animated color transition, and AUTO's palette derivation from album art.

const t = (name, bg, card, accent, accent2, text, muted) => ({ name, bg, card, accent, accent2, text, muted });
export const THEMES = [
  t('RED', [17, 17, 19], [31, 31, 34], [196, 20, 28], [180, 186, 194], [232, 233, 236], [138, 142, 148]),
  t('BLUE', [6, 10, 22], [13, 19, 36], [46, 116, 255], [150, 210, 255], [232, 240, 250], [120, 134, 160]),
  t('SUNSET', [24, 15, 18], [38, 24, 28], [255, 106, 61], [255, 71, 133], [250, 238, 230], [176, 148, 142]),
  t('FOREST', [11, 17, 14], [20, 30, 24], [52, 199, 123], [178, 214, 58], [230, 240, 228], [128, 148, 130]),
  t('GALAXY', [7, 7, 18], [14, 14, 30], [150, 120, 255], [90, 200, 255], [238, 236, 250], [140, 140, 172]),
  t('OCEAN', [4, 14, 20], [9, 24, 33], [40, 190, 210], [60, 130, 220], [226, 246, 250], [110, 152, 166]),
  t('MATRIX', [4, 8, 5], [9, 15, 10], [64, 230, 120], [140, 255, 170], [214, 250, 224], [96, 140, 108]),
  t('AUTUMN', [20, 12, 8], [34, 21, 14], [224, 122, 40], [200, 60, 46], [250, 236, 220], [168, 132, 108]),
  t('SNOW', [14, 16, 20], [23, 26, 30], [214, 44, 54], [46, 168, 96], [248, 248, 250], [152, 154, 160]),
  // AUTO's colors are placeholders, always replaced by deriveAutoTheme() before being shown.
  t('AUTO', [10, 10, 12], [18, 18, 21], [150, 150, 160], [190, 190, 200], [232, 232, 236], [140, 140, 148]),
];
const KEYS = ['bg', 'card', 'accent', 'accent2', 'text', 'muted'];

/** The colors on screen right now — canvases read these every frame, so they follow a transition smoothly. */
export const colors = { bg: [...THEMES[0].bg], card: [...THEMES[0].card], accent: [...THEMES[0].accent], accent2: [...THEMES[0].accent2], text: [...THEMES[0].text], muted: [...THEMES[0].muted] };
export const rgb = (c, a = 1) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
export const lerpColor = (a, b, f) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * f));
export const darker = (c) => c.map((v) => Math.floor(v * 0.7)); // java.awt.Color.darker()

const listeners = new Set();
export function onColorsChanged(fn) { listeners.add(fn); }

function applyColors() {
  const style = document.documentElement.style;
  for (const k of KEYS) style.setProperty(`--${k}`, colors[k].join(', '));
  for (const fn of listeners) fn();
}

let transition = null;
/** Animates every theme color over 150ms (or jumps, with animations off). */
export function setColors(target, animate) {
  if (transition) cancelAnimationFrame(transition.raf);
  transition = null;
  if (!animate) {
    for (const k of KEYS) colors[k] = [...target[k]];
    applyColors();
    return;
  }
  const from = Object.fromEntries(KEYS.map((k) => [k, [...colors[k]]]));
  const start = performance.now();
  const step = (now) => {
    const f = Math.min(1, (now - start) / 150);
    for (const k of KEYS) colors[k] = lerpColor(from[k], target[k], f);
    applyColors();
    if (f < 1) transition.raf = requestAnimationFrame(step);
    else transition = null;
  };
  transition = { raf: requestAnimationFrame(step) };
}

// ---- AUTO: palette from album art ---------------------------------------------------------------------------

function rgbToHsb(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const bri = max / 255, sat = max === 0 ? 0 : (max - min) / max;
  let hue = 0;
  if (sat !== 0) {
    const rc = (max - r) / (max - min), gc = (max - g) / (max - min), bc = (max - b) / (max - min);
    hue = r === max ? bc - gc : g === max ? 2 + rc - bc : 4 + gc - rc;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  return [hue, sat, bri];
}
function hsbToRgb(h, s, v) {
  if (s === 0) { const c = Math.floor(v * 255 + 0.5); return [c, c, c]; }
  const hh = (h - Math.floor(h)) * 6, f = hh - Math.floor(hh);
  const p = v * (1 - s), q = v * (1 - s * f), tt = v * (1 - s * (1 - f));
  const [r, g, b] = [[v, tt, p], [q, v, p], [p, v, tt], [p, q, v], [tt, p, v], [v, p, q]][Math.floor(hh)];
  return [r, g, b].map((x) => Math.floor(x * 255 + 0.5));
}

// Median-cut quantization over the sampled colors: repeatedly split the most populous box along its widest channel.
function medianCut(counts, maxSwatches) {
  const boxes = [[...counts].map(([rgbInt, n]) => [(rgbInt >> 16) & 255, (rgbInt >> 8) & 255, rgbInt & 255, n])];
  while (boxes.length < maxSwatches) {
    let split = -1, splitPop = -1;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const pop = box.reduce((s, c) => s + c[3], 0);
      if (pop > splitPop) { splitPop = pop; split = i; }
    });
    if (split < 0) break;
    const box = boxes[split];
    const range = (ch) => Math.max(...box.map((c) => c[ch])) - Math.min(...box.map((c) => c[ch]));
    const [rr, gr, br] = [range(0), range(1), range(2)];
    const ch = rr >= gr && rr >= br ? 0 : gr >= br ? 1 : 2;
    box.sort((a, b) => a[ch] - b[ch]);
    const total = box.reduce((s, c) => s + c[3], 0);
    let cumulative = 0, cut = box.length - 1;
    for (let i = 0; i < box.length; i++) { cumulative += box[i][3]; if (cumulative >= total / 2) { cut = i; break; } }
    if (cut >= box.length - 1) cut = box.length - 2;
    boxes.splice(split, 1, box.slice(0, cut + 1), box.slice(cut + 1));
  }
  return boxes.map((box) => {
    let r = 0, g = 0, b = 0, pop = 0;
    for (const c of box) { r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; pop += c[3]; }
    return pop ? { rgb: [Math.floor(r / pop), Math.floor(g / pop), Math.floor(b / pop)], population: pop } : null;
  }).filter(Boolean);
}

/**
 * AUTO theme from a cover image: sample a 48×48 grid, drop grays/near-black/near-white, median-cut into swatches,
 * then favour populous *and* saturated swatches — so a small, vivid logo on an otherwise gray photo still wins.
 */
export function deriveAutoTheme(image) {
  let hue = 0.58, sat = 0.55, hue2 = null, monochrome = false;
  if (image && image.width) {
    const w = image.width, h = image.height;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    const stepX = Math.max(1, Math.floor(w / 48)), stepY = Math.max(1, Math.floor(h / 48));
    const counts = new Map();
    let total = 0, qualifying = 0;
    for (let y = 0; y < h; y += stepY) {
      for (let x = 0; x < w; x += stepX) {
        total++;
        const o = (y * w + x) * 4;
        const [r, g, b] = [data[o], data[o + 1], data[o + 2]];
        const [, s, v] = rgbToHsb(r, g, b);
        if (s < 0.2 || v < 0.12 || v > 0.95) continue;
        qualifying++;
        const key = (r << 16) | (g << 8) | b;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    if (counts.size && qualifying >= total * 0.05) {
      const swatches = medianCut(counts, 16);
      let totalPop = 0;
      const scored = [];
      for (const sw of swatches) {
        const [h2, s2] = rgbToHsb(...sw.rgb);
        totalPop += sw.population;
        if (s2 < 0.2) continue;
        scored.push({ score: sw.population * Math.pow(s2, 1.5), hue: h2, sat: s2, pop: sw.population });
      }
      if (scored.length) {
        scored.sort((a, b) => b.score - a.score);
        hue = scored[0].hue;
        sat = Math.max(0.6, Math.min(0.95, scored[0].sat));
        for (const cand of scored.slice(1)) {
          let diff = Math.abs(cand.hue - hue);
          if (diff > 0.5) diff = 1 - diff;
          if (diff < 0.12 || cand.pop < totalPop * 0.08) continue;
          hue2 = cand.hue;
          break;
        }
      } else { monochrome = true; sat = 0.05; }
    } else { monochrome = true; sat = 0.05; }
  }
  const accent2Hue = hue2 != null ? hue2 : (hue + 0.06) % 1;
  return t('AUTO',
    hsbToRgb(hue, Math.min(0.55, sat * 0.6), 0.06),
    hsbToRgb(hue, Math.min(0.5, sat * 0.55), 0.12),
    hsbToRgb(hue, sat, 0.72),
    hsbToRgb(accent2Hue, monochrome ? sat : Math.max(0.25, sat * 0.55), 0.85),
    hsbToRgb(hue, 0.04, 0.93),
    hsbToRgb(hue, 0.1, 0.58));
}

export const visualizerModeFor = (name) => ({ SNOW: 'TREE', GALAXY: 'CONSTELLATION', OCEAN: 'WAVES', MATRIX: 'MATRIX_RAIN', AUTUMN: 'LEAVES' }[name] || 'BARS');
export const particleModeFor = (name) => (['SNOW', 'GALAXY', 'OCEAN', 'MATRIX', 'AUTUMN'].includes(name) ? name : 'NONE');

export const FONT = '"Lucida Grande", "Segoe UI", "DejaVu Sans", "Helvetica Neue", Arial, sans-serif';
