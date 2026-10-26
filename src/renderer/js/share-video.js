// The Now Playing card as a video (the card's VIDEO 9:16 and VIDEO 1:1): the song's lines as they're sung, its name,
// and the song itself, for as long as the lines picked on the card are sung (eight seconds from where it's playing, with
// none). Recorded as it happens, from a canvas and the audio engine, as MP4 (or WebM where MP4 can't be made).
// Each PLAYER LOOK is its own film, moved by the music and the words rather than dressed up:
//   CLASSIC — the disc slides out of its case and spins up, the camera creeping in; the lyrics set like liner notes.
//   ALBUM — the cover big and drifting slowly over a field of its own colours; the words light up as they're sung.
//   HI-FI — the deck's black glass display is the stage: the lyrics lit in its dots, the meters on the real levels.
//   VISUALIZER — the cover breathing on the bass inside a ring of the music's own spectrum; the line pulsing with it.
//   LYRICS — the words, big, landing one by one as they're sung, the line swept away for the next; the cover a blur.
import { rgb, lerpColor, FONT, drawThemeImage } from './theme.js';
import { drawCells, clock } from './deck-display.js';
import { lineWords, songPace } from './lyrics.js';
import { t } from './i18n.js';

export const VIDEO_SECONDS = 8, MIN_VIDEO_SECONDS = 2, MAX_VIDEO_SECONDS = 60;
const FPS = 30;

/** Where CLASSIC's things stand in a '9:16' (Stories) or '1:1' video: { w, h, case, disc: { x, y, r }, names, lyrics }. */
export function videoLayout(format) {
  if (format === '9:16') {
    return { w: 1080, h: 1920, case: { x: 100, y: 450, w: 560, h: 560 }, disc: { x: 650, y: 530, r: 360 },
      names: { x: 100, y: 1110, w: 880, h: 130 }, lyrics: { x: 100, y: 1270, w: 880, h: 420 } };
  }
  return { w: 1080, h: 1080, case: { x: 70, y: 470, w: 400, h: 400 }, disc: { x: 340, y: 410, r: 245 },
    names: { x: 620, y: 200, w: 400, h: 150 }, lyrics: { x: 620, y: 380, w: 400, h: 560 } };
}

/**
 * The lines on screen `t` seconds into the song (timed lyrics, [{ time, text }]): the one being sung, and the next —
 * and, to glide from one to the other, the line sung before it (null: none, or a break) and how long ago it changed.
 */
export function lyricsAt(timed, t) {
  let at = -1;
  for (let i = 0; i < timed.length && timed[i].time <= t; i++) at = i;
  const said = (i) => (i >= 0 && String(timed[i].text || '').trim() ? timed[i].text : null);
  const after = timed.slice(at + 1).find((l) => String(l.text || '').trim());
  return { current: said(at), next: after ? after.text : null, previous: said(at - 1), since: at >= 0 ? t - timed[at].time : Infinity };
}

/**
 * The lines with words, each word timed as it's sung: [{ time, end, text, words: [{ time, stop, text, parts }] }] —
 * `end` when the next timed line (or break) starts; a word's `parts` the pieces enhanced LRC times on their own (the
 * syllables of "beau-ti-ful"), each { time, stop, text }. Lines timed as a whole share their time out by syllables.
 */
export function lyricLines(timed) {
  const pace = songPace(timed), lines = [];
  timed.forEach((l, i) => {
    if (!String(l.text || '').trim()) return;
    const end = timed[i + 1] ? timed[i + 1].time : l.time + 10;
    const parts = lineWords(l, end, pace), words = [];
    let word = null;
    parts.forEach((p, k) => {
      const stop = p.end !== undefined ? p.end : k + 1 < parts.length ? parts[k + 1].time : Math.min(end, p.time + 1.2);
      if (!word) words.push(word = { parts: [], text: '' });
      const text = p.text.replace(/\s+$/, '');
      if (text) { word.parts.push({ time: p.time, stop: Math.max(stop, p.time + 0.05), text }); word.text += text; }
      if (/\s$/.test(p.text) || k === parts.length - 1) word = null;
    });
    const timedWords = words.filter((w) => w.parts.length).map((w) => ({ ...w, time: w.parts[0].time, stop: w.parts[w.parts.length - 1].stop }));
    if (timedWords.length) lines.push({ time: l.time, end, text: l.text, words: timedWords });
  });
  return lines;
}

/**
 * The stretch of the song a video covers, in lyric time: from the first of the picked lines (indexes among the lines
 * with words, as the card lists them) to where the last one ends — when the next timed line starts, or the song does
 * (`songEnd`, s). 2 s at least, a minute at most. → { start, end } | null (no line picked).
 */
export function videoSpan(timed, picked, songEnd) {
  const said = timed.map((_, i) => i).filter((i) => String(timed[i].text || '').trim());
  const at = picked.filter((i) => i >= 0 && i < said.length).sort((a, b) => a - b);
  if (!at.length) return null;
  const start = timed[said[at[0]]].time, after = timed[said[at[at.length - 1]] + 1];
  const end = after ? after.time : songEnd > start ? songEnd : start + VIDEO_SECONDS;
  return { start, end: Math.min(start + MAX_VIDEO_SECONDS, Math.max(start + MIN_VIDEO_SECONDS, end)) };
}

const TYPES = [
  { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
];
/** The format to record in, as the recorder can: MP4 first. → { mime, ext } | null. */
export function pickVideoType(isTypeSupported = (t) => MediaRecorder.isTypeSupported(t)) {
  return TYPES.find((t) => isTypeSupported(t.mime)) || null;
}

// ---- What every film shares ----------------------------------------------------------------------------------------

// The system's own face for type that has to look good big (SF on a Mac, Segoe on Windows); a book face for CLASSIC's notes.
const SANS = `system-ui, -apple-system, "Segoe UI", ${FONT}`;
const SERIF = `"Iowan Old Style", Palatino, "Palatino Linotype", "Book Antiqua", Georgia, "DejaVu Serif", serif`;
const WHITE = [255, 255, 255];
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ease = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const inOut = (x) => { const v = clamp01(x); return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2; };
const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
// A colour bright enough to glow on black (a light theme's dark accent lifted towards white).
const lit = (c, min = 0.5) => { let x = c; for (let i = 0; i < 10 && lum(x) < min; i++) x = lerpColor(x, WHITE, 0.15); return x; };
const canvas = (w, h) => new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));

function wrap(g, text, width, max) {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width <= width || !line) line = next;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > max) { lines.length = max; lines[max - 1] = `${lines[max - 1].replace(/\s*\S*$/, '')}…`; }
  return lines;
}

// The cover cropped square at `size` (the disc's face on dark when there's none).
function squareCover(s, size) {
  const c = canvas(size, size), g = c.getContext('2d');
  g.fillStyle = '#16161a'; g.fillRect(0, 0, size, size);
  g.imageSmoothingQuality = 'high';
  if (s.cover) {
    const iw = s.cover.naturalWidth || s.cover.width, ih = s.cover.naturalHeight || s.cover.height, m = Math.min(iw, ih);
    g.drawImage(s.cover, (iw - m) / 2, (ih - m) / 2, m, m, 0, 0, size, size);
  } else if (s.face) g.drawImage(s.face, size * 0.1, size * 0.1, size * 0.8, size * 0.8);
  return c;
}
// The cover blurred to a field of its colours, small (it's drawn big: the stretching smooths it further).
// (on its average colour first, so the blur doesn't fade its edges to nothing)
function coverField(s, mean, size = 96, blur = 7, saturate = 1.5) {
  const small = squareCover(s, size), c = canvas(size, size), g = c.getContext('2d');
  g.fillStyle = rgb(mean); g.fillRect(0, 0, size, size);
  g.filter = `blur(${blur}px) saturate(${saturate})`;
  g.drawImage(small, -blur * 2, -blur * 2, size + blur * 4, size + blur * 4);
  return c;
}
// The cover's colours: its average, and its liveliest that's not too dark. → { mean, vivid } (null: unreadable).
function coverColors(s) {
  try {
    const c = squareCover(s, 24), d = c.getContext('2d').getImageData(0, 0, 24, 24).data;
    let r = 0, gr = 0, b = 0, best = null, bestScore = -1;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]; gr += d[i + 1]; b += d[i + 2];
      const px = [d[i], d[i + 1], d[i + 2]], max = Math.max(...px), min = Math.min(...px);
      const score = (max - min) / 255 * (0.4 + lum(px));
      if (score > bestScore && max > 70) { bestScore = score; best = px; }
    }
    const n = d.length / 4;
    return { mean: [r / n, gr / n, b / n].map(Math.round), vivid: best || [200, 200, 200] };
  } catch { return null; }
}
// The cover square in its soft shadow, drawn once: → { canvas, pad } (the cover starts `pad` in).
function shadowed(size, radius, draw) {
  const pad = Math.round(size * 0.14), c = canvas(size + pad * 2, size + pad * 2), g = c.getContext('2d');
  g.save(); g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = size * 0.09; g.shadowOffsetY = size * 0.04;
  g.beginPath(); g.roundRect(pad, pad, size, size, radius); g.fillStyle = '#111'; g.fill(); g.restore();
  g.save(); g.beginPath(); g.roundRect(pad, pad, size, size, radius); g.clip(); draw(g, pad); g.restore();
  return { canvas: c, pad };
}
function mark(g, L, color, x = L.w - 48, y = L.h - 48) {
  g.save(); g.font = `600 22px ${SANS}`; g.letterSpacing = '1px'; g.fillStyle = color; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
  g.fillText('CDPlayer', x, y); g.restore();
}

