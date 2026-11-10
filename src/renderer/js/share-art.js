// What the Now Playing card (share-card.js) and its videos (share-video.js) are both drawn from: quiet, the cover the
// hero, one face, and the one thing each PLAYER LOOK has of its own — the CD with the cover printed on it, the jewel
// case, a strip of bars, a strip of the deck's display. No props: no stickers, no labels shouting, no glows.
import { rgb, lerpColor, FONT, drawThemeImage, isLight } from './theme.js';
import { drawCells, LCD_INK } from './deck-display.js';

export const MONO = '"SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';
const MARKER = '"Marker Felt", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
const WHITE = [255, 255, 255], PAPER = [243, 241, 236];
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const ease = (x) => 1 - Math.pow(1 - clamp01(x), 3);
export const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
export const canvas = (w, h) => new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
// A colour bright enough to read on near-black (a theme's dark accent lifted towards white).
export const lit = (c, min = 0.5) => { let x = c; for (let i = 0; i < 10 && lum(x) < min; i++) x = lerpColor(x, WHITE, 0.15); return x; };
export const mmss = (s) => (Number.isFinite(s) && s >= 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '');

/** The same numbers for the same text each time (the grain of a song's card doesn't change between copies). */
export function seeded(text) {
  let h = 2166136261;
  for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

/**
 * The page a card or a film is on, from the theme: a dark theme's background with a little of the cover's own colour,
 * darkening down; a light theme's warm paper. → { light, top, bottom (colours), ink(a) (the words' colour), soft (a
 * shadow's colour, a light page's grey) }.
 */
export function paperOf(colors, mean) {
  const light = isLight(colors.bg);
  if (light) {
    const top = lerpColor(lerpColor(colors.bg, PAPER, 0.7), mean || PAPER, 0.04);
    return { light, top, bottom: lerpColor(top, [0, 0, 0], 0.04), ink: (a = 1) => rgb(lerpColor(colors.text, [20, 20, 22], 0.4), a), soft: (a) => `rgba(0,0,0,${(a * 0.4).toFixed(3)})` };
  }
  const tint = mean ? lerpColor(colors.bg, mean, 0.3) : colors.bg;
  const top = lerpColor(tint, [0, 0, 0], 0.55), bottom = lerpColor(tint, [0, 0, 0], 0.78);
  return { light, top, bottom, ink: (a = 1) => rgb(lerpColor(colors.text, WHITE, 0.5), a), soft: (a) => `rgba(0,0,0,${a})` };
}

// A tile of fine mono grain, made once.
let grainTile = null;
function grain() {
  if (grainTile) return grainTile;
  const n = 160, c = canvas(n, n), g = c.getContext('2d'), img = g.createImageData(n, n), rnd = seeded('grain');
  for (let i = 0; i < n * n; i++) { const v = rnd() < 0.5 ? 0 : 255; img.data.set([v, v, v, Math.round(rnd() * 255)], i * 4); }
  g.putImageData(img, 0, 0);
  return (grainTile = c);
}
/** The page: its two tones, the theme's own picture under them (heavily dimmed) where it has one, and a faint grain. */
export function ground(g, w, h, paper, backdrop = null) {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, rgb(paper.top)); gr.addColorStop(1, rgb(paper.bottom));
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  if (backdrop && backdrop.image) {
    g.save(); g.globalAlpha = paper.light ? 0.18 : 0.3; drawThemeImage(g, w, h, backdrop.image, backdrop); g.restore();
    g.fillStyle = paper.light ? `rgba(${paper.top.join(',')},0.4)` : 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, w, h);
  }
  addGrain(g, w, h, paper.light ? 0.035 : 0.05);
}
export function addGrain(g, w, h, alpha) {
  const tile = grain();
  g.save(); g.globalAlpha = alpha;
  for (let y = 0; y < h; y += tile.height) for (let x = 0; x < w; x += tile.width) g.drawImage(tile, x, y);
  g.restore();
}

