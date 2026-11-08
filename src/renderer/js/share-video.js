// The Now Playing card as a video (the card's VIDEO 9:16 and VIDEO 1:1): the song's lines as they're sung, its name,
// and the song itself, for as long as the lines picked on the card are sung (eight seconds from where it's playing, with
// none). Recorded as it happens, from a canvas and the audio engine, as MP4 (or WebM where MP4 can't be made).
// Each PLAYER LOOK is its own film, moved by the music and the words rather than dressed up:
//   CLASSIC — the disc slides out of its case and spins up, the camera creeping in; the lyrics set like liner notes.
//   ALBUM — the cover big and drifting slowly over a field of its own colours; the words light up as they're sung.
//   JEWEL CASE — the shut case swings open on its hinge, the disc turning in its tray; the words light up on a sheet of smoked acrylic.
//   HI-FI — the deck's black glass display is the stage: the lyrics lit in its dots, the meters on the real levels.
//   VISUALIZER — the cover breathing on the bass inside a ring of the music's own spectrum; the line pulsing with it.
//   LYRICS — the words, big, landing one by one as they're sung, the line swept away for the next; the cover a blur.
//   TERMINAL — the console's screen in character cells: the command typed, the frames drawn, the disc in characters
//     coming up out of noise and turning; the words lit a character at a time behind the cursor.
import { rgb, lerpColor, FONT, drawThemeImage } from './theme.js';
import { drawCells, clock } from './deck-display.js';
import { lineWords, songPace } from './lyrics.js';
import { Grid, glyphs, textWidth, clip, stackedLevel, levelChar, seekLevels, asciiCells } from './tui.js';
import { t } from './i18n.js';
import { flattenMp4, mp4Reach } from './mp4-flatten.js';

export const VIDEO_SECONDS = 8, MIN_VIDEO_SECONDS = 2, MAX_VIDEO_SECONDS = 180;
const FPS = 30;