// ---- The words, as they're sung ----------------------------------------------------------------------------------

// The last line started by `pos` (-1: none yet).
function lineIndex(lines, pos) {
  let i = -1;
  for (let k = 0; k < lines.length && lines[k].time <= pos; k++) i = k;
  return i;
}
const sung = (part, pos) => clamp01((pos - part.time) / (part.stop - part.time));

// Where each word of `words` goes in `font`, wrapped to `width`: { items: [{ x, row, w, parts: [{ ...part, x, w }] }], rows, widths, lead }.
function layout(g, words, font, width, lead, spacing = '0px') {
  g.font = font; g.letterSpacing = spacing;
  const space = g.measureText(' ').width, items = [], widths = [0];
  let x = 0, row = 0;
  for (const word of words) {
    const pw = word.parts.map((p) => g.measureText(p.text).width), w = pw.reduce((a, b) => a + b, 0);
    if (x > 0 && x + w > width) { row++; x = 0; widths.push(0); }
    let px = x;
    items.push({ word, x, row, w, parts: word.parts.map((p, k) => { const it = { ...p, x: px, w: pw[k] }; px += pw[k]; return it; }) });
    widths[row] = x + w;
    x += w + space;
  }
  g.letterSpacing = '0px';
  return { items, rows: row + 1, widths, lead, font, spacing, height: (row + 1) * lead };
}
// The biggest size from `max` down to `min` at which the words take `rows` rows at most.
function fit(g, words, face, max, min, width, rows, leading) {
  for (let px = max; ; px -= 2) {
    const l = layout(g, words, face(px), width, px * leading);
    l.px = px;
    if (l.rows <= rows || px <= min) return l;
  }
}
// A line's layout, made once (per kind of film it's in).
function cachedLayout(line, key, make) {
  if (!line.layouts) line.layouts = {};
  return line.layouts[key] || (line.layouts[key] = make());
}

/**
 * Draws a laid-out line at (x, y) (its top), `align` left or center within `width`, each part by
 * `paint(part, x, baseline, word)`. With `edges` ({ top, bottom }), a row fades out as it passes either, rather than
 * being cut through.
 */
function drawLine(g, l, x, y, width, align, paint, edges = null) {
  g.font = l.font; g.letterSpacing = l.spacing; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  const base = l.lead * 0.78, alpha = g.globalAlpha;
  for (const it of l.items) {
    const top = y + it.row * l.lead, dx = align === 'center' ? (width - l.widths[it.row]) / 2 : 0;
    const fade = edges ? clamp01(1 + Math.min(top - edges.top, edges.bottom - top - l.lead) / (l.lead * 0.6)) : 1;
    if (fade <= 0) continue;
    g.globalAlpha = alpha * fade;
    for (const p of it.parts) paint(p, x + dx + p.x, top + base, it);
  }
  g.globalAlpha = alpha; g.letterSpacing = '0px';
}
// A part lit as far as it's sung: its colour `a` up to a soft edge, `b` after.
function wipe(g, text, x, y, w, p, a, b) {
  if (p <= 0) g.fillStyle = b;
  else if (p >= 1) g.fillStyle = a;
  else {
    const edge = Math.max(18, w * 0.3), at = x - edge + p * (w + edge * 2);
    const gr = g.createLinearGradient(at - edge / 2, 0, at + edge / 2, 0);
    gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr;
  }
  g.fillText(text, x, y);
}

/**
 * The lines stacked in `box` as they go by: the line being sung at `anchor` (from the box's top), the one before
 * above it, the next ones under it — gliding up a line as each starts. `draw(line, x, y, state)` draws one, state
 * { current, alpha (how far it's the one being sung, 0…1), gone (it's ended, in a break after it), edges (for drawLine) }.
 */
function stack(g, lines, pos, box, { anchor, gap, layoutOf, draw, glide = 0.6, ahead = 3, start = -Infinity }) {
  const i = lineIndex(lines, pos);
  const since = i >= 0 ? pos - lines[i].time : Infinity, e = i >= 0 && lines[i].time <= start + 0.25 ? 1 : inOut(since / glide); // (the line the video opens on is there from its first frame)
  const heightOf = (k) => (k >= 0 && k < lines.length ? layoutOf(lines[k]).height : 0);
  // where the line before was, as this one started: it's that much lower, gliding up
  let y = box.y + anchor + (i > 0 ? (heightOf(i - 1) + gap) * (1 - e) : 0);
  const at = new Map([[i, y]]);
  for (let k = i - 1, yy = y; k >= Math.max(0, i - 2); k--) { yy -= heightOf(k) + gap; at.set(k, yy); }
  for (let k = i + 1, yy = y + heightOf(i) + (i >= 0 ? gap : 0); k < lines.length && k <= i + ahead; k++) { at.set(k, yy); yy += heightOf(k) + gap; }
  const edges = { top: box.y, bottom: box.y + box.h }; // (rows fade out as they pass these)
  for (const [k, ly] of at) {
    if (k < 0 || ly > box.y + box.h || ly + heightOf(k) < box.y) continue;
    const line = lines[k], gone = clamp01((pos - line.end) / 0.5);
    const alpha = k === i ? e * (1 - gone) : k === i - 1 ? 1 - e : 0;
    // (a line gone by fades as a whole once it starts past the top, not leaving its last word hanging there)
    g.globalAlpha = k < i ? clamp01(1 + (ly - box.y) / (heightOf(k) * 0.3)) : 1;
    if (g.globalAlpha > 0) draw(line, box.x, ly, { current: k === i, alpha, gone, edges });
  }
  g.globalAlpha = 1;
}

// A pause in the singing: three dots breathing, as Apple Music shows one. (x, y) the first dot's middle.
function breathing(g, x, y, r, pos, color, align = 'left') {
  const k = 1 + 0.12 * Math.sin(pos * 3), gap = r * 3.2, x0 = align === 'center' ? x - gap : x;
  for (let d = 0; d < 3; d++) {
    g.globalAlpha = 0.35 + 0.5 * clamp01(Math.sin(pos * 2.2 - d * 0.6) * 0.5 + 0.5);
    g.beginPath(); g.arc(x0 + d * gap, y, r * k, 0, Math.PI * 2); g.fillStyle = color; g.fill();
  }
  g.globalAlpha = 1;
}

// When there are no lyrics to show: the song's name, its words landing as if sung, from where the video starts.
function nameAsLine(s, start) {
  const words = String(s.title || '').split(/\s+/).filter(Boolean).map((text, k) => {
    const time = start + 0.25 + k * 0.22;
    return { text, time, stop: time + 0.4, parts: [{ text, time, stop: time + 0.4 }] };
  });
  return words.length ? [{ time: start, end: Infinity, text: s.title, words }] : [];
}