/** The cover cropped square at `size`; none: a silver CD-R with the song's name written on it in marker. */
export function coverSquare(s, size) {
  const c = canvas(size, size), g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  if (s.cover) {
    const iw = s.cover.naturalWidth || s.cover.width, ih = s.cover.naturalHeight || s.cover.height, m = Math.min(iw, ih);
    g.drawImage(s.cover, (iw - m) / 2, (ih - m) / 2, m, m, 0, 0, size, size);
    return c;
  }
  const silver = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.7);
  silver.addColorStop(0, '#e9eaec'); silver.addColorStop(1, '#cfd2d6');
  g.fillStyle = silver; g.fillRect(0, 0, size, size);
  g.translate(size / 2, size / 2); g.rotate(-0.07);
  g.fillStyle = '#1a1a4e'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `${Math.round(size * 0.088)}px ${MARKER}`;
  const rows = wrapRows(g, String(s.title || ''), size * 0.8, 2);
  rows.forEach((l, i) => g.fillText(l, 0, (i - (rows.length - 1) / 2) * size * 0.107));
  return c;
}

/** The cover's average colour (null: unreadable). */
export function coverMean(s) {
  if (!s.cover) return null;
  try {
    const d = coverSquare(s, 16).getContext('2d').getImageData(0, 0, 16, 16).data;
    let r = 0, gr = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return [r / n, gr / n, b / n].map(Math.round);
  } catch { return null; }
}

/** Text broken between words into `max` rows at most no wider than `width`, the last cut short with "…". */
export function wrapRows(g, text, width, max) {
  const words = String(text || '').split(/\s+/).filter(Boolean), rows = [];
  let row = '';
  for (const w of words) {
    const next = row ? `${row} ${w}` : w;
    if (g.measureText(next).width <= width || !row) row = next;
    else { rows.push(row); row = w; }
  }
  if (row) rows.push(row);
  if (rows.length > max) { rows.length = max; rows[max - 1] = `${rows[max - 1]}…`; }
  return rows.map((r) => { let t = r; while (g.measureText(t).width > width && t.length > 1) t = `${t.slice(0, -2)}…`; return t; });
}

// ---- The disc --------------------------------------------------------------------------------------------------------