/** Where CLASSIC's things stand in a '9:16' (Stories) or '1:1' video: { w, h, case, disc: { x, y, r }, names, lyrics }. */
export function videoLayout(format) {
  if (format === '9:16') {
    return { w: 1080, h: 1920, case: { x: 100, y: 450, w: 560, h: 560 }, disc: { x: 600, y: 470, r: 237 },
      names: { x: 100, y: 1110, w: 880, h: 130 }, lyrics: { x: 100, y: 1270, w: 880, h: 420 } };
  }
  // (the disc as big as a real one against its case: 120 mm to 142)
  return { w: 1080, h: 1080, case: { x: 60, y: 450, w: 440, h: 440 }, disc: { x: 400, y: 400, r: 186 },
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
 * (`songEnd`, s). 2 s at least, three minutes at most. → { start, end } | null (no line picked).
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
  const small = Math.min(0.85, (L.case.w * 0.46) / d.r);
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

// ---- JEWEL CASE: the case opened on its hinge, the disc turning in its tray, the words on smoked acrylic ---------------

/** Where JEWEL CASE's things stand: { case: { x, y, w, h } (open: the lid out to its left), near (how much bigger it's seen shut), sheet (the page the words are on) }. */
export function caseLayout(format) {
  // (a real one's proportions, 142 × 125 mm)
  if (format === '9:16') return { case: { x: 220, y: 110, w: 820, h: 722 }, near: 1.18, sheet: { x: 70, y: 880, w: 940, h: 950 } };
  return { case: { x: 420, y: 34, w: 620, h: 546 }, near: 1.45, sheet: { x: 50, y: 612, w: 980, h: 434 } };
}

// A case's parts are drawn this much bigger than they stand, for the camera starting close.
const CASE_SCALE = 1.5;

// The lid from the front: the cover under the plastic, the hinge's band down its left. (Column 0 is the hinge, on both sides.)
function lidFront(s, w, h) {
  const c = canvas(w, h), g = c.getContext('2d'), band = w * 0.12, side = w * (120 / 142), top = (h - side) / 2;
  g.beginPath(); g.roundRect(0, 0, w, h, w * 0.008); g.clip();
  g.fillStyle = '#17181b'; g.fillRect(0, 0, w, h);
  g.drawImage(squareCover(s, Math.round(side)), band, top, side, side);
  // the band: dark plastic, its ridges catching the light
  const hinge = g.createLinearGradient(0, 0, band, 0);
  hinge.addColorStop(0, '#0d0e10'); hinge.addColorStop(0.3, '#34363b'); hinge.addColorStop(0.62, '#1b1c20'); hinge.addColorStop(1, '#0c0d0f');
  g.fillStyle = hinge; g.fillRect(0, 0, band, h);
  g.fillStyle = 'rgba(255,255,255,0.1)';
  for (let x = band * 0.2; x < band * 0.9; x += band * 0.17) g.fillRect(x, 0, Math.max(1, w * 0.002), h);
  g.fillStyle = 'rgba(0,0,0,0.42)'; g.fillRect(band, 0, w * 0.007, h);
  const gloss = g.createLinearGradient(0, 0, w * 0.8, h);
  gloss.addColorStop(0, 'rgba(255,255,255,0.2)'); gloss.addColorStop(0.42, 'rgba(255,255,255,0.03)'); gloss.addColorStop(0.43, 'rgba(255,255,255,0)');
  g.fillStyle = gloss; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = Math.max(2, w * 0.003); g.strokeRect(1, 1, w - 2, h - 2);
  return c;
}
// The lid from the inside, the booklet out of it: clear smoked plastic and the tabs that hold it.
function lidInside(s, mean, w, h) {
  const c = canvas(w, h), g = c.getContext('2d');
  g.beginPath(); g.roundRect(0, 0, w, h, w * 0.008); g.clip();
  g.fillStyle = rgb(lerpColor(mean, [12, 12, 14], 0.82)); g.fillRect(0, 0, w, h);
  const light = g.createLinearGradient(w, 0, 0, h);
  light.addColorStop(0, 'rgba(255,255,255,0.15)'); light.addColorStop(0.5, 'rgba(255,255,255,0.02)'); light.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = light; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.1)'; g.strokeStyle = 'rgba(255,255,255,0.26)'; g.lineWidth = Math.max(2, w * 0.003);
  const tab = (x, y, from) => { g.beginPath(); g.arc(x, y, w * 0.055, from, from + Math.PI); g.closePath(); g.fill(); g.stroke(); };
  for (const y of [h * 0.28, h * 0.72]) { tab(w * 0.96, y, Math.PI / 2); tab(w * 0.12, y, -Math.PI / 2); }
  g.strokeRect(1, 1, w - 2, h - 2);
  return c;
}
// The tray under the disc: dark plastic, the round well the disc sits in.
function trayPlastic(w, h, cx, cy, r) {
  const c = canvas(w, h), g = c.getContext('2d');
  g.beginPath(); g.roundRect(0, 0, w, h, w * 0.008); g.clip();
  const base = g.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, '#2b2c30'); base.addColorStop(1, '#141518');
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  for (let x = w * 0.024; x < w * 0.1; x += w * 0.02) g.fillRect(x, 0, Math.max(1, w * 0.002), h);
  const well = g.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.03);
  well.addColorStop(0, '#0b0b0d'); well.addColorStop(0.93, '#0d0d10'); well.addColorStop(1, '#000');
  g.fillStyle = well; g.beginPath(); g.arc(cx, cy, r * 1.03, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.09)'; g.lineWidth = Math.max(2, w * 0.002); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.22)'; g.strokeRect(1, 1, w - 2, h - 2);
  return c;
}
// The hub that holds the disc, its teeth round a dark middle.
function caseHub(r) {
  const size = Math.ceil(r * 2), c = canvas(size, size), g = c.getContext('2d'), m = size / 2;
  const body = g.createRadialGradient(m - r * 0.3, m - r * 0.3, r * 0.1, m, m, r);
  body.addColorStop(0, '#4a4c52'); body.addColorStop(1, '#1b1c20');
  g.fillStyle = body; g.beginPath(); g.arc(m, m, r * 0.98, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = Math.max(2, r * 0.05);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    g.beginPath(); g.moveTo(m + Math.cos(a) * r * 0.42, m + Math.sin(a) * r * 0.42); g.lineTo(m + Math.cos(a) * r * 0.97, m + Math.sin(a) * r * 0.97); g.stroke();
  }
  g.fillStyle = '#08080a'; g.beginPath(); g.arc(m, m, r * 0.38, 0, Math.PI * 2); g.fill();
  return c;
}
/**
 * A lid swung `angle` round its hinge at x = hx (0 shut over its case, π flat out to the left): cut into columns, each
 * as tall and as far along as it stands nearer the camera. Past its edge, the inside shows.
 */