// ---- CLASSIC: the disc and its case, the lyrics set like liner notes -------------------------------------------------

// What doesn't move behind CLASSIC: the theme's own backdrop, or the cover washed over its colour, darkening down.
function themeBackdrop(L, s) {
  const c = canvas(L.w, L.h), g = c.getContext('2d'), C = s.colors;
  g.fillStyle = rgb(C.bg); g.fillRect(0, 0, L.w, L.h);
  if (s.backdrop) drawThemeImage(g, L.w, L.h, s.backdrop.image, s.backdrop);
  else if (s.cover) { g.save(); g.filter = 'blur(90px) saturate(1.3)'; g.globalAlpha = 0.45; g.drawImage(squareCover(s, 600), -200, -200, L.w + 400, L.w + 400); g.restore(); }
  const shade = g.createLinearGradient(0, 0, 0, L.h);
  shade.addColorStop(0, 'rgba(0,0,0,0.05)'); shade.addColorStop(0.55, 'rgba(0,0,0,0.3)'); shade.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = shade; g.fillRect(0, 0, L.w, L.h);
  return c;
}
// A jewel case with the cover in it: the hinge down the left, the plastic's sheen, a clear edge.
function jewelCase(s, size) {
  return shadowed(size, 3, (g, pad) => {
    g.drawImage(squareCover(s, size), pad, pad);
    const hinge = g.createLinearGradient(pad, 0, pad + size * 0.06, 0);
    hinge.addColorStop(0, 'rgba(0,0,0,0.5)'); hinge.addColorStop(0.3, 'rgba(255,255,255,0.2)'); hinge.addColorStop(0.55, 'rgba(0,0,0,0.25)'); hinge.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = hinge; g.fillRect(pad, pad, size * 0.06, size);
    const gloss = g.createLinearGradient(pad, pad, pad + size * 0.8, pad + size);
    gloss.addColorStop(0, 'rgba(255,255,255,0.2)'); gloss.addColorStop(0.42, 'rgba(255,255,255,0.03)'); gloss.addColorStop(0.43, 'rgba(255,255,255,0)');
    g.fillStyle = gloss; g.fillRect(pad, pad, size, size);
    g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 2; g.strokeRect(pad + 1, pad + 1, size - 2, size - 2);
  });
}
// The light on a disc, which stays put as it turns: a CD's rainbow where it catches the light, a soft highlight across.
function discLight(r) {
  const c = canvas(r * 2, r * 2), g = c.getContext('2d');
  g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.arc(r, r, r * 0.17, 0, Math.PI * 2, true); g.clip('evenodd');
  const bow = g.createConicGradient(-Math.PI / 4, r, r), hues = [[255, 80, 80], [255, 220, 80], [80, 255, 140], [80, 170, 255], [200, 90, 255]];
  for (const [from, to] of [[0.02, 0.16], [0.52, 0.66]]) {
    bow.addColorStop(from, 'rgba(255,255,255,0)');
    hues.forEach((h, k) => bow.addColorStop(from + ((to - from) * (k + 0.5)) / hues.length, `rgba(${h},${0.32 - Math.abs(k - 2) * 0.05})`));
    bow.addColorStop(to, 'rgba(255,255,255,0)');
  }
  bow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = bow; g.fillRect(0, 0, r * 2, r * 2);
  const shine = g.createLinearGradient(0, 0, r * 2, r * 2);
  shine.addColorStop(0.3, 'rgba(255,255,255,0)'); shine.addColorStop(0.47, 'rgba(255,255,255,0.16)'); shine.addColorStop(0.62, 'rgba(255,255,255,0)');
  g.fillStyle = shine; g.fillRect(0, 0, r * 2, r * 2);
  return c;
}
function discShadow(r) {
  const pad = r * 0.3, c = canvas(r * 2 + pad * 2, r * 2 + pad * 2), g = c.getContext('2d');
  g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = r * 0.12; g.shadowOffsetY = r * 0.05;
  g.beginPath(); g.arc(r + pad, r + pad, r - 1, 0, Math.PI * 2); g.fillStyle = '#0b0b0d'; g.fill();
  return { canvas: c, pad };
}

function classic(L, s, lines, start) {
  const C = s.colors, tall = L.h > L.w, back = themeBackdrop(L, s);
  const kase = jewelCase(s, L.case.w), d = L.disc, light = discLight(d.r), shade = discShadow(d.r);
  const from = { x: L.case.x + L.case.w / 2, y: L.case.y + L.case.h / 2 }; // the disc starts inside its case
  const focus = { x: (L.case.x + d.x + d.r) / 2, y: (d.y - d.r + L.case.y + L.case.h) / 2 };
  const n = L.names, box = L.lyrics, notes = lines.length ? lines : nameAsLine(s, start), noLyrics = !lines.length;
  const small = (L.case.w * 0.46) / d.r;
  const size = noLyrics ? (tall ? 80 : 54) : tall ? 56 : 40, face = (px) => `${px}px ${SERIF}`;
  const layoutOf = (line) => cachedLayout(line, `classic${L.h}`, () => fit(scratch(), line.words, face, size, size * 0.8, box.w - 30, 4, 1.32));
  const text = C.text, mute = C.muted;
  return (g, at) => {
    const pos = s.position();
    // The camera creeps in, the case a little faster than the disc behind it, the room slowest.
    const z = 0.055 * (1 - Math.exp(-at / 7));
    g.save(); g.translate(L.w / 2, L.h / 2); g.scale(1 + z * 0.35, 1 + z * 0.35); g.drawImage(back, -L.w / 2, -L.h / 2); g.restore();
    g.save(); g.translate(focus.x, focus.y); g.scale(1 + z, 1 + z); g.translate(-focus.x, -focus.y);
    // The disc slides out from inside its case, spinning up as it goes.
    // (lifted towards the camera as it comes: it starts small enough to hide behind the case)
    const p = inOut((at - 0.15) / 1.3), x = from.x + (d.x - from.x) * p, y = from.y + (d.y - from.y) * p;
    const k = small + (1 - small) * ease((at - 0.15) / 1.5);
    const spin = 0.3 * Math.PI * 2, up = 1.6, turn = at < up ? (spin * at * at) / (2 * up) : spin * (at - up / 2);
    g.save(); g.translate(x, y); g.scale(k, k);
    g.drawImage(shade.canvas, -d.r - shade.pad, -d.r - shade.pad);
    g.save(); g.rotate(turn); g.drawImage(s.face, -d.r, -d.r, d.r * 2, d.r * 2); g.restore();
    g.globalCompositeOperation = 'screen'; g.drawImage(light, -d.r, -d.r); g.restore();
    const drift = z * 160;
    g.drawImage(kase.canvas, L.case.x - kase.pad - drift, L.case.y - kase.pad + drift * 0.4);
    g.restore();
    // The notes' head: the track's number and the song's name in spaced capitals, who and what under it, a rule drawn across.
    g.save(); g.textBaseline = 'top'; g.textAlign = 'left';
    const cap = tall ? 30 : 26;
    g.font = `700 ${cap}px ${SANS}`; g.letterSpacing = `${cap * 0.18}px`;
    const no = String(s.track || 1).padStart(2, '0');
    g.fillStyle = rgb(lit(C.accent, 0.35)); g.fillText(no, n.x, n.y);
    const nw = g.measureText(`${no}  `).width;
    g.fillStyle = rgb(text);
    const titleRows = noLyrics ? [] : wrap(g, String(s.title || '').toUpperCase(), n.w - nw, tall ? 1 : 2);
    titleRows.forEach((row, k) => g.fillText(row, n.x + nw, n.y + k * cap * 1.3));
    g.font = `500 ${Math.round(cap * 0.72)}px ${SANS}`; g.letterSpacing = `${cap * 0.14}px`; g.fillStyle = rgb(mute);
    const who = [s.artist, s.subtitle].filter(Boolean).join(' · ').toUpperCase();
    const whoY = n.y + Math.max(1, titleRows.length) * cap * 1.3 + cap * 0.35;
    wrap(g, who, n.w - nw, tall ? 1 : 2).forEach((row, k) => g.fillText(row, n.x + nw, whoY + k * cap * 0.95));
    g.letterSpacing = '0px'; g.restore();
    const ruleY = n.y + n.h - 2;
    g.fillStyle = rgb(text, 0.28); g.fillRect(n.x, ruleY, n.w * inOut(at / 1.1), 2);
    // The verses, as on the booklet's page: the line being sung in full ink, its words darkening as they're sung.
    stack(g, notes, pos, box, { start, anchor: noLyrics ? 10 : tall ? 120 : 110, gap: size * 0.55, layoutOf,
      draw: (line, x, y, st) => {
        const l = layoutOf(line), dim = 0.32 + 0.68 * st.alpha;
        if (st.current && !st.gone && !noLyrics) { g.fillStyle = rgb(lit(C.accent, 0.35), st.alpha); g.fillRect(x, y + l.lead * 0.2, 3, l.height - l.lead * 0.3); }
        drawLine(g, l, x + 30, y, box.w - 30, 'left', (part, px, py) => {
          const k = st.current ? 0.55 + 0.45 * clamp01((pos - part.time) / 0.25) : 1;
          g.fillStyle = rgb(text, (st.current ? 0.32 + 0.68 * st.alpha * k : dim) * (noLyrics ? clamp01((pos - part.time) / 0.3) : 1));
          g.fillText(part.text, px, py);
        }, st.edges);
      } });
    mark(g, L, rgb(mute));
  };
}

