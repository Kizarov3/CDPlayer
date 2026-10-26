// The Now Playing card as a video (the card's VIDEO 9:16 and VIDEO 1:1): the disc sliding out of its case and turning,
// the song's name, the lines of its lyrics as they're sung — and the song itself, for as long as the lines picked on
// the card are sung (eight seconds from where it's playing, with none). Recorded as it happens, from a canvas and the audio engine, as MP4 (or WebM where MP4 can't be made).
// Each design has its own (SCENES): as the card does, each theme's under the CLASSIC look, and each other look's.
import { rgb, lerpColor, FONT as BASE_FONT, drawThemeImage } from './theme.js';
import { t } from './i18n.js';

export const VIDEO_SECONDS = 8, MIN_VIDEO_SECONDS = 2, MAX_VIDEO_SECONDS = 60;
const FPS = 30, SLIDE_S = 0.8, TURNS_PER_S = 0.35, LINE_S = 0.35;

/** Where everything stands in a '9:16' (Stories) or '1:1' video: { w, h, case, disc: { x0, x1, y, r }, names, lyrics }. */
export function videoLayout(format) {
  if (format === '9:16') {
    return { w: 1080, h: 1920, case: { x: 110, y: 230, w: 660, h: 660 }, disc: { x0: 440, x1: 700, y: 560, r: 310 },
      art: { x: 90, y: 150, w: 900, h: 800 }, names: { x: 90, y: 1010, w: 900, h: 360 }, lyrics: { x: 90, y: 1420, w: 900, h: 400 } };
  }
  return { w: 1080, h: 1080, case: { x: 70, y: 80, w: 440, h: 440 }, disc: { x0: 290, x1: 470, y: 300, r: 205 },
    art: { x: 70, y: 50, w: 940, h: 500 }, names: { x: 70, y: 590, w: 940, h: 190 }, lyrics: { x: 70, y: 800, w: 940, h: 220 } };
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

// ---- Drawing ----------------------------------------------------------------------------------------------------

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
const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

// What doesn't move — the background, washed with the cover — drawn once.
function backdrop(L, song, colors, scene) {
  const c = new OffscreenCanvas(L.w, L.h), g = c.getContext('2d');
  if (scene.back) { scene.back(g, L, song, colors, seeded(song.title)); return c; }
  g.fillStyle = rgb(colors.bg); g.fillRect(0, 0, L.w, L.h);
  if (song.backdrop) drawThemeImage(g, L.w, L.h, song.backdrop.image, song.backdrop);
  else if (song.cover) { g.save(); g.filter = 'blur(80px) saturate(1.3)'; g.globalAlpha = 0.5; g.drawImage(song.cover, -150, -150, L.w + 300, L.h + 300); g.restore(); }
  const shade = g.createLinearGradient(0, 0, 0, L.h);
  shade.addColorStop(0, 'rgba(0,0,0,0.1)'); shade.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = shade; g.fillRect(0, 0, L.w, L.h);
  return c;
}

function drawFrame(g, L, back, s, at) {
  g.drawImage(back, 0, 0);
  (s.scene.art || jewelCase)(g, L, s, at);
  const FONT = s.scene.font || BASE_FONT; // (the design's own type: a terminal's, a streaming app's)
  // The song's name.
  const n = L.names, big = L.w === L.h ? 58 : 84;
  g.textBaseline = 'top'; g.textAlign = 'left';
  let y = n.y;
  const label = s.scene.label === undefined ? t('NOW PLAYING') : typeof s.scene.label === 'function' ? s.scene.label() : s.scene.label;
  if (label) { g.font = `bold ${L.w === L.h ? 24 : 30}px ${FONT}`; g.fillStyle = rgb(s.colors.accent); g.fillText(label, n.x, y); y += L.w === L.h ? 44 : 56; }
  g.font = `bold ${big}px ${FONT}`; g.fillStyle = rgb(s.colors.text);
  for (const line of wrap(g, s.title, n.w, 2)) { g.fillText(line, n.x, y); y += big * 1.12; }
  g.font = `${Math.round(big * 0.6)}px ${FONT}`; g.fillStyle = rgb(s.colors.accent2);
  if (s.artist) { g.fillText(wrap(g, s.artist, n.w, 1)[0], n.x, y + 6); y += big * 0.75; }
  g.font = `${Math.round(big * 0.45)}px ${FONT}`; g.fillStyle = rgb(s.colors.muted);
  if (s.subtitle) { g.fillText(wrap(g, s.subtitle, n.w, 1)[0], n.x, y + 10); y += big * 0.45 + 10; }
  // A name on two lines runs past where the lyrics start (in the square video): they start below it instead.
  const top = Math.max(L.lyrics.y, Math.round(y + 30));
  drawLyrics(g, { ...L.lyrics, y: top, h: L.lyrics.h - (top - L.lyrics.y) }, s, lyricsAt(s.timed, s.position()), L.w === L.h ? 44 : 64);
  g.font = `bold 22px ${FONT}`; g.fillStyle = rgb(s.colors.muted); g.textAlign = 'right'; g.textBaseline = 'alphabetic';
  g.fillText('CDPlayer', L.w - 40, L.h - 40);
}

// The lines as they're sung: the one now, bright, and the next, faint. When the line changes, the one that was sung
// drifts up and fades, the next rises into its place as it grows and brightens, and the one after fades in below.
function drawLyrics(g, l, s, lyr, size) {
  const p = ease(lyr.since / LINE_S), lead = size * 1.25, width = l.w - 30, FONT = s.scene.font || BASE_FONT;
  const font = (px, bold) => `italic ${bold ? 'bold ' : ''}${Math.round(px)}px ${FONT}`;
  const heightOf = (text) => { if (!text) return 0; g.font = font(size, true); return wrap(g, text, width, 2).length * lead; };
  const from = l.y + heightOf(lyr.previous) + 14; // where the line now sung was, as the next one
  g.save();
  g.beginPath(); g.rect(l.x, l.y - 20, l.w, l.h + 20); g.clip();
  g.textBaseline = 'top'; g.textAlign = 'left';
  if (lyr.previous && p < 0.5) {
    g.globalAlpha = 1 - p * 2; // gone before the next is halfway up, so the two don't run into each other
    g.font = font(size, true); g.fillStyle = rgb(s.colors.text);
    let y = l.y - size * 0.4 * p;
    for (const line of wrap(g, lyr.previous, width, 2)) { g.fillText(line, l.x + 30, y); y += lead; }
  }
  let y = l.y;
  if (lyr.current) {
    const px = size * (0.75 + 0.25 * p);
    y = from + (l.y - from) * p;
    g.globalAlpha = p; g.fillStyle = rgb(s.colors.accent); g.fillRect(l.x, l.y + 4, 5, size * 1.2 * p);
    g.globalAlpha = 1; g.font = font(px, true); g.fillStyle = rgb(lerpColor(s.colors.muted, s.colors.text, p));
    for (const line of wrap(g, lyr.current, width, 2)) { g.fillText(line, l.x + 30, y); y += px * 1.25; }
  } else y = (from - 14) * (1 - p) + l.y * p; // a break: the next line rises to the top
  if (lyr.next && y + size < l.y + l.h) {
    g.globalAlpha = lyr.current ? p : 1; g.font = font(size * 0.75, false); g.fillStyle = rgb(s.colors.muted);
    g.fillText(wrap(g, lyr.next, width, 1)[0], l.x + 30, y + 14 + (lyr.current ? 24 * (1 - p) : 0));
  }
  g.restore();
}

// ---- Each design's scene: what moves in the top part, over its background ----------------------------------------

// (the same stars, flakes, leaves for the same song each time)
function seeded(text) {
  let h = 2166136261;
  for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
// The cover, square and cropped to its middle (none: the disc as drawn).
function cover(g, s, x, y, size) {
  if (!s.cover) { g.drawImage(s.face, x, y, size, size); return; }
  const iw = s.cover.naturalWidth || s.cover.width, ih = s.cover.naturalHeight || s.cover.height, m = Math.min(iw, ih);
  g.drawImage(s.cover, (iw - m) / 2, (ih - m) / 2, m, m, x, y, size, size);
}
const shadow = (g, blur, dy, alpha, draw) => { g.save(); g.shadowColor = `rgba(0,0,0,${alpha})`; g.shadowBlur = blur; g.shadowOffsetY = dy; draw(); g.restore(); };
const fit = (L, k = 1) => { const a = L.art, size = Math.min(a.w, a.h) * k; return { x: a.x + (a.w - size) / 2, y: a.y + (a.h - size) / 2, size }; };
const MONO = '"SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';
const SYSTEM = '-apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
const dark = (g, L, colors, k = 0.5) => { g.fillStyle = rgb(colors.bg); g.fillRect(0, 0, L.w, L.h); g.fillStyle = `rgba(0,0,0,${k})`; g.fillRect(0, 0, L.w, L.h); };
// Things falling — snow, leaves — each from where the seed put it, wrapping round to the top.
function falling(L, rnd, n) { return Array.from({ length: n }, () => ({ x: rnd() * L.w, y: rnd() * L.h, v: 40 + rnd() * 90, r: rnd(), a: rnd() * 6.3, sway: rnd() * 6.3 })); }

// RED: the disc sliding out of its case and turning (as the video always was).
function jewelCase(g, L, s, at) {
  // The disc, sliding out from behind its case, then turning.
  const d = L.disc, x = d.x0 + (d.x1 - d.x0) * ease(at / SLIDE_S);
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 30;
  g.beginPath(); g.arc(x, d.y, d.r, 0, Math.PI * 2); g.fillStyle = '#111'; g.fill();
  g.restore();
  g.save();
  g.beginPath(); g.arc(x, d.y, d.r, 0, Math.PI * 2); g.clip();
  g.translate(x, d.y); g.rotate(at * TURNS_PER_S * Math.PI * 2);
  g.drawImage(s.face, -d.r, -d.r, d.r * 2, d.r * 2);
  g.restore();
  // A glint across it, staying put while it turns.
  const glint = g.createLinearGradient(x - d.r, d.y - d.r, x + d.r, d.y + d.r);
  glint.addColorStop(0.35, 'rgba(255,255,255,0)'); glint.addColorStop(0.5, 'rgba(255,255,255,0.18)'); glint.addColorStop(0.65, 'rgba(255,255,255,0)');
  g.save(); g.beginPath(); g.arc(x, d.y, d.r, 0, Math.PI * 2); g.clip(); g.fillStyle = glint; g.fillRect(x - d.r, d.y - d.r, d.r * 2, d.r * 2); g.restore();
  // The case over it: the cover under the plastic, its hinge down the left.
  const c = L.case;
  g.save(); g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 40; g.shadowOffsetY = 14; g.fillStyle = '#16161a'; g.fillRect(c.x, c.y, c.w, c.h); g.restore();
  if (s.cover) {
    const iw = s.cover.naturalWidth || s.cover.width, ih = s.cover.naturalHeight || s.cover.height, m = Math.min(iw, ih);
    g.drawImage(s.cover, (iw - m) / 2, (ih - m) / 2, m, m, c.x, c.y, c.w, c.h);
  } else g.drawImage(s.face, c.x + c.w * 0.1, c.y + c.h * 0.1, c.w * 0.8, c.h * 0.8);
  const hinge = g.createLinearGradient(c.x, 0, c.x + 18, 0);
  hinge.addColorStop(0, 'rgba(0,0,0,0.4)'); hinge.addColorStop(1, 'rgba(255,255,255,0.16)');
  g.fillStyle = hinge; g.fillRect(c.x, c.y, 18, c.h);
  const gloss = g.createLinearGradient(c.x, c.y, c.x + c.w * 0.7, c.y + c.h * 0.9);
  gloss.addColorStop(0, 'rgba(255,255,255,0.16)'); gloss.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.fillStyle = gloss; g.fillRect(c.x, c.y, c.w, c.h);
}

// BLUE: the disc out of its case, big, turning, the light running round its rings.
function discOut(g, L, s, at) {
  const { x, y, size } = fit(L, 0.92), r = size / 2, cx = x + r, cy = y + r;
  shadow(g, 40, 12, 0.6, () => { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = '#c9ccd2'; g.fill(); });
  g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.arc(cx, cy, r * 0.09, 0, Math.PI * 2, true); g.clip('evenodd');
  g.translate(cx, cy); g.rotate(at * TURNS_PER_S * Math.PI * 2); g.drawImage(s.face, -r, -r, r * 2, r * 2); g.rotate(-at * TURNS_PER_S * Math.PI * 2);
  const sheen = g.createConicGradient(-0.6 - at * 0.8, 0, 0);
  [[0, 0], [0.12, 0.3], [0.22, 0], [0.5, 0], [0.62, 0.24], [0.72, 0], [1, 0]].forEach(([o, a]) => sheen.addColorStop(o, `rgba(${s.colors.accent2.join(',')},${a})`));
  g.fillStyle = sheen; g.fillRect(-r, -r, r * 2, r * 2);
  g.restore();
}

// SUNSET: the sun going down behind the cover, the grid running towards you.
function sunsetBack(g, L, song, colors) {
  const hz = L.art.y + L.art.h * 0.78, sky = g.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0, rgb(colors.bg)); sky.addColorStop(0.55, rgb(colors.accent2, 0.55)); sky.addColorStop(1, rgb(colors.accent, 0.9));
  g.fillStyle = rgb(colors.bg); g.fillRect(0, 0, L.w, L.h);
  g.fillStyle = sky; g.fillRect(0, 0, L.w, hz);
}
function sunset(g, L, s, at) {
  const a = L.art, hz = a.y + a.h * 0.78, sx = L.w / 2, sr = Math.min(a.w * 0.4, a.h * 0.62), sink = Math.min(1, at / 20) * sr * 0.35;
  g.save(); g.beginPath(); g.rect(0, 0, L.w, hz); g.clip();
  const sun = g.createLinearGradient(0, hz - sr * 2, 0, hz); sun.addColorStop(0, '#ffe08a'); sun.addColorStop(1, rgb(s.colors.accent));
  g.fillStyle = sun; g.beginPath(); g.arc(sx, hz + sink, sr, Math.PI, 0); g.fill();
  g.fillStyle = rgb(s.colors.accent2, 0.85);
  for (let i = 0; i < 7; i++) { const y = hz - sr * 0.55 + ((i * 22 + at * 14) % 154); g.fillRect(sx - sr, y, sr * 2, 3 + (y - (hz - sr * 0.55)) / 16); }
  g.restore();
  g.fillStyle = rgb(s.colors.bg); g.fillRect(0, hz, L.w, a.y + a.h + 40 - hz);
  g.save(); g.beginPath(); g.rect(0, hz, L.w, a.y + a.h + 40 - hz); g.clip();
  g.strokeStyle = rgb(s.colors.accent2, 0.7); g.lineWidth = 2;
  for (let i = -16; i <= 16; i++) { g.beginPath(); g.moveTo(sx + i * 30, hz); g.lineTo(sx + i * 190, a.y + a.h + 40); g.stroke(); }
  const deep = a.y + a.h + 40 - hz;
  for (let k = 0; k < 8; k++) { const f = ((k + (at * 0.6) % 1) / 8) ** 1.8; g.beginPath(); g.moveTo(0, hz + deep * f); g.lineTo(L.w, hz + deep * f); g.stroke(); }
  g.restore();
  const size = Math.min(a.h * 0.6, sr * 1.15), x = sx - size / 2, y = hz - size - 20; // (the sun round it, not behind it)
  shadow(g, 50, 20, 0.55, () => { g.fillStyle = '#fff'; g.fillRect(x - 10, y - 10, size + 20, size + 20); });
  cover(g, s, x, y, size);
}

// FOREST: a polaroid coming up as it develops, swaying a little where it hangs.
function polaroid(g, L, s, at) {
  const { size } = fit(L, 0.74), pw = size + 50, ph = size + 140, a = L.art;
  g.save(); g.translate(a.x + a.w / 2, a.y + a.h / 2); g.rotate(-0.05 + Math.sin(at * 1.3) * 0.02);
  shadow(g, 34, 16, 0.55, () => { g.fillStyle = '#f4f1e8'; g.fillRect(-pw / 2, -ph / 2, pw, ph); });
  cover(g, s, -size / 2, -ph / 2 + 25, size);
  g.fillStyle = `rgba(240,236,224,${1 - ease(at / 3.2)})`; g.fillRect(-size / 2, -ph / 2 + 25, size, size); // (still developing)
  g.fillStyle = '#2b3a2f'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.font = `${Math.round(size * 0.08)}px "Marker Felt", "Segoe Print", "Bradley Hand", cursive`;
  g.fillText(wrap(g, s.title, size - 20, 1)[0] || '', 0, ph / 2 - 40);
  g.fillStyle = rgb(s.colors.accent2, 0.75); g.rotate(0.12); g.fillRect(-70, -ph / 2 - 18, 140, 38);
  g.restore();
}

// GALAXY: the cover a planet, turning, its ring round it, the stars twinkling.
function galaxyBack(g, L, song, colors) {
  g.fillStyle = rgb(colors.bg); g.fillRect(0, 0, L.w, L.h);
  const neb = g.createRadialGradient(L.w / 2, L.art.y + L.art.h / 2, 20, L.w / 2, L.art.y + L.art.h / 2, L.w * 0.8);
  neb.addColorStop(0, rgb(colors.accent, 0.35)); neb.addColorStop(0.5, rgb(colors.accent2, 0.12)); neb.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = neb; g.fillRect(0, 0, L.w, L.h);
}
function planet(g, L, s, at) {
  const rnd = seeded(s.title);
  for (let i = 0; i < 220; i++) {
    const x = rnd() * L.w, y = rnd() * L.h, r = rnd() ** 3 * 2.4 + 0.5, tw = 0.5 + 0.5 * Math.sin(at * (1 + rnd() * 3) + rnd() * 6.3);
    g.fillStyle = `rgba(255,255,255,${0.25 + tw * 0.65})`; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const a = L.art, px = a.x + a.w / 2, py = a.y + a.h / 2, pr = Math.min(a.w, a.h) * 0.33;
  const ring = (front) => {
    g.save(); g.translate(px, py); g.rotate(-0.35); g.scale(1, 0.26);
    g.beginPath(); g.arc(0, 0, pr * 1.6, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
    g.lineWidth = 30; g.strokeStyle = rgb(s.colors.accent2, 0.5); g.stroke(); g.lineWidth = 7; g.strokeStyle = rgb(s.colors.accent, 0.8); g.stroke();
    g.restore();
  };
  ring(false);
  g.save(); g.shadowColor = rgb(s.colors.accent, 0.8); g.shadowBlur = 70; g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fillStyle = rgb(s.colors.bg); g.fill(); g.restore();
  g.save(); g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.clip();
  const slide = (at * 18) % (pr * 2); // (turning: the cover going round, as on a globe)
  cover(g, s, px - pr - slide, py - pr, pr * 2); cover(g, s, px + pr - slide, py - pr, pr * 2);
  const night = g.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.2, px, py, pr * 1.05);
  night.addColorStop(0, 'rgba(255,255,255,0.12)'); night.addColorStop(0.6, 'rgba(0,0,0,0)'); night.addColorStop(1, 'rgba(0,0,0,0.65)');
  g.fillStyle = night; g.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  g.restore();
  ring(true);
}

// OCEAN: the cover above the water, its reflection rippling.
function reflection(g, L, s, at) {
  const a = L.art, size = a.h * 0.6, x = a.x + (a.w - size) / 2, y = a.y + 10, water = y + size + 6, depth = a.y + a.h + 30 - water;
  shadow(g, 30, 10, 0.5, () => { g.fillStyle = '#111'; g.fillRect(x, y, size, size); });
  cover(g, s, x, y, size);
  const sea = g.createLinearGradient(0, water, 0, water + depth);
  sea.addColorStop(0, rgb(s.colors.accent, 0.25)); sea.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sea; g.fillRect(0, water, L.w, depth);
  if (s.cover) {
    const iw = s.cover.naturalWidth || s.cover.width, ih = s.cover.naturalHeight || s.cover.height, m = Math.min(iw, ih);
    for (let k = 0; k < depth; k += 3) {
      const src = (ih - m) / 2 + m * (1 - (k + 1.5) / size);
      if (src < (ih - m) / 2) break;
      g.globalAlpha = 0.45 * (1 - k / depth);
      g.drawImage(s.cover, (iw - m) / 2, src, m, m * 3 / size, x + Math.sin(k / 7 + at * 3) * (2 + k / 25), water + k, size, 3);
    }
    g.globalAlpha = 1;
  }
  g.strokeStyle = rgb(s.colors.accent2, 0.3); g.lineWidth = 2;
  for (let k = 0; k < 6; k++) { const yy = water + 20 + k * (depth / 6); g.beginPath(); for (let xx = 0; xx <= L.w; xx += 20) g.lineTo(xx, yy + Math.sin(xx / 40 + k + at * 2) * 3); g.stroke(); }
}

// MATRIX: the glyphs raining down, the cover coming up out of big green pixels into small ones.
function matrix(g, L, s, at) {
  const rnd = seeded(s.title);
  g.font = `22px ${MONO}`; g.textBaseline = 'top'; g.textAlign = 'left';
  for (let x = 12; x < L.w; x += 26) {
    const len = 6 + Math.floor(rnd() * 18), speed = 120 + rnd() * 260, y0 = ((rnd() * L.h + at * speed) % (L.h + len * 26)) - len * 26;
    for (let k = 0; k < len; k++) {
      g.fillStyle = rgb(s.colors.accent, k === len - 1 ? 0.6 : 0.05 + 0.18 * (k / len));
      g.fillText(String.fromCharCode(0x30a0 + Math.floor((rnd() * 96 + at * 3 * (k % 3)) % 96)), x, y0 + k * 26);
    }
  }
  const { x, y, size } = fit(L, 0.8), px = Math.round(10 + 54 * ease(at / 3)), small = new OffscreenCanvas(px, px), c = small.getContext('2d');
  cover(c, s, 0, 0, px);
  const d = c.getImageData(0, 0, px, px);
  for (let i = 0; i < d.data.length; i += 4) {
    const v = (d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11) / 255;
    d.data[i] = s.colors.accent[0] * v * 0.6; d.data[i + 1] = 40 + s.colors.accent[1] * v; d.data[i + 2] = s.colors.accent[2] * v * 0.6;
  }
  c.putImageData(d, 0, 0);
  g.fillStyle = '#020503'; g.fillRect(x, y, size, size);
  g.imageSmoothingEnabled = false; g.drawImage(small, x, y, size, size); g.imageSmoothingEnabled = true;
  g.strokeStyle = rgb(s.colors.accent, 0.6); g.lineWidth = 2; g.strokeRect(x - 10, y - 10, size + 20, size + 20);
}

// AUTUMN: a ticket to the show, the leaves coming down past it.
function ticket(g, L, s, at) {
  const a = L.art, tw = a.w, th = Math.min(a.h * 0.75, tw * 0.5), tx = a.x, ty = a.y + (a.h - th) / 2, stub = th, notch = 22;
  g.save(); g.beginPath(); g.rect(tx, ty, tw, th); g.clip();
  shadow(g, 30, 12, 0.5, () => {
    g.beginPath(); g.roundRect(tx, ty, tw, th, 14);
    for (const y of [ty, ty + th]) { g.moveTo(tx + stub + notch, y); g.arc(tx + stub, y, notch, 0, Math.PI * 2); }
    g.fillStyle = '#f3e6d0'; g.fill('evenodd');
  });
  g.restore();
  g.setLineDash([8, 9]); g.strokeStyle = 'rgba(80,50,30,0.45)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(tx + stub, ty + notch + 6); g.lineTo(tx + stub, ty + th - notch - 6); g.stroke(); g.setLineDash([]);
  cover(g, s, tx + 28, ty + 28, th - 56);
  g.fillStyle = rgb(s.colors.accent2); g.font = `bold ${Math.round(th * 0.09)}px ${BASE_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('ADMIT ONE', tx + stub + (tw - stub) / 2, ty + th / 2);
  for (const f of falling(L, seeded(s.title), 30)) {
    const y = (f.y + at * f.v * 0.8) % (L.h + 40) - 20, x = f.x + Math.sin(at * 1.4 + f.sway) * 30;
    g.save(); g.translate(x, y); g.rotate(f.a + at * (f.r - 0.5) * 3);
    g.fillStyle = rgb(f.r < 0.5 ? s.colors.accent : s.colors.accent2, 0.35 + f.r * 0.4);
    g.beginPath(); g.ellipse(0, 0, 18 + f.r * 10, 8 + f.r * 4, 0, 0, Math.PI * 2); g.fill(); g.restore();
  }
}

// SNOW: snow falling past a frosted frame.
function frost(g, L, s, at) {
  const { x, y, size } = fit(L, 0.84);
  shadow(g, 40, 14, 0.5, () => { g.fillStyle = '#eef3f8'; g.beginPath(); g.roundRect(x - 16, y - 16, size + 32, size + 32, 12); g.fill(); });
  cover(g, s, x, y, size);
  const rim = g.createLinearGradient(0, y + size - 60, 0, y + size);
  rim.addColorStop(0, 'rgba(255,255,255,0)'); rim.addColorStop(1, 'rgba(255,255,255,0.5)');
  g.fillStyle = rim; g.fillRect(x, y + size - 60, size, 60);
  for (const f of falling(L, seeded(s.title), 200)) {
    const yy = (f.y + at * f.v * 0.6) % L.h, xx = f.x + Math.sin(at + f.sway) * 14;
    g.fillStyle = `rgba(255,255,255,${0.35 + f.r * 0.55})`; g.beginPath(); g.arc(xx, yy, 1.2 + f.r * f.r * 4.5, 0, Math.PI * 2); g.fill();
  }
}

// AUTO, COVER: as a streaming app has it — the cover big, rounded, breathing a little; the song going along under it.
function streamApp(g, L, s, at) {
  const { x, y, size } = fit(L, 0.9), k = 1 + 0.015 * Math.sin(at * 2.2), sz = size * k, xx = x - (sz - size) / 2, yy = y - (sz - size) / 2;
  shadow(g, 50, 20, 0.55, () => { g.fillStyle = '#000'; g.beginPath(); g.roundRect(xx, yy, sz, sz, 28); g.fill(); });
  g.save(); g.beginPath(); g.roundRect(xx, yy, sz, sz, 28); g.clip(); cover(g, s, xx, yy, sz); g.restore();
  bar(g, L, s, y + size + 26);
}
function bar(g, L, s, y) { // a progress bar, moving with the song
  const a = L.art, w = a.w * 0.8, x = a.x + (a.w - w) / 2, f = s.duration ? Math.min(1, s.position() / s.duration) : 0;
  g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.roundRect(x, y, w, 6, 3); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.roundRect(x, y, w * f, 6, 3); g.fill();
  g.beginPath(); g.arc(x + w * f, y + 3, 9, 0, Math.PI * 2); g.fill();
}

// COVER (the look): the cover edge to edge, slowly drawing closer.
function fullBleed(g, L, s, at) {
  const a = L.art, k = 1 + 0.08 * ease(at / 12), w = L.w * k, top = a.y + a.h + 40;
  g.save(); g.beginPath(); g.rect(0, 0, L.w, top); g.clip();
  cover(g, s, (L.w - w) / 2, (top - w) / 2, w); // (its middle in the middle of what shows)
  const fade = g.createLinearGradient(0, top - 260, 0, top);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, rgb(s.colors.bg));
  g.fillStyle = fade; g.fillRect(0, top - 260, L.w, 260);
  g.restore();
}

// DOCK: the cover over a bar of keys, the song going along the bar, PLAY breathing.
function dockBar(g, L, s, at) {
  const a = L.art, bh = 110, by = a.y + a.h - bh + 30, size = by - a.y - 40, x = a.x + (a.w - size) / 2;
  shadow(g, 36, 12, 0.55, () => { g.fillStyle = '#16161a'; g.beginPath(); g.roundRect(x, a.y, size, size, 16); g.fill(); });
  g.save(); g.beginPath(); g.roundRect(x, a.y, size, size, 16); g.clip(); cover(g, s, x, a.y, size); g.restore();
  shadow(g, 30, 10, 0.45, () => { g.fillStyle = rgb(s.colors.card || s.colors.bg, 0.9); g.beginPath(); g.roundRect(a.x, by, a.w, bh, 24); g.fill(); });
  const px = a.x + 40, pw = a.w - 80, f = s.duration ? Math.min(1, s.position() / s.duration) : 0;
  g.fillStyle = 'rgba(255,255,255,0.16)'; g.beginPath(); g.roundRect(px, by + 24, pw, 6, 3); g.fill();
  g.fillStyle = rgb(s.colors.accent); g.beginPath(); g.roundRect(px, by + 24, pw * f, 6, 3); g.fill();
  g.beginPath(); g.arc(px + pw * f, by + 27, 9, 0, Math.PI * 2); g.fill();
  const mid = a.x + a.w / 2, ky = by + 72, r = 28 * (1 + 0.05 * Math.sin(at * 4));
  g.beginPath(); g.arc(mid, ky, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = rgb(s.colors.bg); g.fillRect(mid - 10, ky - 11, 7, 22); g.fillRect(mid + 3, ky - 11, 7, 22);
}

// STAGE: the cover under a spotlight sweeping across the stage.
function stage(g, L, s, at) {
  const a = L.art, size = a.h * 0.62, x = (L.w - size) / 2, y = a.y + 40, floor = y + size + 40, swing = Math.sin(at * 0.9) * 0.18;
  g.save(); g.translate(L.w / 2, 0); g.rotate(swing);
  const cone = g.createLinearGradient(0, 0, 0, floor + 120);
  cone.addColorStop(0, 'rgba(255,255,255,0.24)'); cone.addColorStop(1, rgb(s.colors.accent, 0.05));
  g.fillStyle = cone; g.beginPath(); g.moveTo(-40, 0); g.lineTo(40, 0); g.lineTo(size * 0.75, floor + 120); g.lineTo(-size * 0.75, floor + 120); g.closePath(); g.fill();
  g.restore();
  for (const [x0, dir] of [[L.w * 0.08, 1], [L.w * 0.92, -1]]) {
    const beam = g.createLinearGradient(x0, 0, L.w / 2, floor);
    beam.addColorStop(0, rgb(s.colors.accent2, 0.3)); beam.addColorStop(1, rgb(s.colors.accent2, 0));
    const reach = L.w / 2 + dir * Math.sin(at * 1.3 + dir) * 120;
    g.fillStyle = beam; g.beginPath(); g.moveTo(x0 - 20, 0); g.lineTo(x0 + 20, 0); g.lineTo(reach + 150, floor); g.lineTo(reach - 150, floor); g.closePath(); g.fill();
  }
  const pool = g.createRadialGradient(L.w / 2, floor, 10, L.w / 2, floor, size * 0.9);
  pool.addColorStop(0, rgb(s.colors.accent, 0.4)); pool.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.translate(L.w / 2 + swing * 600, floor); g.scale(1, 0.2); g.translate(-L.w / 2, -floor); g.fillStyle = pool; g.beginPath(); g.arc(L.w / 2, floor, size * 0.9, 0, Math.PI * 2); g.fill(); g.restore();
  shadow(g, 50, 24, 0.7, () => { g.fillStyle = '#111'; g.fillRect(x, y, size, size); });
  cover(g, s, x, y, size);
}

// GLASS: frosted glass, the cover blown up behind it drifting.
function glassBack(g, L, song, colors) {
  g.fillStyle = rgb(colors.bg); g.fillRect(0, 0, L.w, L.h);
}
function glass(g, L, s, at) {
  if (s.cover) {
    s.blurred = s.blurred || (() => { const c = new OffscreenCanvas(270, 270), b = c.getContext('2d'); b.filter = 'blur(14px) saturate(1.5)'; cover(b, s, -20, -20, 310); return c; })();
    const d = 120 * Math.sin(at * 0.5);
    g.drawImage(s.blurred, -200 + d, -200 - d / 2, L.w + 400, L.w + 400);
    g.fillStyle = 'rgba(12,12,14,0.45)'; g.fillRect(0, 0, L.w, L.h);
  }
  const a = L.art, pad = 36;
  shadow(g, 40, 14, 0.35, () => { g.fillStyle = 'rgba(255,255,255,0.1)'; g.beginPath(); g.roundRect(a.x - pad, a.y - pad / 2, a.w + pad * 2, a.h + pad, 34); g.fill(); });
  const edge = g.createLinearGradient(a.x, a.y, a.x + a.w, a.y + a.h);
  edge.addColorStop(0, 'rgba(255,255,255,0.42)'); edge.addColorStop(0.5, 'rgba(255,255,255,0.08)'); edge.addColorStop(1, 'rgba(255,255,255,0.22)');
  g.strokeStyle = edge; g.lineWidth = 1.5; g.beginPath(); g.roundRect(a.x - pad, a.y - pad / 2, a.w + pad * 2, a.h + pad, 34); g.stroke();
  const { x, y, size } = fit(L, 0.86);
  shadow(g, 30, 10, 0.45, () => { g.fillStyle = '#000'; g.beginPath(); g.roundRect(x, y, size, size, 20); g.fill(); });
  g.save(); g.beginPath(); g.roundRect(x, y, size, size, 20); g.clip(); cover(g, s, x, y, size); g.restore();
}

// PANEL: the front of a hi-fi deck — the cover, and its display counting the time, the meters moving.
function metalBack(g, L, song, colors) {
  const metal = g.createLinearGradient(0, 0, 0, L.h);
  metal.addColorStop(0, '#3a3c40'); metal.addColorStop(0.5, '#2a2b2f'); metal.addColorStop(1, '#1d1e21');
  g.fillStyle = metal; g.fillRect(0, 0, L.w, L.h);
  const rnd = seeded(song.title);
  for (let y = 0; y < L.h; y += 2) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.035})`; g.fillRect(0, y, L.w, 1); }
  for (const [x, y] of [[30, 30], [L.w - 30, 30], [30, L.h - 30], [L.w - 30, L.h - 30]]) { g.fillStyle = '#6b6e74'; g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.fill(); }
}
function faceplate(g, L, s, at) {
  const a = L.art, tall = L.h > L.w, size = tall ? a.h * 0.6 : a.h * 0.9, x = tall ? a.x + (a.w - size) / 2 : a.x, y = a.y + (tall ? 0 : (a.h - size) / 2);
  shadow(g, 20, 6, 0.6, () => { g.fillStyle = '#111'; g.fillRect(x - 6, y - 6, size + 12, size + 12); });
  cover(g, s, x, y, size);
  const v = tall ? { x: a.x, y: y + size + 30, w: a.w, h: a.h - size - 30 } : { x: x + size + 40, y, w: a.w - size - 40, h: size };
  g.fillStyle = '#050607'; g.beginPath(); g.roundRect(v.x, v.y, v.w, v.h, 12); g.fill();
  g.fillStyle = rgb(s.colors.accent, 0.035); for (let yy = v.y + 3; yy < v.y + v.h; yy += 4) g.fillRect(v.x + 4, yy, v.w - 8, 1);
  const glow = rgb(s.colors.accent), sec = Math.max(0, Math.floor(s.position()));
  g.save(); g.shadowColor = glow; g.shadowBlur = 16; g.fillStyle = glow; g.textBaseline = 'middle'; g.textAlign = 'left';
  const big = Math.round(Math.min(v.h * 0.45, v.w * 0.16));
  g.font = `bold ${big}px ${MONO}`; g.fillText(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, v.x + 30, v.y + v.h * 0.4);
  const levels = s.levels ? s.levels() : null, n = 16, bw = (v.w - 60) / n;
  for (let i = 0; i < n; i++) {
    const h = (levels ? levels[i % levels.length] : 0.5 + 0.5 * Math.sin(at * 6 + i)) * v.h * 0.22;
    g.globalAlpha = 0.85; g.fillRect(v.x + 30 + i * bw, v.y + v.h * 0.85 - h, bw - 6, h);
  }
  g.restore();
}

const SCENES = {
  RED: { art: jewelCase }, BLUE: { art: discOut }, SUNSET: { art: sunset, back: sunsetBack }, FOREST: { art: polaroid },
  GALAXY: { art: planet, back: galaxyBack }, OCEAN: { art: reflection }, MATRIX: { art: matrix, back: (g, L, song, colors) => { g.fillStyle = '#020503'; g.fillRect(0, 0, L.w, L.h); }, font: MONO, label: () => `> ${t('NOW PLAYING').toLowerCase().replace(/\s+/g, '_')}` },
  AUTUMN: { art: ticket }, SNOW: { art: frost }, AUTO: { art: streamApp, font: SYSTEM, label: null },
  DOCK: { art: dockBar }, STAGE: { art: stage, back: (g, L, song, colors) => dark(g, L, colors, 0.6) }, GLASS: { art: glass, back: glassBack },
  PANEL: { art: faceplate, back: metalBack, font: MONO }, COVER: { art: fullBleed, font: SYSTEM, label: null },
};
/** One frame of the video, `at` seconds in, on a canvas (to look at without recording). */
export function videoFrame(format, song, at) {
  song.scene = song.scene || SCENES.RED;
  const L = videoLayout(format), canvas = new OffscreenCanvas(L.w, L.h);
  drawFrame(canvas.getContext('2d'), L, backdrop(L, song, song.colors, song.scene), song, at);
  return canvas;
}
/** The scene for a design: the PLAYER LOOK's, but for CLASSIC the theme's (a theme people made: the jewel case). */
export function sceneFor(look, theme) { return SCENES[look !== 'CLASSIC' && SCENES[look] ? look : theme] || SCENES.RED; }

/**
 * Records the video: song { cover, face (the disc as drawn), title, artist, subtitle, colors, timed, position() (where
 * the song is now, s), duration (s), scene (sceneFor: the design's) }, audio a MediaStream of what plays (or null: no sound), seconds long, begin() awaited once the
 * frames are ready to go (to put the song where the video starts), onTick(seconds left).
 * playing(): whether the music is still going (it stopping ends the video there).
 * → { bytes: Uint8Array, ext, stoppedEarly } | null (the recorder can't make video here, or it failed).
 */
export async function recordVideo({ format, song, audio, seconds = VIDEO_SECONDS, begin = async () => {}, onTick = () => {}, playing = () => true }) {
  const type = pickVideoType();
  if (!type) return null;
  song.scene = song.scene || SCENES.RED;
  const L = videoLayout(format), back = backdrop(L, song, song.colors, song.scene);
  const canvas = document.createElement('canvas');
  canvas.width = L.w; canvas.height = L.h;
  const g = canvas.getContext('2d');
  drawFrame(g, L, back, song, 0);
  const stream = canvas.captureStream(FPS);
  if (audio) for (const track of audio.getAudioTracks()) stream.addTrack(track);
  const recorder = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: 8e6, audioBitsPerSecond: 192e3 });
  const chunks = [];
  let failed = false;
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onerror = () => { failed = true; };
  const done = new Promise((resolve) => { recorder.onstop = resolve; });
  await begin();
  const t0 = performance.now();
  recorder.start(500);
  // Drawn on a timer, not on animation frames: those slow right down when the window isn't in front.
  let quietSince = null, stoppedEarly = false;
  await new Promise((resolve) => {
    let left = Math.ceil(seconds);
    onTick(left);
    const timer = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      drawFrame(g, L, back, song, t);
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