function swingLid(g, front, back, hx, y, w, h, angle) {
  const cos = Math.cos(angle), sin = Math.sin(angle), img = cos >= 0 ? front : back, focal = w * 2.8, N = 72;
  const at = (u) => { const k = focal / (focal - sin * u * w); return { x: hx + cos * u * w * k, h: h * k }; };
  for (let i = 0; i < N; i++) {
    const a = at(i / N), b = at((i + 1) / N), left = Math.min(a.x, b.x), span = Math.abs(b.x - a.x) + 0.7;
    const sx = (i / N) * img.width, tall = (a.h + b.h) / 2, top = y + (h - tall) / 2;
    g.drawImage(img, sx, 0, img.width / N, img.height, left, top, span, tall);
  }
  // Turned from the light, it darkens: one shape over it all (column by column, the overlaps would show as stripes).
  const end = at(1), mid = y + h / 2;
  g.fillStyle = `rgba(0,0,0,${0.5 * sin})`;
  g.beginPath(); g.moveTo(hx, y); g.lineTo(end.x, mid - end.h / 2); g.lineTo(end.x, mid + end.h / 2); g.lineTo(hx, y + h); g.closePath(); g.fill();
}
// The page the words are on: a sheet of smoked acrylic, the cover's colour deep in it, its edge catching the light. → { canvas, pad }.
function acrylicSheet(w, h, mean) {
  const pad = 44, radius = 10, c = canvas(w + pad * 2, h + pad * 2), g = c.getContext('2d');
  g.save(); g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 36; g.shadowOffsetY = 12;
  g.beginPath(); g.roundRect(pad, pad, w, h, radius); g.fillStyle = rgb(lerpColor(mean, [8, 8, 10], 0.86)); g.fill(); g.restore();
  g.save(); g.beginPath(); g.roundRect(pad, pad, w, h, radius); g.clip();
  const sheen = g.createLinearGradient(pad, pad, pad + w * 0.6, pad + h);
  sheen.addColorStop(0, 'rgba(255,255,255,0.1)'); sheen.addColorStop(0.3, 'rgba(255,255,255,0.02)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sheen; g.fillRect(pad, pad, w, h); g.restore();
  g.beginPath(); g.roundRect(pad + 1, pad + 1, w - 2, h - 2, radius); g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 2; g.stroke();
  return { canvas: c, pad };
}

function caseFilm(L, s, lines, start) {
  const tall = L.h > L.w, W = L.w, H = L.h, F = caseLayout(tall ? '9:16' : '1:1'), C = F.case, P = F.sheet;
  const pal = coverColors(s) || { mean: s.colors.bg, vivid: s.colors.accent };
  // What it all lies on: smoked acrylic, the cover's colours deep under it.
  const back = canvas(W, H), bg = back.getContext('2d');
  bg.fillStyle = rgb(lerpColor(pal.mean, [0, 0, 0], 0.72)); bg.fillRect(0, 0, W, H);
  const field = coverField(s, pal.mean), D = Math.hypot(W, H) * 1.2;
  bg.globalAlpha = 0.34; bg.drawImage(field, (W - D) / 2, (H - D) / 2, D, D); bg.globalAlpha = 1;
  const under = bg.createRadialGradient(W / 2, H * 0.3, W * 0.15, W / 2, H * 0.45, Math.max(W, H) * 0.8);
  under.addColorStop(0, 'rgba(0,0,0,0)'); under.addColorStop(1, 'rgba(0,0,0,0.6)');
  bg.fillStyle = under; bg.fillRect(0, 0, W, H);
  // The case's parts, made once.
  const q = CASE_SCALE, cw = Math.round(C.w * q), ch = Math.round(C.h * q);
  const front = lidFront(s, cw, ch), inside = lidInside(s, pal.mean, cw, ch);
  const dx = C.w * (77 / 142), dy = C.h / 2, r = C.w * (60 / 142) * 0.985;
  const tray = trayPlastic(cw, ch, dx * q, dy * q, r * q), hub = caseHub(r * 0.17 * q);
  const light = discLight(Math.round(r * q)), shade = discShadow(Math.round(r * q));
  const flat = canvas(C.w + 120, C.h + 120), fg = flat.getContext('2d');
  fg.shadowColor = 'rgba(0,0,0,0.65)'; fg.shadowBlur = 42; fg.shadowOffsetY = 18;
  fg.fillStyle = '#000'; fg.fillRect(60, 60, C.w, C.h);
  // The page: the track's number and the song's name, who it's by, a rule in the cover's colour; the credit at its foot.
  const page = acrylicSheet(P.w, P.h, pal.mean), inset = tall ? 64 : 44, colour = lit(pal.vivid, 0.5);
  const textW = P.w - inset * 2, cap = tall ? 34 : 24, headH = tall ? 124 : 78;
  const notes = lines.length ? lines : nameAsLine(s, start), noLyrics = !lines.length;
  const size = noLyrics ? (tall ? 84 : 54) : tall ? 64 : 38, face = (px) => `700 ${px}px ${SANS}`;
  const layoutOf = (line) => cachedLayout(line, `case${H}`, () => fit(scratch(), line.words, face, size, size * 0.8, textW, tall ? 4 : 2, 1.18));
  const box = { x: P.x + inset, y: P.y + (tall ? 36 : 22) + headH, w: textW, h: P.h - headH - (tall ? 96 : 62) };
  // (no lyrics: the song's name in the middle of the page, rather than a line at the top of an empty one)
  const anchor = noLyrics && notes.length ? Math.max(0, (box.h - layoutOf(notes[0]).height) / 2) : tall ? 104 : 42;
  let glow = 0;
  return (g, at) => {
    const pos = s.position();
    // The lid swings open, slowing as it goes; the camera draws back from the shut case as it does.
    const open = (at - 0.3) / 1.15, angle = Math.PI * (1 - Math.pow(1 - clamp01(open), 2.6));
    const away = inOut((at - 0.12) / 1.3), creep = 0.018 * (1 - Math.exp(-at / 8));
    const k = F.near + (1 - F.near) * away;
    const shutX = (W - C.w) / 2 - C.x, shutY = (H - C.h) / 2 - C.y;
    const moveX = shutX * (1 - away), moveY = shutY * (1 - away), midX = C.x + C.w / 2, midY = C.y + C.h / 2;
    g.save(); g.translate(W / 2, H / 2); g.scale(1 + creep, 1 + creep); g.drawImage(back, -W / 2, -H / 2); g.restore();
    g.save();
    g.translate(midX + moveX, midY + moveY); g.scale(k * (1 + creep), k * (1 + creep)); g.translate(-midX, -midY);
    g.globalAlpha = Math.min(1, 0.85 + away * 0.15);
    g.drawImage(flat, C.x - 60, C.y - 60);
    // Out flat, the lid's shadow lies beside the tray's.
    if (angle > Math.PI * 0.55) { g.globalAlpha = clamp01((angle / Math.PI - 0.55) / 0.45); g.drawImage(flat, C.x - C.w - 60, C.y - 60); }
    g.globalAlpha = 1;
    g.drawImage(tray, C.x, C.y, C.w, C.h);
    // The disc on its hub, spinning up as the lid clears it; the light on it leaps with the bass.
    const X = C.x + dx, Y = C.y + dy, up = 1.6, spun = Math.max(0, at - 0.45), spin = 0.3 * Math.PI * 2;
    const turn = spun < up ? (spin * spun * spun) / (2 * up) : spin * (spun - up / 2);
    const sp = s.spectrum && s.spectrum(8), bass = sp ? Math.min(1, (sp[0] + sp[1]) / 2) : 0;
    glow = Math.max(bass, glow * 0.88);
    const sr = shade.canvas.width / 2 / q;
    g.drawImage(shade.canvas, X - sr, Y - sr, sr * 2, sr * 2);
    g.save(); g.translate(X, Y); g.rotate(turn); g.drawImage(s.face, -r, -r, r * 2, r * 2); g.restore();
    g.save(); g.globalCompositeOperation = 'screen'; g.globalAlpha = Math.min(1, 0.55 + glow * 0.45);
    g.drawImage(light, X - r, Y - r, r * 2, r * 2); g.restore();
    g.drawImage(hub, X - r * 0.17, Y - r * 0.17, r * 0.34, r * 0.34);
    if (angle < 0.002) {
      g.drawImage(front, C.x, C.y, C.w, C.h);
      // Light crossing the shut plastic.
      const sweep = C.x + C.w * (at / 0.6 * 1.5 - 0.3), gl = g.createLinearGradient(sweep - C.w * 0.2, C.y, sweep + C.w * 0.2, C.y + C.h * 0.4);
      gl.addColorStop(0, 'rgba(255,255,255,0)'); gl.addColorStop(0.5, 'rgba(255,255,255,0.2)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gl; g.fillRect(C.x, C.y, C.w, C.h);
    } else if (angle >= Math.PI - 0.002) {
      // (flat: the hinge's edge meets the tray, the lid's inside mirrored away from it)
      g.save(); g.translate(C.x, 0); g.scale(-1, 1); g.drawImage(inside, 0, C.y, C.w, C.h); g.restore();
    } else swingLid(g, front, inside, C.x, C.y, C.w, C.h, angle);
    g.restore();
    // The page slides in from below, once there's room.
    const slid = (H - P.y + page.pad) * (1 - ease((at - 0.55) / 0.85));
    if (slid >= H - P.y + page.pad) return;
    g.save(); g.translate(0, slid);
    g.drawImage(page.canvas, P.x - page.pad, P.y - page.pad);
    g.textBaseline = 'top'; g.textAlign = 'left';
    const hx = P.x + inset, hy = P.y + (tall ? 42 : 24);
    g.font = `700 ${cap}px ${SANS}`; g.letterSpacing = `${cap * 0.16}px`;
    const no = String(s.track || 1).padStart(2, '0');
    g.fillStyle = rgb(colour); g.fillText(no, hx, hy);
    const nw = g.measureText(`${no}  `).width;
    g.fillStyle = 'rgba(255,255,255,0.97)';
    const title = noLyrics ? '' : wrap(g, String(s.title || '').toUpperCase(), textW - nw, 1)[0];
    if (title) g.fillText(title, hx + nw, hy);
    g.font = `500 ${Math.round(cap * 0.7)}px ${SANS}`; g.letterSpacing = `${cap * 0.12}px`; g.fillStyle = 'rgba(255,255,255,0.62)';
    const who = [s.artist, s.subtitle].filter(Boolean).join(' · ').toUpperCase();
    if (who) g.fillText(wrap(g, who, textW - nw, 1)[0], hx + nw, title ? hy + cap * 1.32 : hy + cap * 0.15);
    g.letterSpacing = '0px';
    g.fillStyle = rgb(colour); g.fillRect(hx, P.y + (tall ? 36 : 22) + headH - 12, textW * inOut((at - 0.9) / 0.8), 3);
    // The verses: the line being sung lit word by word, the others dim.
    stack(g, notes, pos, box, { start, anchor, gap: size * 0.5, layoutOf, ahead: tall ? 3 : 1,
      draw: (line, x, y, st) => drawLine(g, layoutOf(line), x, y, box.w, 'left', (part, px, py) => {
        if (noLyrics) { g.fillStyle = `rgba(255,255,255,${clamp01((pos - part.time) / 0.3)})`; g.fillText(part.text, px, py); return; }
        if (!st.current || st.gone) { g.fillStyle = `rgba(255,255,255,${0.26 + 0.6 * st.alpha})`; g.fillText(part.text, px, py); return; }
        wipe(g, part.text, px, py, part.w, sung(part, pos), 'rgba(255,255,255,1)', `rgba(255,255,255,${0.26 + 0.24 * st.alpha})`);
      }, st.edges) });
    mark(g, L, 'rgba(255,255,255,0.5)', P.x + P.w - inset, P.y + P.h - (tall ? 28 : 16));
    g.restore();
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

// ---- TERMINAL: the player's console screen, in character cells ---------------------------------------------------

// As the look draws its cells (look-terminal.js): the frames' lines and the blocks as shapes, so they meet cell to cell.
const T_FONT = '"SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';
const T_LINES = { '─': 'lr', '│': 'ud', '┌': 'rd', '┐': 'ld', '└': 'ru', '┘': 'lu' };
const T_LEVELS = '▁▂▃▄▅▆▇█', T_SHADES = { '░': 0.26, '▒': 0.5, '▓': 0.75 }, T_NOISE = '░▒▓#%@*+=:';
const mmss = (s) => { const v = Math.max(0, Math.floor(s || 0)); return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; };

// The line's characters, each lit or not as far as it's been sung: [{ ch, w, lit }], the words a space apart.
function litGlyphs(line, pos) {
  const out = [];
  line.words.forEach((word, k) => {
    if (k) out.push({ ch: ' ', w: 1, lit: pos >= word.time });
    for (const part of word.parts) {
      const gs = glyphs(part.text), on = Math.round(sung(part, pos) * gs.length);
      gs.forEach((g, i) => out.push({ ...g, lit: i < on }));
    }
  });
  return out;
}
// Glyphs in rows of at most `w` cells, broken at spaces where it can.
function wrapGlyphs(gs, w) {
  const rows = [[]];
  let used = 0, word = [];
  const flush = () => {
    const ww = word.reduce((n, g) => n + g.w, 0);
    if (used && used + ww > w) { rows.push([]); used = 0; }
    for (const g of word) { if (used + g.w > w) { rows.push([]); used = 0; } rows[rows.length - 1].push(g); used += g.w; }
    word = [];
  };
  for (const g of gs) {
    if (g.ch === ' ') { flush(); if (used && used < w) { rows[rows.length - 1].push(g); used++; } } else word.push(g);
  }
  flush();
  return rows.map((r) => { while (r.length && r[r.length - 1].ch === ' ') r.pop(); return r; });
}

function terminalFilm(L, s, lines, start) {
  const C = s.colors, W = L.w, H = L.h, tall = H > W, px = tall ? 27 : 24;
  const g0 = scratch(); g0.font = `${px}px ${T_FONT}`; g0.letterSpacing = '0px';
  const cw = g0.measureText('M').width, ch = Math.round(px * 1.42), ratio = ch / cw;
  const cols = Math.floor((W - 2 * (tall ? 44 : 36)) / cw), rows = Math.floor((H - 2 * (tall ? 60 : 30)) / ch);
  const ox = Math.round((W - cols * cw) / 2), oy = Math.round((H - rows * ch) / 2);
  const shown = lines.length ? lines : nameAsLine(s, start);
  const dim = rgb(C.muted, 0.45), color = (c) => (Array.isArray(c) ? rgb(c) : c === 'dim' ? dim : rgb(C[c] || C.text));
  // Where things go: the prompt on the top row, then the disc's pane (with the song beside it, or under it in Stories), then the words.
  const top = 1, nowH = tall ? 30 : 16;
  const discRows = tall ? 15 : 13, discCols = Math.min(cols - 6, Math.round(discRows * ratio) | 1);
  const disc = tall ? { x: Math.floor((cols - discCols) / 2), y: top + 2 } : { x: 3, y: top + 2 };
  const info = tall ? { x: 3, y: disc.y + discRows + 2, w: cols - 6 } : { x: disc.x + discCols + 4, y: top + 2, w: cols - (disc.x + discCols + 4) - 3 };
  const lyr = { y: top + nowH + 1, h: rows - (top + nowH + 1) };
  const art = canvas(discCols, discRows), ag = art.getContext('2d', { willReadFrequently: true });
  const titleRows = (() => { const r = wrapGlyphs(glyphs(String(s.title || '')), info.w); return r.length > 2 ? [r[0], [...r[1].slice(0, -1), { ch: '…', w: 1 }]] : r; })();
  const who = [s.artist, s.subtitle].filter(Boolean);
  const noise = (k) => T_NOISE[Math.abs(Math.floor(Math.sin(k * 12.9898) * 43758.5453)) % T_NOISE.length];

  return (g, at) => {
    const pos = s.position(), grid = new Grid(cols, rows);
    // (when each part comes up, the screen starting as a console does: the command typed, the frames drawn, the rest after)
    const typed = (x, y, text, color, from, cps = 70, opts) => {
      const n = Math.floor((at - from) * cps);
      if (n <= 0) return;
      const gs = glyphs(text), shownText = gs.slice(0, n).map((q) => q.ch).join('');
      const end = grid.put(x, y, shownText, color, opts);
      if (n < gs.length && end < cols) grid.put(end, y, '█', 'text');
    };
    const frame = (x, y, w, h, title, right, from) => {
      const p = clamp01((at - from) / 0.35);
      if (p <= 0) return;
      if (p >= 1) { grid.box(x, y, w, h, title, right); return; }
      const ring = [];
      for (let i = 0; i < w; i++) ring.push([x + i, y]);
      for (let i = 1; i < h; i++) ring.push([x + w - 1, y + i]);
      for (let i = w - 2; i >= 0; i--) ring.push([x + i, y + h - 1]);
      for (let i = h - 2; i > 0; i--) ring.push([x, y + i]);
      const tmp = new Grid(cols, rows); tmp.box(x, y, w, h);
      for (const [cx, cy] of ring.slice(0, Math.ceil(ring.length * p))) grid.cells[cy][cx] = tmp.cells[cy][cx];
    };
    const prompt = `$ cdplayer --now-playing`;
    typed(0, 0, prompt, 'muted', 0.05, 40);
    if (at > 0.05 + prompt.length / 40 + 0.1 && at < 1.2) grid.put(textWidth(prompt) + 1, 0, '█', 'text');
    const boot = 0.75;
    frame(0, top, cols, nowH, '', '', boot);
    if (at > boot + 0.35) {
      grid.put(2, top, ` ${t('NOW PLAYING')} `, 'accent', { bold: true });
      const right = ` ▶ ${String(s.track || 1).padStart(2, '0')} `;
      grid.put(cols - 2 - textWidth(right), top, right, 'muted');
    }
    frame(0, lyr.y, cols, lyr.h, '', '', boot + 0.15);
    if (at > boot + 0.5) {
      grid.put(2, lyr.y, ` ${t('LYRICS')} `, 'accent', { bold: true });
      grid.put(cols - 13, lyr.y + lyr.h - 1, ' CDPlayer ', 'muted');
    }

    // The disc, in characters as the look has it, turning; it comes up a row at a time out of noise.
    const side = s.face.width, spun = Math.max(0, at - boot), angle = spun < 1.5 ? (2.7 * spun * spun) / 3 : 2.7 * (spun - 0.75);
    ag.setTransform(1, 0, 0, 1, 0, 0); ag.clearRect(0, 0, discCols, discRows);
    ag.setTransform(discCols / side, 0, 0, discRows / side, discCols / 2, discRows / 2); ag.rotate(angle);
    ag.imageSmoothingQuality = 'high'; ag.drawImage(s.face, -side / 2, -side / 2);
    const cells = asciiCells(ag.getImageData(0, 0, discCols, discRows).data, discCols, discRows), reveal = (at - boot - 0.3) / 0.035;
    cells.forEach((row, y) => row.forEach((c, x) => {
      if (!c || y > reveal) return;
      const fresh = reveal - y < 3;
      grid.cells[disc.y + y][disc.x + x] = { ch: fresh ? noise(x * 31 + y * 7 + Math.floor(at * 20)) : c.ch, w: 1, color: fresh ? 'accent' : c.rgb };
    }));

    // The song: its name, who and what, typed in; the levels moving under it; where it's got along the bar.
    let y = info.y;
    const from = boot + 0.45;
    titleRows.forEach((r, i) => typed(info.x, y++, r.map((q) => q.ch).join(''), 'accent', from + i * 0.2, 60, { bold: true }));
    who.forEach((w, i) => typed(info.x, y++, clip(w, info.w), i ? 'muted' : 'text', from + 0.4 + i * 0.15, 80));
    y++;
    const levels = tall ? 4 : 5, bars = s.spectrum ? s.spectrum(info.w) : [], rise = clamp01((at - boot - 0.8) / 0.6);
    for (let r = 0; r < levels; r++) for (let i = 0; i < info.w; i++) {
      const c = stackedLevel((bars[i] || 0) * rise, r, levels);
      if (c !== ' ') grid.put(info.x + i, y + r, c, r < levels / 2 ? 'accent' : 'muted');
    }
    y += levels + 1;
    if (at > boot + 0.9) {
      const el = mmss(pos), rem = s.duration > 0 ? `-${mmss(s.duration - pos)}` : '';
      grid.put(info.x, y, el, 'text');
      if (rem) grid.put(info.x + info.w - textWidth(rem), y, rem, 'muted');
      const bx = info.x + el.length + 1, bw = info.w - el.length - 1 - (rem ? rem.length + 1 : 0);
      if (bw > 3) {
        const shape = seekLevels(s.waveform, bw), hit = s.duration > 0 ? Math.max(0, Math.min(bw - 1, Math.floor((pos / s.duration) * bw))) : -1;
        shape.forEach((v, i) => grid.put(bx + i, y, i === hit ? '█' : levelChar(v), i === hit ? 'text' : i < hit ? 'accent' : 'muted'));
      }
    }

    // The words: the line being sung lit a character at a time, the cursor where the voice is; those sung scrolled up, dim.
    if (at > boot + 0.6) {
      const x0 = 3, w = cols - 6, anchor = lyr.y + 2 + Math.floor((lyr.h - 4) / 3), bottom = lyr.y + lyr.h - 2;
      const i = lineIndex(shown, pos), blink = Math.floor(at * 2) % 2 === 0;
      const put = (k, yy) => {
        const line = shown[k], gs = litGlyphs(line, pos), rowsOf = wrapGlyphs(gs, w), now = k === i;
        return { rows: rowsOf, draw: (ry) => rowsOf.forEach((r, n) => {
          const row = ry + n;
          if (row < lyr.y + 1 || row > bottom) return;
          let x = x0;
          for (const q of r) { grid.put(x, row, q.ch, now ? (q.lit ? 'text' : 'muted') : k === i + 1 ? 'muted' : 'dim', { bold: now && q.lit }); x += q.w; }
          // the cursor after the last lit character, blinking once the line's sung
          if (now) {
            const lastLit = r.reduce((m, q, idx) => (q.lit ? idx : m), -1);
            const done = gs.every((q) => q.lit || q.ch === ' ');
            if (lastLit >= 0 && (lastLit < r.length - 1 || n === rowsOf.length - 1 || !done)) {
              const cx = x0 + r.slice(0, lastLit + 1).reduce((m, q) => m + q.w, 0);
              const onThisRow = n === rowsOf.findLastIndex((rr) => rr.some((q) => q.lit));
              // (a block over the character it's on, that character showing through it, as a console's cursor)
              const under = grid.cells[row][cx];
              if (onThisRow && (!done || blink) && cx < x0 + w) grid.cells[row][cx] = under && under.ch !== ' ' ? { ...under, inv: true } : { ch: '█', w: 1, color: 'accent' };
            }
          }
        }) };
      };
      if (i < 0) { if (blink) grid.put(x0, anchor, '█', 'accent'); }
      else {
        const cur = put(i, anchor);
        cur.draw(anchor);
        for (let k = i - 1, yy = anchor; k >= 0 && yy > lyr.y + 1; k--) { const p = put(k); yy -= p.rows.length; p.draw(yy); }
        for (let k = i + 1, yy = anchor + cur.rows.length; k < shown.length && yy <= bottom; k++) { const p = put(k); p.draw(yy); yy += p.rows.length; }
      }
    }

    // On the canvas, cell by cell.
    g.fillStyle = rgb(C.bg); g.fillRect(0, 0, W, H);
    g.textBaseline = 'alphabetic';
    const fonts = [`${px}px ${T_FONT}`, `bold ${px}px ${T_FONT}`];
    let font = '';
    for (let yy = 0; yy < rows; yy++) for (let xx = 0; xx < cols; xx++) {
      const c = grid.cells[yy][xx];
      if (!c || c.w === 0 || c.ch === ' ') continue;
      const left = Math.round(ox + xx * cw), right = Math.round(ox + (xx + (c.w === 2 ? 2 : 1)) * cw), cy = oy + yy * ch, w = right - left;
      if (c.inv) { g.fillStyle = rgb(C.accent); g.fillRect(left, cy, w, ch); }
      g.fillStyle = c.inv ? rgb(C.bg) : color(c.color);
      const lineDirs = T_LINES[c.ch];
      if (lineDirs) {
        const th = 2, mx = left + Math.floor((w - th) / 2), my = cy + Math.floor((ch - th) / 2);
        if (lineDirs.includes('l')) g.fillRect(left, my, mx - left + th, th);
        if (lineDirs.includes('r')) g.fillRect(mx, my, left + w - mx, th);
        if (lineDirs.includes('u')) g.fillRect(mx, cy, th, my - cy + th);
        if (lineDirs.includes('d')) g.fillRect(mx, my, th, cy + ch - my);
        continue;
      }
      const level = T_LEVELS.indexOf(c.ch);
      if (level >= 0) { const high = Math.max(2, Math.round((ch * (level + 1)) / 8)); g.fillRect(left, cy + ch - high, w, high); continue; }
      if (T_SHADES[c.ch]) { g.globalAlpha = T_SHADES[c.ch]; g.fillRect(left, cy, w, ch); g.globalAlpha = 1; continue; }
      const f = fonts[c.bold ? 1 : 0];
      if (f !== font) { g.font = f; font = f; }
      g.fillText(c.ch, left, cy + Math.round(ch * 0.76), w);
    }
  };
}

// A context to measure type on, when laying lines out ahead of drawing them.
let measuring = null;
const scratch = () => measuring || (measuring = canvas(8, 8).getContext('2d'));

const FILMS = { CLASSIC: classic, ALBUM: album, CASE: caseFilm, HIFI: hifi, VISUALIZER: visualizer, LYRICS: kinetic, TERMINAL: terminalFilm };
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
  // How far the encoder has got with the picture: it can lag behind what's drawn, and what it hasn't got to when the
  // recorder stops is lost — the picture would stop seconds before the sound, on a frozen frame.
  const reach = type.ext === 'mp4' ? mp4Reach() : null;
  let reached = 0;
  recorder.ondataavailable = (e) => {
    if (!e.data.size) return;
    chunks.push(e.data);
    if (reach) e.data.arrayBuffer().then((b) => { reached = reach(new Uint8Array(b)).vide || reached; });
  };
  recorder.onerror = () => { failed = true; };
  const done = new Promise((resolve) => { recorder.onstop = resolve; });
  await begin();
  // The film made once the song is where the video starts (what it draws first is where the music is).
  const draw = film(format, song);
  draw(g, 0);
  const t0 = performance.now();
  recorder.start(500);
  // Drawn on a timer, not on animation frames: those slow right down when the window isn't in front.
  let quietSince = null, until = seconds;
  await new Promise((resolve) => {
    let left = Math.ceil(seconds);
    onTick(left);
    const timer = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      draw(g, t);
      const now = Math.ceil(seconds - t);
      if (now !== left) { left = now; onTick(Math.max(0, now)); }
      // The music stopped (paused, or the song couldn't go on): the video ends there, not on a silent frozen picture.
      if (t < until) {
        if (playing()) quietSince = null; else if (quietSince === null) quietSince = t;
        if (quietSince !== null && t - quietSince > 0.4) until = quietSince;
      }
      // Drawn on past the end till the encoder has the picture up to it (10 s at most); the tail is cut off after.
      if (t >= until && (!reach || reached >= until || t >= until + 10)) { clearInterval(timer); resolve(); }
    }, 1000 / FPS);
  });
  recorder.stop();
  await done;
  for (const track of stream.getVideoTracks()) track.stop();
  if (failed || !chunks.length) return null; // the encoder wouldn't start: nothing to save
  const blob = new Blob(chunks, { type: type.mime });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // The recorder's MP4 comes in fragments, which some players cut off after the first: made a plain one.
  return { bytes: type.ext === 'mp4' ? flattenMp4(bytes, until) : bytes, ext: type.ext, stoppedEarly: until < seconds };
}

/** A look's film, to draw frames of it by hand (to look at them, or time them): → draw(g, at). */
export const videoFilm = film;

/** One frame of the video, `at` seconds in, on a canvas of its own (to look at one without recording). */
export function videoFrame(format, song, at) {
  const L = videoLayout(format), c = new OffscreenCanvas(L.w, L.h);
  film(format, song)(c.getContext('2d'), at);
  return c;
}