// ---- ALBUM: the cover, big, over a field of its own colours -----------------------------------------------------------

function album(L, s, lines, start) {
  const tall = L.h > L.w, W = L.w, H = L.h, pal = coverColors(s) || { mean: s.colors.bg, vivid: s.colors.accent };
  const field = coverField(s, pal.mean), D = Math.hypot(W, H) * 1.3, F = field.width;
  // a second sheet of the colours, its edges soft, to turn over the first
  const sheet = canvas(F, F), sh = sheet.getContext('2d');
  sh.drawImage(field, 0, 0); sh.globalCompositeOperation = 'destination-in';
  const round = sh.createRadialGradient(F / 2, F / 2, 0, F / 2, F / 2, F / 2);
  round.addColorStop(0.35, '#000'); round.addColorStop(1, 'rgba(0,0,0,0)'); sh.fillStyle = round; sh.fillRect(0, 0, F, F);
  const base = rgb(lerpColor(pal.mean, [0, 0, 0], 0.5)), dark = lerpColor(pal.mean, [0, 0, 0], 0.75);
  // The cover edge to edge — across the top of the tall video, melting into the colours under it; the whole square one.
  const art = squareCover(s, Math.round(W * 1.25)), layer = canvas(W, W), lg = layer.getContext('2d');
  const melt = canvas(W, W), mg = melt.getContext('2d'), mgr = mg.createLinearGradient(0, 0, 0, W);
  mgr.addColorStop(0, '#000'); mgr.addColorStop(0.6, '#000'); mgr.addColorStop(0.98, 'rgba(0,0,0,0)');
  mg.fillStyle = mgr; mg.fillRect(0, 0, W, W);
  // the shade the words sit on: under them, as dark as it takes for white to read on a pale cover too
  const shade = canvas(W, H), sg = shade.getContext('2d'), deep = 0.55 + 0.35 * lum(pal.mean);
  const sgr = sg.createLinearGradient(0, 0, 0, H);
  if (tall) { sgr.addColorStop(0, 'rgba(0,0,0,0)'); sgr.addColorStop(0.5, 'rgba(0,0,0,0.1)'); sgr.addColorStop(1, rgb(dark, Math.min(0.85, deep))); }
  else {
    sgr.addColorStop(0, rgb(dark, 0.6)); sgr.addColorStop(0.2, rgb(dark, 0)); sgr.addColorStop(0.33, rgb(dark, 0));
    sgr.addColorStop(0.58, rgb(dark, 0.8)); sgr.addColorStop(0.75, rgb(dark, 0.93)); sgr.addColorStop(1, rgb(dark, 0.96));
  }
  sg.fillStyle = sgr; sg.fillRect(0, 0, W, H);
  const x0 = tall ? 90 : 64, colW = W - x0 * 2;
  const big = tall ? 74 : 54, face = (px) => `700 ${px}px ${SANS}`;
  const layoutOf = (line) => cachedLayout(line, `album${H}`, () => fit(scratch(), line.words, face, big, big * 0.75, colW, 3, 1.16));
  const box = tall ? { x: x0, y: 1330, w: colW, h: 430 } : { x: x0, y: 690, w: colW, h: 350 };
  return (g, at) => {
    const pos = s.position();
    // The field: the cover's colours, slowly turning over each other.
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    g.save(); g.translate(W * 0.5, H * 0.6); g.rotate(at * 0.05); g.drawImage(field, -D / 2, -D / 2, D, D); g.restore();
    g.save(); g.globalAlpha = 0.7; g.translate(W * (0.3 + 0.1 * Math.sin(at * 0.21)), H * 0.78); g.rotate(2.4 - at * 0.09); g.scale(-1, 1);
    g.drawImage(sheet, -D * 0.35, -D * 0.35, D * 0.7, D * 0.7); g.restore();
    // The cover: settling back into the frame as it starts, then a camera moving slowly over it.
    const settle = 0.1 * (1 - ease(at / 1.6)), zoom = 1.05 + settle + 0.1 * (1 - Math.exp(-at / 14)), as = W * zoom, room = (zoom - 1) * W * 0.42;
    const ax = (W - as) / 2 + Math.sin(at * 0.13 + 1) * room, ay = (W - as) / 2 + Math.cos(at * 0.1 + 0.5) * room * 0.8;
    if (tall) {
      lg.globalCompositeOperation = 'source-over'; lg.clearRect(0, 0, W, W); lg.drawImage(art, ax, ay, as, as);
      lg.globalCompositeOperation = 'destination-in'; lg.drawImage(melt, 0, 0);
      g.drawImage(layer, 0, 0);
    } else g.drawImage(art, ax, ay, as, as);
    g.drawImage(shade, 0, 0);
    // Its name and who it's by, as a music app sets them; then the lines, lit word by word as they're sung.
    const e = ease(at / 0.9);
    g.save(); g.globalAlpha = 0.4 + 0.6 * e; g.translate(0, (1 - e) * 16);
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    // (no lyrics: the name bigger, where the lines would be)
    const tp = lines.length ? (tall ? 56 : 40) : tall ? 80 : 60;
    g.font = `700 ${tp}px ${SANS}`; g.fillStyle = 'rgba(255,255,255,0.97)';
    let y = lines.length ? (tall ? 1150 : 96) : tall ? 1420 : 880;
    for (const row of wrap(g, s.title, colW - (tall ? 0 : 180), lines.length ? 1 : 2)) { g.fillText(row, x0, y); y += tp * 1.15; }
    g.font = `400 ${Math.round(tp * 0.78)}px ${SANS}`; g.fillStyle = 'rgba(255,255,255,0.66)';
    if (s.artist) g.fillText(wrap(g, s.artist, colW - (tall ? 0 : 180), 1)[0], x0, y + tp * 0.05);
    g.restore();
    if (lines.length) {
      stack(g, lines, pos, box, { start, anchor: 0, gap: big * 0.42, layoutOf, ahead: tall ? 2 : 1,
        draw: (line, x, ly, st) => drawLine(g, layoutOf(line), x, ly, box.w, 'left', (part, px, py) => {
          if (!st.current || st.gone) { g.fillStyle = `rgba(255,255,255,${0.26 + 0.6 * st.alpha})`; g.fillText(part.text, px, py); return; }
          wipe(g, part.text, px, py, part.w, sung(part, pos), 'rgba(255,255,255,1)', `rgba(255,255,255,${0.26 + 0.24 * st.alpha})`);
        }, st.edges) });
    }
    mark(g, L, 'rgba(255,255,255,0.55)', W - 48, tall ? H - 48 : 92);
  };
}

// ---- HI-FI: the deck's display --------------------------------------------------------------------------------------