/** A CD with the cover printed on it, as a disc is: its rim, the mirror band and the clear ring round the hole. */
export function printedDisc(s, r) {
  const size = Math.ceil(r * 2), c = canvas(size, size), g = c.getContext('2d'), m = size / 2;
  g.save(); g.beginPath(); g.arc(m, m, r, 0, Math.PI * 2); g.clip();
  g.drawImage(coverSquare(s, size), 0, 0);
  g.restore();
  // The inner part isn't printed: a band of bare mirror, then clear plastic, then the hole.
  const band = g.createRadialGradient(m, m, r * 0.12, m, m, r * 0.36);
  band.addColorStop(0, '#d9dce0'); band.addColorStop(0.6, '#b9bec5'); band.addColorStop(1, '#e6e8eb');
  g.fillStyle = band; g.beginPath(); g.arc(m, m, r * 0.36, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = Math.max(1, r * 0.006); g.stroke();
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.arc(m, m, r * 0.27, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#000'; g.beginPath(); g.arc(m, m, r * 0.125, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = Math.max(1, r * 0.005);
  g.beginPath(); g.arc(m, m, r * 0.27, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(m, m, r - g.lineWidth, 0, Math.PI * 2); g.strokeStyle = 'rgba(255,255,255,0.45)'; g.stroke();
  return c;
}
/** The light on a disc, which stays put as it turns: a CD's rainbow where it catches the light, a soft highlight across. */
export function discLight(r, strength = 1) {
  const c = canvas(r * 2, r * 2), g = c.getContext('2d');
  g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.arc(r, r, r * 0.13, 0, Math.PI * 2, true); g.clip('evenodd');
  const bow = g.createConicGradient(-Math.PI / 4, r, r), hues = [[255, 80, 80], [255, 220, 80], [80, 255, 140], [80, 170, 255], [200, 90, 255]];
  for (const [from, to] of [[0.02, 0.16], [0.52, 0.66]]) {
    bow.addColorStop(from, 'rgba(255,255,255,0)');
    hues.forEach((h, k) => bow.addColorStop(from + ((to - from) * (k + 0.5)) / hues.length, `rgba(${h},${((0.32 - Math.abs(k - 2) * 0.05) * strength).toFixed(3)})`));
    bow.addColorStop(to, 'rgba(255,255,255,0)');
  }
  bow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = bow; g.fillRect(0, 0, r * 2, r * 2);
  const shine = g.createLinearGradient(0, 0, r * 2, r * 2);
  shine.addColorStop(0.3, 'rgba(255,255,255,0)'); shine.addColorStop(0.47, `rgba(255,255,255,${(0.16 * strength).toFixed(3)})`); shine.addColorStop(0.62, 'rgba(255,255,255,0)');
  g.fillStyle = shine; g.fillRect(0, 0, r * 2, r * 2);
  return c;
}
/** A disc's soft shadow, round, drawn once: → { canvas, pad }. */
export function discShadow(r, light = false) {
  const pad = r * 0.3, c = canvas(r * 2 + pad * 2, r * 2 + pad * 2), g = c.getContext('2d');
  g.shadowColor = light ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.55)'; g.shadowBlur = r * 0.1; g.shadowOffsetY = r * 0.04;
  g.beginPath(); g.arc(r + pad, r + pad, r - 1, 0, Math.PI * 2); g.arc(r + pad, r + pad, r * 0.13, 0, Math.PI * 2, true); g.fillStyle = '#0b0b0d'; g.fill('evenodd');
  return { canvas: c, pad };
}
/** The disc at (cx, cy), radius r, turned `turn`: the player's own disc face (`s.face`) where there is one. */
export function drawDisc(g, s, cx, cy, r, turn, parts) {
  g.drawImage(parts.shadow.canvas, cx - r - parts.shadow.pad, cy - r - parts.shadow.pad);
  g.save(); g.translate(cx, cy); g.rotate(turn); g.drawImage(parts.face, -r, -r, r * 2, r * 2); g.restore();
  g.save(); g.globalCompositeOperation = 'screen'; g.drawImage(parts.light, cx - r, cy - r); g.restore();
}
export function discParts(s, r, light) {
  return { face: s.face ? holed(s.face) : printedDisc(s, r), light: discLight(r, light ? 0.6 : 1), shadow: discShadow(r, light) };
}
// The player's disc face with its hole cut through (the player fills it with its own background; here the page shows).
function holed(face) {
  const c = canvas(face.width, face.height), g = c.getContext('2d'), m = face.width / 2;
  g.drawImage(face, 0, 0);
  g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(m, m, face.width / 22 + 1, 0, Math.PI * 2); g.fill();
  return c;
}

// ---- The jewel case ----------------------------------------------------------------------------------------------------

export const CASE_RATIO = 142 / 125; // a real one's, in mm

/** A shut jewel case from the front: the cover under the clear lid, the ribbed hinge down its left, one soft glare. */
export function caseFront(s, w, light = false) {
  const h = w / CASE_RATIO, c = canvas(w, h), g = c.getContext('2d'), band = w * 0.1, side = w * (120 / 142), top = (h - side) / 2;
  g.beginPath(); g.roundRect(0, 0, w, h, w * 0.008); g.clip();
  g.fillStyle = light ? '#e9ebee' : '#17181b'; g.fillRect(0, 0, w, h);
  g.drawImage(coverSquare(s, Math.round(side)), w - side - (h - side) / 2, top, side, side);
  const hinge = g.createLinearGradient(0, 0, band, 0);
  const tones = light ? ['#d3d7dc', '#ffffff', '#e1e4e8', '#cdd1d6'] : ['#0d0e10', '#34363b', '#1b1c20', '#0c0d0f'];
  tones.forEach((t, i) => hinge.addColorStop([0, 0.3, 0.62, 1][i], t));
  g.fillStyle = hinge; g.fillRect(0, 0, band, h);
  g.fillStyle = light ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.1)';
  for (let x = band * 0.2; x < band * 0.9; x += band * 0.17) g.fillRect(x, 0, Math.max(1, w * 0.002), h);
  g.fillStyle = light ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.42)'; g.fillRect(band, 0, w * 0.006, h);
  const glare = g.createLinearGradient(0, 0, w * 0.85, h);
  glare.addColorStop(0, 'rgba(255,255,255,0.16)'); glare.addColorStop(0.4, 'rgba(255,255,255,0.03)'); glare.addColorStop(0.41, 'rgba(255,255,255,0)');
  g.fillStyle = glare; g.fillRect(0, 0, w, h);
  g.strokeStyle = light ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.26)'; g.lineWidth = Math.max(2, w * 0.003); g.strokeRect(1, 1, w - 2, h - 2);
  return c;
}
/** Something drawn on a soft shadow (a case, a cover lying on the page): → { canvas, pad }. */
export function onShadow(w, h, light, draw, radius = 2) {
  const pad = Math.round(Math.max(w, h) * 0.08), c = canvas(w + pad * 2, h + pad * 2), g = c.getContext('2d');
  g.save(); g.shadowColor = light ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.5)'; g.shadowBlur = Math.max(w, h) * 0.045; g.shadowOffsetY = Math.max(w, h) * 0.018;
  g.beginPath(); g.roundRect(pad, pad, w, h, radius); g.fillStyle = light ? '#d8dbe0' : '#0b0b0d'; g.fill(); g.restore();
  g.save(); g.translate(pad, pad); draw(g); g.restore();
  return { canvas: c, pad };
}