// Text as a vacuum-fluorescent display's dots: drawn small in a bold face, each pixel a dot. → { cols, rows, on: Uint8Array }.
function dots(text, rows) {
  const px = Math.round(rows * 0.8), m = canvas(4, 4).getContext('2d');
  m.font = `700 ${px}px ${SANS}`;
  const cols = Math.max(1, Math.ceil(m.measureText(text).width) + 1);
  const c = canvas(cols, rows), g = c.getContext('2d', { willReadFrequently: true });
  g.font = `700 ${px}px ${SANS}`; g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
  g.fillText(text, 0, Math.round(rows * 0.76));
  const data = g.getImageData(0, 0, cols, rows).data, on = new Uint8Array(cols * rows);
  for (let i = 0; i < on.length; i++) on[i] = data[i * 4 + 3] > 110 ? 1 : 0;
  // (trailing columns with nothing lit don't count)
  let used = cols;
  while (used > 1 && ![...Array(rows).keys()].some((y) => on[y * cols + used - 1])) used--;
  return { cols, used, rows, on };
}
// Lit dots, glowing: the dots sharp over a blur of themselves.
function glowing(c, pitch, color) {
  const out = canvas(c.width, c.height), g = out.getContext('2d');
  g.filter = `blur(${Math.round(pitch * 0.9)}px)`; g.globalAlpha = 0.85; g.drawImage(c, 0, 0);
  g.filter = 'none'; g.globalAlpha = 1; g.drawImage(c, 0, 0);
  return out;
}

function hifi(L, s, lines, start) {
  const tall = L.h > L.w, W = L.w, H = L.h, C = s.colors, glow = lit(C.accent, 0.55), color = rgb(glow);
  // The display window, and in it: the track and time up top, the song's name running across, the lyrics, the meters.
  const win = tall ? { x: 50, y: 300, w: W - 100, h: 1300 } : { x: 46, y: 96, w: W - 92, h: 880 };
  const pad = tall ? 54 : 40, inner = { x: win.x + pad, y: win.y + pad, w: win.w - pad * 2, h: win.h - pad * 2 };
  const digit = tall ? 92 : 70, top = inner.y + (tall ? 36 : 28);
  const P = tall ? 8 : 6, ROWS = 15, GAP = 4; // the lyrics' dots: their pitch, a row of text's dots, the dots between rows
  const tickerP = tall ? 5 : 4, TICK = 13, tickerY = top + digit + (tall ? 70 : 46);
  const meterH = tall ? 150 : 104, area = { x: inner.x, y: tickerY + TICK * tickerP + (tall ? 70 : 40), w: inner.w };
  area.h = inner.y + inner.h - meterH - (tall ? 50 : 30) - area.y;
  const cols = Math.floor(area.w / P);
  const ox = area.x + (area.w - cols * P) / 2;
  // What doesn't move: the brushed front, the black glass, the unlit dots, the labels.
  const back = canvas(W, H), bg = back.getContext('2d');
  const metal = bg.createLinearGradient(0, 0, 0, H);
  metal.addColorStop(0, '#2a2a2d'); metal.addColorStop(0.5, '#1c1c1f'); metal.addColorStop(1, '#121214');
  bg.fillStyle = metal; bg.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 2) { bg.fillStyle = `rgba(255,255,255,${0.012 + 0.014 * (((y * 7919) % 13) / 13)})`; bg.fillRect(0, y, W, 1); }
  bg.save(); bg.shadowColor = 'rgba(255,255,255,0.08)'; bg.shadowOffsetY = 2; bg.shadowBlur = 0;
  bg.beginPath(); bg.roundRect(win.x - 6, win.y - 6, win.w + 12, win.h + 12, 26); bg.fillStyle = '#08080a'; bg.fill(); bg.restore();
  bg.beginPath(); bg.roundRect(win.x, win.y, win.w, win.h, 20);
  const glass = bg.createLinearGradient(0, win.y, 0, win.y + win.h);
  glass.addColorStop(0, '#0d0e10'); glass.addColorStop(1, '#030304');
  bg.fillStyle = glass; bg.fill();
  bg.fillStyle = rgb(glow, 0.055);
  for (let r = 0; r < Math.floor(area.h / P); r++) for (let c = 0; c < cols; c++) bg.fillRect(ox + c * P + P * 0.14, area.y + r * P + P * 0.14, P * 0.72, P * 0.72);
  bg.font = `700 ${tall ? 22 : 17}px ${SANS}`; bg.letterSpacing = '3px'; bg.textBaseline = 'alphabetic'; bg.fillStyle = rgb(glow, 0.55);
  bg.fillText(t('TRACK').toUpperCase(), inner.x, top - 14);
  bg.textAlign = 'right'; bg.fillText(t('PLAY|display').toUpperCase(), inner.x + inner.w, top - 14); bg.textAlign = 'left';
  bg.letterSpacing = '0px';
  // Under the display, the deck's name printed on the metal, and (on the tall one) its disc tray, shut.
  const below = win.y + win.h;
  bg.font = `600 ${tall ? 28 : 22}px ${SANS}`; bg.letterSpacing = '3px';
  bg.fillStyle = 'rgba(0,0,0,0.6)'; bg.fillText('CDPlayer', win.x + 6, below + (tall ? 92 : 62) + 2);
  bg.fillStyle = 'rgba(255,255,255,0.38)'; bg.fillText('CDPlayer', win.x + 6, below + (tall ? 92 : 62)); bg.letterSpacing = '0px';
  if (tall) {
    const tray = { x: win.x + win.w * 0.36, y: below + 64, w: win.w * 0.64 - 6, h: 40 };
    bg.beginPath(); bg.roundRect(tray.x, tray.y, tray.w, tray.h, 6); bg.fillStyle = 'rgba(0,0,0,0.35)'; bg.fill();
    bg.fillStyle = 'rgba(255,255,255,0.07)'; bg.fillRect(tray.x + 6, tray.y + tray.h - 1, tray.w - 12, 1);
    bg.fillStyle = 'rgba(0,0,0,0.6)'; bg.fillRect(tray.x + 10, tray.y + tray.h / 2, tray.w - 20, 2);
  }
  // The glass's reflection, over everything lit.
  const sheen = canvas(win.w, win.h), sg = sheen.getContext('2d');
  sg.beginPath(); sg.roundRect(0, 0, win.w, win.h, 20); sg.clip();
  const ref = sg.createLinearGradient(0, 0, win.w * 0.6, win.h);
  ref.addColorStop(0, 'rgba(255,255,255,0.08)'); ref.addColorStop(0.33, 'rgba(255,255,255,0.025)'); ref.addColorStop(0.36, 'rgba(255,255,255,0)');
  sg.fillStyle = ref; sg.fillRect(0, 0, win.w, win.h);
  // The song's name running across in small dots, drawn once.
  const name = dots([s.artist, s.title].filter(Boolean).join('  ·  ').toUpperCase(), TICK);
  const tick = canvas((name.used + 30) * tickerP, TICK * tickerP), tg = tick.getContext('2d');
  tg.fillStyle = color;
  for (let y = 0; y < TICK; y++) for (let x = 0; x < name.used; x++) if (name.on[y * name.cols + x]) tg.fillRect(x * tickerP + tickerP * 0.12, y * tickerP + tickerP * 0.12, tickerP * 0.76, tickerP * 0.76);
  const ticker = glowing(tick, tickerP, color), runs = name.used * tickerP > inner.w;
  // Each line's dots, laid out on the display's grid and lit, drawn as it's first needed: the words' places kept to light them.
  const shown = lines.length ? lines : nameAsLine(s, start);
  // (a long line in smaller characters, as a display squeezes more on: fewer dots to a character, the same dots)
  const plate = (line) => {
    if (line.plate) return line.plate;
    let words, rows, size;
    for (size of [ROWS, 12, 10]) {
      words = line.words.map((w) => ({ w, d: dots(w.text, size) })); rows = [[]];
      const space = Math.round(size * 0.32);
      let x = 0;
      for (const it of words) {
        if (x > 0 && x + it.d.used > cols) { rows.push([]); x = 0; }
        it.x = x; it.row = rows.length - 1; rows[rows.length - 1].push(it); x += it.d.used + space;
      }
      if (rows.length <= Math.floor((area.h / P + GAP) / (size + GAP))) break;
    }
    const step = size + GAP, fits = Math.max(1, Math.floor((area.h / P + GAP) / step)), used = Math.min(rows.length, fits);
    const c = canvas(cols * P, used * step * P), g = c.getContext('2d');
    g.fillStyle = color;
    for (const row of rows.slice(0, used)) {
      const width = row.reduce((m, it) => Math.max(m, it.x + it.d.used), 0), shift = Math.floor((cols - width) / 2);
      for (const it of row) {
        it.col = it.x + shift;
        for (let y = 0; y < size; y++) for (let xx = 0; xx < it.d.used; xx++) if (it.d.on[y * it.d.cols + xx]) {
          g.fillRect((it.col + xx) * P + P * 0.14, (it.row * step + y) * P + P * 0.14, P * 0.72, P * 0.72);
        }
      }
    }
    return (line.plate = { canvas: glowing(c, P, color), words: words.filter((it) => it.row < used), rows: used, step });
  };
  for (const line of shown) if (line.time >= start - 10 && line.time <= start + MAX_VIDEO_SECONDS + 5) plate(line); // ready before the recording starts
  // The meters, as the deck's: quick up, slow down, the peak held a moment.
  const SEGS = tall ? 34 : 38, LOW = -20, HIGH = 3, held = [0, 0], peak = [LOW, LOW], level = [LOW, LOW];
  const dbOf = (v) => 20 * Math.log10(Math.max(v, 1e-4) / 0.7), frac = (db) => (Math.max(LOW, Math.min(HIGH, db)) - LOW) / (HIGH - LOW);
  let last = null;
  return (g, at) => {
    const pos = s.position(), dt = last === null ? 33 : Math.max(0, (at - last) * 1000); last = at;
    const levels = (s.levels && s.levels()) || (s.spectrum && (() => { const sp = s.spectrum(8); return sp && [sp[1] * 0.9, sp[2] * 0.9]; })()) || null;
    for (let k = 0; k < 2; k++) {
      const to = levels ? dbOf(levels[k]) : LOW;
      level[k] += (to - level[k]) * Math.min(1, dt * (to > level[k] ? 0.012 : 0.005));
      if (level[k] >= peak[k]) { peak[k] = level[k]; held[k] = 900; } else if ((held[k] -= dt) < 0) peak[k] = Math.max(level[k], peak[k] - dt * 0.02);
    }
    // The camera eases in on the deck.
    const z = 1 + 0.04 * (1 - Math.exp(-at / 8));
    g.save(); g.translate(W / 2, H / 2); g.scale(z, z); g.translate(-W / 2, -H / 2);
    g.drawImage(back, 0, 0);
    // The display comes on: everything lit flashes past full, then settles (as the deck's own does at power on).
    const on = at < 0.35 ? 0.15 + 0.85 * ease(at / 0.2) * (1 + 0.4 * Math.sin(Math.min(1, at / 0.35) * Math.PI)) : 1;
    g.globalAlpha = Math.min(1, on);
    g.save(); g.translate(inner.x, top); g.shadowColor = rgb(glow, 0.8); g.shadowBlur = 16;
    drawCells(g, String(s.track || 1).padStart(2, '0'), digit, color, rgb(glow, 0.07)); g.restore();
    const time = clock(pos), tw = [...time].reduce((sum, ch) => sum + (ch === ':' ? digit * 0.32 : digit * 0.72), 0) - digit * 0.16;
    g.save(); g.translate(inner.x + inner.w - tw - digit * 0.07, top); g.shadowColor = rgb(glow, 0.8); g.shadowBlur = 16;
    drawCells(g, time, digit, color, rgb(glow, 0.07)); g.restore();
    // ▶ by PLAY
    g.fillStyle = color; g.beginPath(); const px0 = inner.x + inner.w - (tall ? 150 : 118), py0 = top - (tall ? 32 : 26);
    g.moveTo(px0, py0); g.lineTo(px0, py0 + (tall ? 20 : 16)); g.lineTo(px0 + (tall ? 16 : 13), py0 + (tall ? 10 : 8)); g.fill();
    // The name running across (standing still, centred, when it fits).
    g.save(); g.beginPath(); g.rect(inner.x, tickerY - 10, inner.w, TICK * tickerP + 20); g.clip();
    if (runs) { const loop = tick.width, x = -(((at * 90) % loop) + loop) % loop; g.drawImage(ticker, inner.x + x, tickerY); g.drawImage(ticker, inner.x + x + loop, tickerY); }
    else g.drawImage(ticker, inner.x + (inner.w - name.used * tickerP) / 2, tickerY);
    g.restore();
    // The line: the display wiped across as it comes, its words faint until sung, each lit with a flash as it is.
    const i = lineIndex(shown, pos);
    if (i >= 0 && pos < shown[i].end + 0.25) {
      const pl = plate(shown[i]), since = pos - shown[i].time, y0 = area.y + Math.floor((Math.floor(area.h / P) - pl.rows * pl.step + GAP) / 2) * P;
      const scan = clamp01(since / 0.18), fade = 1 - clamp01((pos - shown[i].end) / 0.25);
      g.save(); g.beginPath(); g.rect(ox, y0 - P, cols * P * scan, pl.canvas.height + P * 2); g.clip();
      for (const it of pl.words) {
        const d = pos - it.w.time, sx = it.col * P, sy = it.row * pl.step * P, sw = it.d.used * P, sh = pl.step * P;
        g.globalAlpha = (d < 0 ? 0.13 : 1) * fade * Math.min(1, on);
        g.drawImage(pl.canvas, sx, sy, sw, sh, ox + sx, y0 + sy, sw, sh);
        if (d >= 0 && d < 0.14) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.6 * (1 - d / 0.14) * fade; g.drawImage(pl.canvas, sx, sy, sw, sh, ox + sx, y0 + sy, sw, sh); g.globalCompositeOperation = 'source-over'; }
      }
      g.restore();
    }
    // The meters: L over R, the segments past 0 dB taller, as on the deck.
    const mx = inner.x + (tall ? 50 : 40), mw = inner.w - (tall ? 50 : 40), seg = mw / SEGS, bar = tall ? 34 : 24, my = inner.y + inner.h - meterH;
    const zero = Math.round(frac(0) * SEGS);
    g.font = `700 ${tall ? 24 : 18}px ${SANS}`; g.textBaseline = 'middle'; g.textAlign = 'left';
    for (let k = 0; k < 2; k++) {
      const y = my + (k ? meterH - bar : 0), litN = Math.round(frac(level[k]) * SEGS), pk = Math.round(frac(peak[k]) * SEGS);
      g.globalAlpha = Math.min(1, on) * 0.8; g.fillStyle = color; g.fillText(k ? 'R' : 'L', inner.x, y + bar / 2);
      for (let q = 0; q < SEGS; q++) {
        const hot = q >= zero, isLit = q < litN || (q === pk - 1 && pk > 0), hh = hot ? bar : bar * 0.72;
        g.globalAlpha = isLit ? Math.min(1, on) : 0.08;
        g.fillStyle = hot && isLit ? rgb(lit(C.accent2 || [255, 90, 70], 0.45)) : color;
        g.fillRect(mx + q * seg + seg * 0.12, y + (bar - hh) / 2, seg * 0.62, hh);
      }
    }
    g.globalAlpha = Math.min(1, on) * 0.5; g.fillStyle = color; g.textAlign = 'center'; g.font = `600 ${tall ? 18 : 14}px ${SANS}`;
    for (const db of [-20, -10, -5, -3, 0, 3]) g.fillText(String(db), mx + frac(db) * SEGS * seg - seg * 0.2, my + meterH / 2);
    g.globalAlpha = 1;
    g.drawImage(sheen, win.x, win.y);
    g.restore();
  };
}

// ---- VISUALIZER: the cover inside a ring of the music ------------------------------------------------------------------