// ---- The strips under the cover: VISUALIZER's bars, HI-FI's display -----------------------------------------------------

/** Bars across (x, y, w, h), one per value (0…1), quiet: those up to `played` (0…1 across) in full ink, the rest faint. */
export function bars(g, x, y, w, h, values, played, ink) {
  const n = values.length, step = w / n, bw = Math.max(2, step * 0.5);
  for (let i = 0; i < n; i++) {
    const v = Math.max(0.06, Math.min(1, values[i])), bh = Math.max(2, v * h);
    g.fillStyle = (i + 0.5) / n <= played ? ink(0.9) : ink(0.28);
    g.fillRect(x + i * step + (step - bw) / 2, y + (h - bh) / 2, bw, bh);
  }
}
/** `n` values from a waveform's buckets (or quiet even ones, made up from the song's name, when there's none). */
export function barValues(waveform, n, seedText) {
  if (waveform && waveform.length) {
    const out = [], most = Math.max(1e-6, ...waveform);
    for (let i = 0; i < n; i++) {
      const a = Math.floor((i / n) * waveform.length), b = Math.max(a + 1, Math.floor(((i + 1) / n) * waveform.length));
      let m = 0; for (let k = a; k < b; k++) m = Math.max(m, waveform[k] || 0);
      out.push(m / most);
    }
    return out;
  }
  const rnd = seeded(seedText);
  return Array.from({ length: n }, () => 0.35 + rnd() * 0.45);
}

/**
 * The deck's display as a strip, (x, y, w, h): a light theme's grey-green LCD with dark digits, a dark theme's black
 * glass with lit ones in its colour. TRK and the track's number at the left, the time at the right (whichever known).
 * → the glass's inner box { x, y, w, h } and its digits' colour, to draw more in it.
 */