function visualizer(L, s, lines, start) {
  const tall = L.h > L.w, W = L.w, H = L.h, C = s.colors;
  const a1 = lit(C.accent, 0.5), a2 = lit(C.accent2 || C.accent, 0.5);
  const cx = W / 2, cy = tall ? 830 : 450, R = tall ? 260 : 175, AMP = tall ? 170 : 115;
  const back = canvas(W, H), bg = back.getContext('2d');
  bg.fillStyle = rgb(lerpColor(C.bg, [0, 0, 0], 0.7)); bg.fillRect(0, 0, W, H);
  bg.save(); bg.globalAlpha = 0.35; bg.filter = 'blur(70px) saturate(1.4)'; bg.drawImage(squareCover(s, 400), cx - H * 0.45, cy - H * 0.45, H * 0.9, H * 0.9); bg.restore();
  const vig = bg.createRadialGradient(cx, cy, R, cx, cy, Math.hypot(W, H) * 0.6);
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.7)'); bg.fillStyle = vig; bg.fillRect(0, 0, W, H);
  // The cover as a round, in its shadow; and the glow behind it that the bass swells.
  const disc = canvas(R * 2 + 120, R * 2 + 120), dg = disc.getContext('2d');
  dg.save(); dg.shadowColor = 'rgba(0,0,0,0.6)'; dg.shadowBlur = 50; dg.shadowOffsetY = 14;
  dg.beginPath(); dg.arc(R + 60, R + 60, R, 0, Math.PI * 2); dg.fillStyle = '#111'; dg.fill(); dg.restore();
  dg.save(); dg.beginPath(); dg.arc(R + 60, R + 60, R, 0, Math.PI * 2); dg.clip(); dg.drawImage(squareCover(s, R * 2), 60, 60); dg.restore();
  dg.strokeStyle = 'rgba(255,255,255,0.14)'; dg.lineWidth = 2; dg.beginPath(); dg.arc(R + 60, R + 60, R - 1, 0, Math.PI * 2); dg.stroke();
  const halo = canvas(512, 512), hg = halo.getContext('2d'), hr = hg.createRadialGradient(256, 256, 0, 256, 256, 256);
  hr.addColorStop(0, rgb(a1, 0.55)); hr.addColorStop(0.45, rgb(lerpColor(a1, a2, 0.5), 0.18)); hr.addColorStop(1, rgb(a2, 0));
  hg.fillStyle = hr; hg.fillRect(0, 0, 512, 512);
  const N = 48, smooth = new Float32Array(N), reach = new Float32Array(N), level = new Float32Array(N);
  let bassAvg = 0, kick = 0, last = null;
  const box = tall ? { x: 80, y: 1300, w: W - 160, h: 420 } : { x: 70, y: 790, w: W - 140, h: 240 };
  const big = tall ? 70 : 48, face = (px) => `700 ${px}px ${SANS}`, shown = lines.length ? lines : nameAsLine(s, start);
  const layoutOf = (line) => cachedLayout(line, `vis${L.h}`, () => fit(scratch(), line.words, face, lines.length ? big : big * 1.3, big * 0.75, box.w, 3, 1.18));
  return (g, at) => {
    const pos = s.position(), dt = last === null ? 1 / FPS : Math.max(0, at - last); last = at;
    const spec = (s.spectrum && s.spectrum(N)) || null;
    // Each band follows the music up quickly and falls back slower; the bass, against its own recent average, is the beat.
    // (each band shown also against its own recent loudest, so the quieter treble reaches out as the bass does)
    for (let k = 0; k < N; k++) {
      const v = spec ? spec[k] || 0 : 0;
      smooth[k] += (v - smooth[k]) * (v > smooth[k] ? 0.6 : 0.18);
      reach[k] = Math.max(smooth[k], 0.12, reach[k] * Math.exp(-dt * 0.35));
      const rel = smooth[k] / reach[k];
      level[k] = 0.4 * smooth[k] + 0.6 * rel * rel;
    }
    const bass = (smooth[0] + smooth[1] + smooth[2] + smooth[3] + smooth[4]) / 5;
    bassAvg += (bass - bassAvg) * Math.min(1, dt * 2.5);
    kick = Math.max(kick * Math.exp(-dt * 7), clamp01((bass - bassAvg) * 4));
    g.drawImage(back, 0, 0);
    const swell = 1 + 0.6 * bass + 0.5 * kick, hs = (R + AMP) * 2.2 * (0.9 + 0.15 * swell);
    g.globalAlpha = 0.5 + 0.4 * bass; g.drawImage(halo, cx - hs / 2, cy - hs / 2, hs, hs); g.globalAlpha = 1;
    // The ring: the spectrum round the cover as a dial's fine marks, mirrored left and right with the bass at the top —
    // short and faint in a quiet bar, reaching out and lighting up in the theme's colours as the music does.
    const breathe = 1 + 0.035 * bass + 0.025 * kick, base = R * breathe + (tall ? 22 : 16), M = N * 2;
    g.lineCap = 'round'; g.lineWidth = tall ? 5 : 4;
    for (let k = 0; k < M; k++) {
      const band = k < N ? k : M - 1 - k, v = Math.pow((level[Math.max(0, band - 1)] + level[band] * 2 + level[Math.min(N - 1, band + 1)]) / 4, 1.25);
      const a = -Math.PI / 2 + ((k + 0.5) / M) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a), len = (tall ? 10 : 8) + AMP * v;
      g.strokeStyle = rgb(lerpColor(WHITE, lerpColor(a1, a2, band / N), clamp01(v * 1.4)), 0.3 + 0.7 * clamp01(v * 1.6));
      g.beginPath(); g.moveTo(cx + c * base, cy + sn * base); g.lineTo(cx + c * (base + len), cy + sn * (base + len)); g.stroke();
    }
    g.lineCap = 'butt';
    const ds = (R * 2 + 120) * breathe;
    g.drawImage(disc, cx - ds / 2, cy - ds / 2, ds, ds);
    // The name over it all, quiet; the line under the ring, lit as it's sung and pulsing with the beat.
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const ny = tall ? 310 : 72;
    g.font = `700 ${tall ? 46 : 32}px ${SANS}`; g.fillStyle = 'rgba(255,255,255,0.95)';
    if (lines.length) g.fillText(wrap(g, s.title, W - 160, 1)[0] || '', cx, ny);
    g.font = `400 ${tall ? 36 : 26}px ${SANS}`; g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillText(wrap(g, lines.length ? s.artist : '', W - 160, 1)[0] || '', cx, ny + (tall ? 54 : 38));
    const pulse = 1 + 0.025 * kick;
    stack(g, shown, pos, box, { start, anchor: 0, gap: big * 0.45, layoutOf, ahead: 1,
      draw: (line, x, y, st) => {
        g.save(); g.translate(cx, y + 30); g.scale(st.current ? pulse : 1, st.current ? pulse : 1); g.translate(-cx, -y - 30);
        drawLine(g, layoutOf(line), x, y, box.w, 'center', (part, px, py) => {
          if (!st.current || st.gone) { g.fillStyle = `rgba(255,255,255,${0.28 + 0.6 * st.alpha})`; g.fillText(part.text, px, py); return; }
          wipe(g, part.text, px, py, part.w, sung(part, pos), 'rgba(255,255,255,0.98)', 'rgba(255,255,255,0.32)');
        }, st.edges);
        g.restore();
      } });
    if (!lines.length && s.artist) { g.font = `400 ${tall ? 36 : 28}px ${SANS}`; g.globalAlpha = clamp01((at - 1) / 0.6) * 0.65; g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(wrap(g, s.artist, box.w, 1)[0], cx, box.y + box.h - 40); g.globalAlpha = 1; }
    mark(g, L, 'rgba(255,255,255,0.45)');
  };
}

// ---- LYRICS: the words, big, as they're sung -------------------------------------------------------------------------

function kinetic(L, s, lines, start) {
  const tall = L.h > L.w, W = L.w, H = L.h, C = s.colors;
  const field = canvas(W / 4, H / 4), fg = field.getContext('2d'), side = Math.max(W, H) / 4;
  if (s.cover) { fg.filter = 'blur(12px) saturate(1.5) brightness(0.5)'; fg.drawImage(squareCover(s, 300), (W / 4 - side) / 2 - 20, (H / 4 - side) / 2 - 20, side + 40, side + 40); }
  else { // (no cover: the theme's own colours instead, its accent glowing up from below)
    const fgr = fg.createRadialGradient(W / 8, H / 4, 0, W / 8, H / 4, H / 4);
    fgr.addColorStop(0, rgb(lerpColor(C.accent, [0, 0, 0], 0.45))); fgr.addColorStop(1, rgb(lerpColor(C.bg, [0, 0, 0], 0.6)));
    fg.fillStyle = fgr; fg.fillRect(0, 0, W / 4, H / 4);
  }
  const shade = canvas(W, H), sg = shade.getContext('2d'), sgr = sg.createLinearGradient(0, 0, 0, H);
  sgr.addColorStop(0, 'rgba(0,0,0,0.3)'); sgr.addColorStop(0.6, 'rgba(0,0,0,0.35)'); sgr.addColorStop(1, 'rgba(0,0,0,0.75)');
  sg.fillStyle = sgr; sg.fillRect(0, 0, W, H);
  const accent = lit(C.accent, 0.55), box = tall ? { x: 80, y: 0, w: W - 160 } : { x: 70, y: 0, w: W - 140 };
  const shown = lines.length ? lines : nameAsLine(s, start);
  const big = tall ? 150 : 108, face = (px) => `800 ${px}px ${SANS}`, middle = tall ? H * 0.45 : H * 0.44;
  const layoutOf = (line) => cachedLayout(line, `kin${L.h}`, () => fit(scratch(), line.words, face, big, big * 0.55, box.w, tall ? 5 : 4, 1.04));
  // One line: its words landing — rising into place and settling — as each is sung; `out` (0…1) sweeps it up and away.
  const drawWords = (g, line, pos, out) => {
    const l = layoutOf(line), y0 = middle - l.height / 2 - out * l.lead * 1.4;
    // the block drawing slowly nearer as it builds
    const near = 1 + 0.035 * ease((pos - line.time) / 5);
    g.save(); g.translate(box.x, middle); g.scale(near, near); g.translate(-box.x, -middle);
    g.font = l.font; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    const now = line.words.findLastIndex((w) => w.time <= pos);
    for (let k = 0; k < l.items.length; k++) {
      const it = l.items[k], d = pos - it.word.time;
      if (d < 0) continue;
      const land = ease(d / 0.38), y = y0 + it.row * l.lead + l.lead * 0.8 + (1 - land) * l.px * 0.42, sc = 1.12 - 0.12 * land;
      const fresh = k === now && pos < it.word.stop + 0.25;
      g.globalAlpha = clamp01(d / 0.16) * (1 - out) * (fresh ? 1 : 0.86);
      g.save(); g.translate(box.x + it.x, y); g.scale(sc, sc);
      g.fillStyle = '#fff'; g.fillText(it.word.text, 0, 0); g.restore();
    }
    g.restore();
    g.globalAlpha = 1;
  };
  return (g, at) => {
    const pos = s.position();
    // The field: the cover blurred to its colours, drifting.
    const z = 1.15 + 0.04 * Math.sin(at * 0.2);
    g.save(); g.translate(W / 2 + Math.sin(at * 0.17) * 30, H / 2 + Math.cos(at * 0.13) * 30); g.scale(z, z); g.drawImage(field, -W / 2, -H / 2, W, H); g.restore();
    g.drawImage(shade, 0, 0);
    // The line being sung builds up; as the next starts the one before is swept up and out.
    const i = lineIndex(shown, pos);
    if (i >= 0) {
      const line = shown[i], since = pos - line.time, gone = pos - line.end;
      if (i > 0 && since < 0.45 && shown[i - 1].end > line.time - 0.6) drawWords(g, shown[i - 1], pos, inOut(since / 0.4));
      drawWords(g, line, pos, gone > 0 ? inOut(gone / 0.5) : 0);
      const next = shown[i + 1];
      if (gone > 0.6 && (!next || next.time - pos > 1.2)) breathing(g, box.x + 14, middle, 14, pos, rgb(accent));
    } else if (shown.length && shown[0].time - pos > 1) breathing(g, box.x + 14, middle, 14, pos, rgb(accent));
    // The song's name and who it's by, small, at the foot; the accent's short rule over them.
    const fy = tall ? H - 300 : H - 140;
    g.fillStyle = rgb(accent); g.fillRect(box.x, fy - (tall ? 58 : 44), 56, 5);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = `700 ${tall ? 38 : 30}px ${SANS}`; g.fillStyle = 'rgba(255,255,255,0.95)';
    if (lines.length) g.fillText(wrap(g, s.title, box.w - 200, 1)[0] || '', box.x, fy);
    g.font = `400 ${tall ? 32 : 26}px ${SANS}`; g.fillStyle = 'rgba(255,255,255,0.62)';
    if (s.artist) g.fillText(wrap(g, s.artist, box.w - 200, 1)[0], box.x, fy + (lines.length ? (tall ? 46 : 38) : 0));
    mark(g, L, 'rgba(255,255,255,0.5)', W - box.x, lines.length ? fy + (tall ? 46 : 38) : fy);
  };
}

// A context to measure type on, when laying lines out ahead of drawing them.
let measuring = null;
const scratch = () => measuring || (measuring = canvas(8, 8).getContext('2d'));

const FILMS = { CLASSIC: classic, ALBUM: album, HIFI: hifi, VISUALIZER: visualizer, LYRICS: kinetic };
/** A look's film for `song`, ready to draw: → draw(g, at) (at: seconds into the video). What doesn't move is drawn here. */
function film(format, song) {
  const L = videoLayout(format), lines = lyricLines(song.timed || []);
  return (FILMS[song.look] || classic)(L, song, lines, song.position());
}

/**
 * Records the video: song { cover, face (the disc as drawn), title, artist, subtitle, colors, timed, position() (where
 * the song is now, s), look, track, spectrum(n), levels() ([left, right]) }, audio a MediaStream of what plays (or null:
 * no sound), seconds long, begin() awaited once the frames are ready to go (to put the song where the video starts),
 * onTick(seconds left). playing(): whether the music is still going (it stopping ends the video there).
 * → { bytes: Uint8Array, ext, stoppedEarly } | null (the recorder can't make video here, or it failed).
 */
export async function recordVideo({ format, song, audio, seconds = VIDEO_SECONDS, begin = async () => {}, onTick = () => {}, playing = () => true }) {
  const type = pickVideoType();
  if (!type) return null;
  const L = videoLayout(format);
  const canvasEl = document.createElement('canvas');
  canvasEl.width = L.w; canvasEl.height = L.h;
  const g = canvasEl.getContext('2d');
  const stream = canvasEl.captureStream(FPS);
  if (audio) for (const track of audio.getAudioTracks()) stream.addTrack(track);
  const recorder = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: 10e6, audioBitsPerSecond: 192e3 });
  const chunks = [];
  let failed = false;
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onerror = () => { failed = true; };
  const done = new Promise((resolve) => { recorder.onstop = resolve; });
  await begin();
  // The film made once the song is where the video starts (what it draws first is where the music is).
  const draw = film(format, song);
  draw(g, 0);
  const t0 = performance.now();
  recorder.start(500);
  // Drawn on a timer, not on animation frames: those slow right down when the window isn't in front.
  let quietSince = null, stoppedEarly = false;
  await new Promise((resolve) => {
    let left = Math.ceil(seconds);
    onTick(left);
    const timer = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      draw(g, t);
      const now = Math.ceil(seconds - t);
      if (now !== left) { left = now; onTick(Math.max(0, now)); }
      // The music stopped (paused, or the song couldn't go on): the video ends there, not on a silent frozen picture.
      if (playing()) quietSince = null; else if (quietSince === null) quietSince = t;
      if (t >= seconds || (quietSince !== null && t - quietSince > 0.4)) { stoppedEarly = t < seconds; clearInterval(timer); resolve(); }
    }, 1000 / FPS);
  });
  recorder.stop();
  await done;
  for (const track of stream.getVideoTracks()) track.stop();
  if (failed || !chunks.length) return null; // the encoder wouldn't start: nothing to save
  const blob = new Blob(chunks, { type: type.mime });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: type.ext, stoppedEarly };
}

/** A look's film, to draw frames of it by hand (to look at them, or time them): → draw(g, at). */
export const videoFilm = film;

/** One frame of the video, `at` seconds in, on a canvas of its own (to look at one without recording). */
export function videoFrame(format, song, at) {
  const L = videoLayout(format), c = new OffscreenCanvas(L.w, L.h);
  film(format, song)(c.getContext('2d'), at);
  return c;
}