export function deckStrip(g, x, y, w, h, colors, { track, time }) {
  const light = isLight(colors.bg), color = light ? LCD_INK : lit(colors.accent, 0.55), r = Math.min(10, h * 0.16);
  g.save();
  g.beginPath(); g.roundRect(x, y, w, h, r);
  const glass = g.createLinearGradient(0, y, 0, y + h);
  glass.addColorStop(0, light ? 'rgb(194,206,187)' : '#0e0f11'); glass.addColorStop(1, light ? 'rgb(181,195,174)' : '#050506');
  g.fillStyle = glass; g.fill();
  g.strokeStyle = light ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)'; g.lineWidth = 2; g.stroke();
  g.restore();
  const pad = Math.round(h * 0.22), digit = Math.min(h - pad * 2, 64);
  const row = { x: x + pad, y: y + (Math.min(h, digit + pad * 2) - digit) / 2, h: digit };
  const ink = rgb(color), ghost = rgb(color, light ? 0.08 : 0.07);
  g.save();
  if (!light) { g.shadowColor = rgb(color, 0.6); g.shadowBlur = Math.round(digit * 0.25); }
  if (track) {
    g.font = `700 ${Math.round(digit * 0.3)}px ${FONT}`; g.fillStyle = ink; g.textBaseline = 'top'; g.letterSpacing = '2px';
    g.fillText('TRK', row.x, row.y);
    const lw = g.measureText('TRK ').width; g.letterSpacing = '0px';
    g.save(); g.translate(row.x + lw, row.y); drawCells(g, String(track).padStart(2, '0'), digit, ink, ghost); g.restore();
  }
  if (time) {
    const tw = [...time].reduce((sum, ch) => sum + (ch === ':' ? digit * 0.32 : digit * 0.72), 0) - digit * 0.16;
    g.save(); g.translate(x + w - pad - tw, row.y); drawCells(g, time, digit, ink, ghost); g.restore();
  }
  g.restore();
  return { inner: { x: x + pad, y: y + pad, w: w - pad * 2, h: h - pad * 2 }, color, light };
}

// ---- The words ----------------------------------------------------------------------------------------------------------

/**
 * The names, at (x, y) (their top), `w` wide: the title, the artist the same size and fainter, "Album · Year" small and
 * fainter still. `size`: the title's. → the height they took.
 */
export function names(g, s, x, y, w, size, ink, { titleRows = 2, font = FONT, subtitle = true, dry = false } = {}) {
  g.save(); g.textBaseline = 'top'; g.textAlign = 'left';
  const put = dry ? () => {} : (t, tx, ty) => g.fillText(t, tx, ty);
  const lead = Math.round(size * 1.22);
  let at = y;
  g.font = `600 ${size}px ${font}`; g.fillStyle = ink(0.96);
  for (const row of wrapRows(g, s.title || '', w, titleRows)) { put(row, x, at); at += lead; }
  if (s.artist) { g.font = `400 ${size}px ${font}`; g.fillStyle = ink(0.55); put(wrapRows(g, s.artist, w, 1)[0], x, at); at += lead; }
  if (subtitle && s.subtitle) {
    const small = Math.round(size * 0.52);
    at += Math.round(size * 0.18);
    g.font = `400 ${small}px ${font}`; g.fillStyle = ink(0.38); put(wrapRows(g, s.subtitle, w, 1)[0], x, at); at += Math.round(small * 1.3);
  }
  g.restore();
  return at - y;
}
/** How tall `names` would be, without drawing. */
export const namesHeight = (g, s, w, size, opts = {}) => names(g, s, 0, 0, w, size, () => '', { ...opts, dry: true });
/** "cdplayer", small and faint, its right end at (x, y) (the baseline). */
export function credit(g, x, y, ink, size = 22, font = FONT) {
  g.save(); g.font = `500 ${size}px ${font}`; g.fillStyle = ink(0.36); g.textAlign = 'right'; g.textBaseline = 'alphabetic';
  g.fillText('cdplayer', x, y); g.restore();
}
