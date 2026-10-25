// The "now playing" card (P, or right-click the disc): a picture of what's on, to paste into a chat or save — the album
// in its jewel case, the song, its artist and album, and a quote from its lyrics (up to ten lines picked, or none), in
// the theme's colours on a wash of the cover. Each theme draws it its own way, and so does each PLAYER LOOK but CLASSIC.
import { rgb, FONT, drawThemeImage } from './theme.js';
import { currentLineIndex, parseLrc } from './lyrics.js';
import { t } from './i18n.js';

const W = 1200, H = 630;
const MARKER_FONT = '"Marker Felt", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
export const MAX_QUOTE_LINES = 10;
const SKIPPED = '…';

/**
 * The lyrics' lines to pick one for the card from (blank lines, breaks and "[Chorus]" labels left out), and which is
 * picked to start with: the one being sung at `position`, or -1 (none) in a break or for untimed lyrics.
 */
export function lyricChoices(raw, position) {
  if (!raw) return { lines: [], picked: -1 };
  const timed = parseLrc(raw);
  if (timed.length) {
    const lines = [], at = currentLineIndex(timed, position);
    let picked = -1;
    timed.forEach((l, i) => {
      const text = String(l.text || '').trim();
      if (!text) return;
      if (i === at) picked = lines.length;
      lines.push(text);
    });
    return { lines, picked };
  }
  const lines = String(raw).split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l && !/^\[.*\]$/.test(l));
  return { lines, picked: -1 };
}

/** "Album · Year" for what's known of them. */
export function cardSubtitle(details) {
  if (!details) return '';
  const year = /\d{4}/.exec((details.credits && details.credits.released) || '');
  return [details.album, year && year[0]].filter(Boolean).join(' · ');
}

/**
 * Text broken between words into up to `lines` lines no wider than `max` (by `width(text)`), the last cut short with
 * an ellipsis when it doesn't all fit.
 */
function wrapText(width, text, max, lines) {
  const words = String(text).split(/\s+/).filter(Boolean), out = [];
  let line = '', cut = false;
  for (const w of words) {
    if (cut) break;
    const next = line ? `${line} ${w}` : w;
    if (width(next) <= max || !line) { line = next; continue; }
    out.push(line); line = w;
    if (out.length === lines) { cut = true; line = ''; }
  }
  if (line) { if (out.length < lines) out.push(line); else cut = true; }
  return out.map((l, i) => {
    let t = i === out.length - 1 && cut ? `${l}…` : l;
    while (width(t) > max && t.length > 1) t = `${t.slice(0, -2)}…`;
    return t;
  });
}
const wrap = (g, text, max, lines) => wrapText((t) => g.measureText(t).width, text, max, lines);

/** The picked lines (indexes into `lines`), in the song's order, with "…" where lines were skipped; null for none. */
export function quoteLines(lines, picked) {
  const at = [...new Set(picked)].filter((i) => i >= 0 && i < lines.length).sort((a, b) => a - b).slice(0, MAX_QUOTE_LINES);
  if (!at.length) return null;
  const out = [];
  at.forEach((i, k) => { if (k && i !== at[k - 1] + 1) out.push(SKIPPED); out.push(lines[i]); });
  return out;
}

/**
 * The quote laid out to fit `maxWidth` × `maxHeight`: the biggest type, 28 px down to 14, at which its lines — each
 * wrapped onto two rows at most, in quotation marks as a whole — fit. `measure(text, size)` → width. →
 * { size, lineHeight, rows: [{ text, skipped }] }
 */
export function layoutQuote(entries, measure, maxWidth, maxHeight) {
  let layout;
  for (let size = 28; size >= 14; size -= 2) {
    const lineHeight = Math.round(size * 1.36), rows = [];
    entries.forEach((line, i) => {
      const skipped = line === SKIPPED;
      const text = `${i === 0 ? '“' : ''}${line}${i === entries.length - 1 ? '”' : ''}`;
      for (const t of skipped ? [text] : wrapText((x) => measure(x, size), text, maxWidth, 2)) rows.push({ text: t, skipped });
    });
    layout = { size, lineHeight, rows };
    if (rows.length * lineHeight <= maxHeight) break;
  }
  return layout;
}

/**
 * The card as PNG bytes. `song`: { cover (image or null), title, artist, subtitle, quote (lines, or null), backdrop };
 * `colors`: the theme's; `theme`: its name — each built-in theme has a card of its own (STYLES), others the jewel case;
 * `look`: the PLAYER LOOK — all but CLASSIC have a card of their own (LOOK_STYLES), in the theme's colours.
 */
export async function drawCard(song, colors, theme = 'RED', look = 'CLASSIC') {
  const canvas = new OffscreenCanvas(W, H), g = canvas.getContext('2d');
  const style = LOOK_STYLES[look] || STYLES[theme] || jewelCase;
  const words = style(g, song, colors, seeded(`${song.title}|${song.artist}`));
  drawWords(g, song, colors, words);
  // Where it's from, small in the corner.
  g.textBaseline = 'alphabetic';
  g.font = `bold 16px ${words.font || FONT}`; g.fillStyle = words.mark || rgb(colors.muted); g.textAlign = 'right';
  g.fillText('CDPlayer', W - 40, H - 32);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

// (the same stars, snowflakes, glyphs for the same song each time)
function seeded(text) {
  let h = 2166136261;
  for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
// The theme's background, washed with a blur of the cover (like the Ambient Background), darker to the right.
function wash(g, song, colors, { alpha = 0.45, shade = [0.15, 0.55] } = {}) {
  g.fillStyle = rgb(colors.bg); g.fillRect(0, 0, W, H);
  if (song.backdrop) drawThemeImage(g, W, H, song.backdrop.image, song.backdrop);
  else if (song.cover) {
    g.save(); g.filter = 'blur(60px) saturate(1.3)'; g.globalAlpha = alpha;
    g.drawImage(song.cover, -100, -100, W + 200, H + 200);
    g.restore();
  }
  const s = g.createLinearGradient(0, 0, W, 0);
  s.addColorStop(0, `rgba(0,0,0,${shade[0]})`); s.addColorStop(1, `rgba(0,0,0,${shade[1]})`);
  g.fillStyle = s; g.fillRect(0, 0, W, H);
}
// The cover, square, cropped to its middle; none: a silver CD-R written on in marker.
function art(g, song, x, y, size) {
  if (song.cover) {
    const iw = song.cover.naturalWidth || song.cover.width, ih = song.cover.naturalHeight || song.cover.height, m = Math.min(iw, ih);
    g.drawImage(song.cover, (iw - m) / 2, (ih - m) / 2, m, m, x, y, size, size);
    return;
  }
  const silver = g.createRadialGradient(x + size / 2, y + size / 2, 0, x + size / 2, y + size / 2, size * 0.7);
  silver.addColorStop(0, '#e9eaec'); silver.addColorStop(1, '#cfd2d6');
  g.fillStyle = silver; g.fillRect(x, y, size, size);
  g.save(); g.translate(x + size / 2, y + size / 2); g.rotate(-0.07);
  g.fillStyle = '#1a1a4e'; g.textAlign = 'center'; g.font = `${Math.round(size * 0.088)}px ${MARKER_FONT}`;
  wrap(g, song.title, size * 0.8, 2).forEach((l, i, all) => g.fillText(l, 0, (i - (all.length - 1) / 2) * size * 0.107));
  g.restore();
}
const shadowed = (g, blur, dy, alpha, draw) => { g.save(); g.shadowColor = `rgba(0,0,0,${alpha})`; g.shadowBlur = blur; g.shadowOffsetY = dy; draw(); g.restore(); };

// ---- each theme's card: draws the background and the artwork; → where the words go and how they look ----

// RED: the album in its jewel case, its hinge down the left.
function jewelCase(g, song, colors) {
  wash(g, song, colors);
  const cs = 430, cx = 90, cy = (H - cs) / 2;
  shadowed(g, 40, 14, 0.6, () => { g.fillStyle = '#16161a'; g.fillRect(cx, cy, cs, cs); });
  art(g, song, cx, cy, cs);
  const hinge = g.createLinearGradient(cx, 0, cx + 16, 0);
  hinge.addColorStop(0, 'rgba(0,0,0,0.4)'); hinge.addColorStop(0.85, 'rgba(0,0,0,0.25)'); hinge.addColorStop(1, 'rgba(255,255,255,0.18)');
  g.fillStyle = hinge; g.fillRect(cx, cy, 16, cs);
  const gloss = g.createLinearGradient(cx, cy, cx + cs * 0.7, cy + cs * 0.9);
  gloss.addColorStop(0, 'rgba(255,255,255,0.16)'); gloss.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.fillStyle = gloss; g.fillRect(cx, cy, cs, cs);
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1.5; g.strokeRect(cx + 0.75, cy + 0.75, cs - 1.5, cs - 1.5);
  return { x: cx + cs + 70, top: cy, height: cs };
}

// BLUE: the disc out of its case, the cover printed on it, light running round its rings.
function discOut(g, song, colors) {
  wash(g, song, colors, { alpha: 0.35 });
  const cs = 400, cx = 70, cy = (H - cs) / 2, r = 205, dx = cx + cs * 0.62 + r * 0.35, dy = H / 2;
  shadowed(g, 36, 12, 0.55, () => { g.fillStyle = '#16161a'; g.fillRect(cx, cy, cs, cs); });
  art(g, song, cx, cy, cs);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(cx, cy, cs, cs);
  shadowed(g, 40, 10, 0.6, () => { g.beginPath(); g.arc(dx, dy, r, 0, Math.PI * 2); g.fillStyle = '#c9ccd2'; g.fill(); });
  g.save(); g.beginPath(); g.arc(dx, dy, r, 0, Math.PI * 2); g.arc(dx, dy, 18, 0, Math.PI * 2, true); g.clip('evenodd');
  art(g, song, dx - r, dy - r, r * 2);
  const sheen = g.createConicGradient(-0.6, dx, dy);
  [[0, 0], [0.12, 0.28], [0.22, 0], [0.5, 0], [0.62, 0.22], [0.72, 0], [1, 0]].forEach(([o, a]) => sheen.addColorStop(o, `rgba(${colors.accent2.join(',')},${a})`));
  g.fillStyle = sheen; g.fillRect(dx - r, dy - r, r * 2, r * 2);
  g.restore();
  g.beginPath(); g.arc(dx, dy, 52, 0, Math.PI * 2); g.arc(dx, dy, 18, 0, Math.PI * 2, true);
  g.fillStyle = 'rgba(230,234,240,0.55)'; g.fill('evenodd');
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.5; g.beginPath(); g.arc(dx, dy, r - 1, 0, Math.PI * 2); g.stroke();
  return { x: dx + r + 54, top: cy, height: cs };
}

// SUNSET: an eighties sunset — a striped sun going down behind the cover, a grid running to the horizon.
function sunset(g, song, colors) {
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, rgb(colors.bg)); sky.addColorStop(0.55, rgb(colors.accent2, 0.55)); sky.addColorStop(0.72, rgb(colors.accent, 0.9));
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  const hz = 470, sx = 330, sr = 230;
  g.save(); g.beginPath(); g.rect(0, 0, W, hz); g.clip();
  const sun = g.createLinearGradient(0, hz - sr * 2, 0, hz);
  sun.addColorStop(0, '#ffe08a'); sun.addColorStop(1, rgb(colors.accent));
  g.fillStyle = sun; g.beginPath(); g.arc(sx, hz, sr, Math.PI, 0); g.fill();
  g.fillStyle = rgb(colors.accent2, 0.85);
  for (let i = 0, y = hz - 90; i < 6; i++, y += 16) g.fillRect(sx - sr, y, sr * 2, 3 + i * 1.6);
  g.restore();
  g.fillStyle = rgb(colors.bg); g.fillRect(0, hz, W, H - hz);
  g.strokeStyle = rgb(colors.accent2, 0.7); g.lineWidth = 2;
  for (let i = -16; i <= 16; i++) { g.beginPath(); g.moveTo(W * 0.32 + i * 26, hz); g.lineTo(W * 0.32 + i * 170, H); g.stroke(); }
  for (let k = 1; k < 8; k++) { const y = hz + (H - hz) * (k / 8) ** 1.8; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  const cs = 330, cx = sx - cs / 2, cy = hz - cs + 60;
  shadowed(g, 50, 20, 0.55, () => { g.fillStyle = '#fff'; g.fillRect(cx - 8, cy - 8, cs + 16, cs + 16); });
  art(g, song, cx, cy, cs);
  const shade = g.createLinearGradient(W * 0.45, 0, W * 0.62, 0); // (the words on the dusk, not on the sun)
  shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, rgb(colors.bg, 0.72));
  g.fillStyle = shade; g.fillRect(0, 0, W, H);
  return { x: 610, top: 70, height: 380, titleStyle: 'italic bold', artistColor: '#ffd27a' };
}

// FOREST: a polaroid of the cover on the table, its caption written on in marker.
function polaroid(g, song, colors, rnd) {
  wash(g, song, colors, { alpha: 0.3, shade: [0.25, 0.5] });
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.035})`; g.fillRect(rnd() * W, rnd() * H, 2, 2); } // (the grain of the table)
  const cs = 360, pw = cs + 40, ph = cs + 110;
  g.save(); g.translate(300, H / 2 + 6); g.rotate(-0.06);
  shadowed(g, 34, 16, 0.55, () => { g.fillStyle = '#f4f1e8'; g.fillRect(-pw / 2, -ph / 2, pw, ph); });
  art(g, song, -cs / 2, -ph / 2 + 20, cs);
  g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(-cs / 2, -ph / 2 + 20, cs, cs);
  g.fillStyle = '#2b3a2f'; g.textAlign = 'center'; g.font = `30px ${MARKER_FONT}`;
  g.fillText(wrap(g, song.title, cs - 20, 1)[0] || '', 0, ph / 2 - 34);
  g.fillStyle = rgb(colors.accent2, 0.75); g.save(); g.rotate(0.12); g.fillRect(-60, -ph / 2 - 16, 120, 34); g.restore(); // (the tape holding it)
  g.restore();
  return { x: 560, top: 110, height: 410 };
}

// GALAXY: the cover a planet among the stars, a ring round it.
function planet(g, song, colors, rnd) {
  g.fillStyle = rgb(colors.bg); g.fillRect(0, 0, W, H);
  const neb = g.createRadialGradient(300, 300, 20, 300, 300, 600);
  neb.addColorStop(0, rgb(colors.accent, 0.35)); neb.addColorStop(0.5, rgb(colors.accent2, 0.12)); neb.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = neb; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    const r = rnd() ** 3 * 2.2 + 0.4;
    g.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.7})`; g.beginPath(); g.arc(rnd() * W, rnd() * H, r, 0, Math.PI * 2); g.fill();
  }
  const px = 300, py = H / 2, pr = 185;
  const ring = (front) => {
    g.save(); g.translate(px, py); g.rotate(-0.35); g.scale(1, 0.26);
    g.beginPath(); g.arc(0, 0, pr * 1.55, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
    g.lineWidth = 26; g.strokeStyle = rgb(colors.accent2, 0.5); g.stroke();
    g.lineWidth = 6; g.strokeStyle = rgb(colors.accent, 0.8); g.stroke();
    g.restore();
  };
  ring(false);
  g.save(); g.shadowColor = rgb(colors.accent, 0.8); g.shadowBlur = 60;
  g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fillStyle = rgb(colors.bg); g.fill(); g.restore();
  g.save(); g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.clip();
  art(g, song, px - pr, py - pr, pr * 2);
  const night = g.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.2, px, py, pr * 1.05);
  night.addColorStop(0, 'rgba(255,255,255,0.12)'); night.addColorStop(0.6, 'rgba(0,0,0,0)'); night.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = night; g.fillRect(px - pr, py - pr, pr * 2, pr * 2);
  g.restore();
  ring(true);
  return { x: 600, top: 110, height: 410 };
}

// OCEAN: the cover above still water, its reflection rippling under it.
function reflection(g, song, colors) {
  wash(g, song, colors, { alpha: 0.35 });
  const cs = 330, cx = 120, cy = 50, water = cy + cs + 6;
  shadowed(g, 30, 10, 0.5, () => { g.fillStyle = '#111'; g.fillRect(cx, cy, cs, cs); });
  art(g, song, cx, cy, cs);
  // The water drawn on its own, then faded out to the right, before the words.
  const layer = new OffscreenCanvas(W, H), w = layer.getContext('2d');
  const sea = w.createLinearGradient(0, water, 0, H);
  sea.addColorStop(0, rgb(colors.accent, 0.25)); sea.addColorStop(1, rgb(colors.bg, 0.95));
  w.fillStyle = sea; w.fillRect(0, water, W, H - water);
  if (song.cover) {
    const iw = song.cover.naturalWidth || song.cover.width, ih = song.cover.naturalHeight || song.cover.height, m = Math.min(iw, ih);
    for (let y = 0; y < H - water; y += 3) { // a strip at a time, each pushed aside a little: the ripple
      const src = (ih - m) / 2 + m * (1 - (y + 1.5) / cs);
      if (src < (ih - m) / 2) break;
      w.globalAlpha = 0.42 * (1 - y / (H - water));
      w.drawImage(song.cover, (iw - m) / 2, src, m, m * 3 / cs, cx + Math.sin(y / 7) * (2 + y / 30), water + y, cs, 3);
    }
    w.globalAlpha = 1;
  }
  w.strokeStyle = rgb(colors.accent2, 0.35); w.lineWidth = 2;
  for (let k = 0; k < 6; k++) { const y = water + 18 + k * 30; w.beginPath(); for (let x = 0; x <= W; x += 20) w.lineTo(x, y + Math.sin(x / 40 + k) * 3); w.stroke(); }
  const fade = w.createLinearGradient(380, 0, 580, 0);
  fade.addColorStop(0, '#000'); fade.addColorStop(1, 'rgba(0,0,0,0)');
  w.globalCompositeOperation = 'destination-in'; w.fillStyle = fade; w.fillRect(0, 0, W, H);
  g.drawImage(layer, 0, 0);
  return { x: 580, top: 60, height: 380 };
}

// MATRIX: a terminal — the cover in green pixels, the words typed out, the glyphs falling behind.
function terminal(g, song, colors, rnd) {
  g.fillStyle = '#020503'; g.fillRect(0, 0, W, H);
  g.font = `18px ${MONO}`; g.textBaseline = 'top';
  for (let x = 10; x < W; x += 22) {
    const len = 4 + Math.floor(rnd() * 16), y0 = Math.floor(rnd() * 30) * 22 - 200;
    for (let k = 0; k < len; k++) {
      g.fillStyle = rgb(colors.accent, (k === len - 1 ? 0.5 : 0.04 + 0.16 * (k / len)) * (x > 520 ? 0.35 : 1)); // (fainter behind the words)
      g.fillText(String.fromCharCode(0x30a0 + Math.floor(rnd() * 96)), x, y0 + k * 22);
    }
  }
  const cs = 384, cx = 90, cy = (H - cs) / 2, px = 48, small = new OffscreenCanvas(px, px), s = small.getContext('2d');
  if (song.cover) {
    art(s, song, 0, 0, px);
    const d = s.getImageData(0, 0, px, px);
    for (let i = 0; i < d.data.length; i += 4) { // green, by how bright
      const v = (d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11) / 255;
      d.data[i] = colors.accent[0] * v * 0.6; d.data[i + 1] = 40 + colors.accent[1] * v; d.data[i + 2] = colors.accent[2] * v * 0.6;
    }
    s.putImageData(d, 0, 0);
  } else { s.fillStyle = rgb(colors.accent, 0.3); s.fillRect(0, 0, px, px); }
  g.imageSmoothingEnabled = false; g.drawImage(small, cx, cy, cs, cs); g.imageSmoothingEnabled = true;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = cy; y < cy + cs; y += cs / px) g.fillRect(cx, y, cs, 1.5); // (the gaps between the pixels' rows)
  g.strokeStyle = rgb(colors.accent, 0.6); g.lineWidth = 2; g.strokeRect(cx - 8, cy - 8, cs + 16, cs + 16);
  g.textBaseline = 'alphabetic';
  return { x: cx + cs + 64, top: cy, height: cs, font: MONO, label: `> ${t('NOW PLAYING').toLowerCase().replace(/\s+/g, '_')}`, titleColor: rgb(colors.accent2), mark: rgb(colors.accent, 0.6), cursor: true };
}

// AUTUMN: a ticket to the show — the cover on its stub, torn off along the dotted line.
function ticket(g, song, colors, rnd) {
  wash(g, song, colors, { alpha: 0.3, shade: [0.3, 0.45] });
  for (let i = 0; i < 26; i++) { // leaves
    g.save(); g.translate(rnd() * W, rnd() * H); g.rotate(rnd() * 6.3);
    g.fillStyle = rgb(rnd() < 0.5 ? colors.accent : colors.accent2, 0.18 + rnd() * 0.2);
    g.beginPath(); g.ellipse(0, 0, 16 + rnd() * 10, 7 + rnd() * 4, 0, 0, Math.PI * 2); g.fill(); g.restore();
  }
  const tx = 60, ty = 70, tw = W - 120, th = H - 140, stub = 420, notch = 22;
  const paper = '#f3e6d0';
  // (its two notches bitten out where the stub tears off: holes in the paper, inside its edge)
  g.save(); g.beginPath(); g.rect(tx, ty, tw, th); g.clip();
  shadowed(g, 30, 12, 0.5, () => {
    g.beginPath(); g.roundRect(tx, ty, tw, th, 14);
    for (const y of [ty, ty + th]) { g.moveTo(tx + stub + notch, y); g.arc(tx + stub, y, notch, 0, Math.PI * 2); }
    g.fillStyle = paper; g.fill('evenodd');
  });
  g.restore();
  g.setLineDash([8, 9]); g.strokeStyle = 'rgba(80,50,30,0.45)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(tx + stub, ty + notch + 6); g.lineTo(tx + stub, ty + th - notch - 6); g.stroke(); g.setLineDash([]);
  const cs = th - 70; art(g, song, tx + 35, ty + 35, cs);
  g.save(); g.translate(tx + tw - 34, ty + th / 2); g.rotate(-Math.PI / 2);
  g.fillStyle = rgb(colors.accent2); g.font = `bold 18px ${FONT}`; g.textAlign = 'center'; g.fillText('ADMIT ONE', 0, 0); g.restore();
  return { x: tx + stub + 46, top: ty + 30, height: th - 60, w: tw - stub - 120, ink: true };
}

// SNOW: snow falling past a frosted frame, a drift along the bottom.
function frost(g, song, colors, rnd) {
  wash(g, song, colors, { alpha: 0.4 });
  const cs = 400, cx = 100, cy = (H - cs) / 2 - 10;
  shadowed(g, 40, 14, 0.5, () => { g.fillStyle = '#eef3f8'; g.beginPath(); g.roundRect(cx - 14, cy - 14, cs + 28, cs + 28, 10); g.fill(); });
  art(g, song, cx, cy, cs);
  const rim = g.createLinearGradient(0, cy + cs - 50, 0, cy + cs);
  rim.addColorStop(0, 'rgba(255,255,255,0)'); rim.addColorStop(1, 'rgba(255,255,255,0.5)');
  g.fillStyle = rim; g.fillRect(cx, cy + cs - 50, cs, 50);
  g.fillStyle = '#f7fafc';
  g.beginPath(); g.moveTo(0, H);
  for (let x = 0; x <= W; x += 40) g.lineTo(x, H - 26 - Math.sin(x / 140) * 12 - Math.sin(x / 53) * 5);
  g.lineTo(W, H); g.fill();
  for (let i = 0; i < 180; i++) {
    const r = 1 + rnd() ** 2 * 4;
    const x = rnd() * W, a = (0.35 + rnd() * 0.55) * (x > 540 ? 0.4 : 1); // (fewer over the words)
    g.fillStyle = `rgba(255,255,255,${a})`; g.beginPath(); g.arc(x, rnd() * (H - 30), r, 0, Math.PI * 2); g.fill();
  }
  return { x: cx + cs + 70, top: cy, height: cs, mark: 'rgba(60,70,80,0.7)' };
}

// AUTO: as a streaming app has it — the cover big with rounded corners, the colours its own, a bar under the words.
function streamApp(g, song, colors) {
  wash(g, song, colors, { alpha: 0.75, shade: [0.35, 0.5] });
  const cs = 450, cx = 90, cy = (H - cs) / 2;
  shadowed(g, 50, 20, 0.55, () => { g.fillStyle = '#000'; g.beginPath(); g.roundRect(cx, cy, cs, cs, 22); g.fill(); });
  g.save(); g.beginPath(); g.roundRect(cx, cy, cs, cs, 22); g.clip(); art(g, song, cx, cy, cs); g.restore();
  return { x: cx + cs + 70, top: cy, height: cs, label: null, bar: true, font: SYSTEM };
}

// ---- each PLAYER LOOK's card (but CLASSIC's: the theme's), in the theme's colours ----

// DOCK: the cover and the words above a bar along the bottom, as the look has its keys — the song part-way along it.
function dockBar(g, song, colors) {
  wash(g, song, colors, { alpha: 0.5 });
  const cs = 320, cx = 80, cy = 56, bx = 60, by = 440, bw = W - 120, bh = 104;
  shadowed(g, 36, 12, 0.55, () => { g.fillStyle = '#16161a'; g.beginPath(); g.roundRect(cx, cy, cs, cs, 12); g.fill(); });
  g.save(); g.beginPath(); g.roundRect(cx, cy, cs, cs, 12); g.clip(); art(g, song, cx, cy, cs); g.restore();
  shadowed(g, 30, 10, 0.45, () => { g.fillStyle = rgb(colors.card || colors.bg, 0.86); g.beginPath(); g.roundRect(bx, by, bw, bh, 22); g.fill(); });
  g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1.5; g.beginPath(); g.roundRect(bx + 0.75, by + 0.75, bw - 1.5, bh - 1.5, 22); g.stroke();
  const px = bx + 40, pw = bw - 80, py = by + 26, done = 0.38;
  g.fillStyle = 'rgba(255,255,255,0.16)'; g.beginPath(); g.roundRect(px, py, pw, 5, 2.5); g.fill();
  g.fillStyle = rgb(colors.accent); g.beginPath(); g.roundRect(px, py, pw * done, 5, 2.5); g.fill();
  g.beginPath(); g.arc(px + pw * done, py + 2.5, 8, 0, Math.PI * 2); g.fill();
  const mid = W / 2, ky = by + 68, ink = rgb(colors.text, 0.85);
  const tri = (x, dir, s) => { g.beginPath(); g.moveTo(x - dir * s / 2, ky - s / 2); g.lineTo(x + dir * s / 2, ky); g.lineTo(x - dir * s / 2, ky + s / 2); g.closePath(); g.fill(); };
  g.fillStyle = ink;
  tri(mid - 96, -1, 18); g.fillRect(mid - 110, ky - 9, 3, 18); // ⏮
  tri(mid + 96, 1, 18); g.fillRect(mid + 107, ky - 9, 3, 18); // ⏭
  g.fillStyle = rgb(colors.accent); g.beginPath(); g.arc(mid, ky, 26, 0, Math.PI * 2); g.fill();
  g.fillStyle = rgb(colors.bg); g.fillRect(mid - 9, ky - 10, 6, 20); g.fillRect(mid + 3, ky - 10, 6, 20); // ⏸
  return { x: cx + cs + 64, top: 36, height: by - 36 - 24, fit: true }; // (above the bar, never on it)
}

// STAGE: the cover under a spotlight on an empty stage, the words below it, as the look puts them.
function spotlight(g, song, colors) {
  g.fillStyle = rgb(colors.bg); g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 0, W, H);
  const cs = 236, cx = (W - cs) / 2, cy = 40, floor = cy + cs + 30;
  for (const [x, c] of [[W * 0.12, colors.accent2], [W * 0.88, colors.accent2]]) { // the coloured lights from the sides
    const beam = g.createLinearGradient(x, 0, W / 2, floor);
    beam.addColorStop(0, rgb(c, 0.28)); beam.addColorStop(1, rgb(c, 0));
    g.fillStyle = beam; g.beginPath(); g.moveTo(x - 20, 0); g.lineTo(x + 20, 0); g.lineTo(W / 2 + 160, floor); g.lineTo(W / 2 - 160, floor); g.closePath(); g.fill();
  }
  const cone = g.createLinearGradient(0, 0, 0, H);
  cone.addColorStop(0, 'rgba(255,255,255,0.22)'); cone.addColorStop(0.6, rgb(colors.accent, 0.1)); cone.addColorStop(1, 'rgba(255,255,255,0.02)');
  g.fillStyle = cone; g.beginPath(); g.moveTo(W / 2 - 40, 0); g.lineTo(W / 2 + 40, 0); g.lineTo(W / 2 + 330, H); g.lineTo(W / 2 - 330, H); g.closePath(); g.fill();
  const pool = g.createRadialGradient(W / 2, floor, 10, W / 2, floor, 360);
  pool.addColorStop(0, rgb(colors.accent, 0.35)); pool.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.translate(0, floor); g.scale(1, 0.22); g.fillStyle = pool; g.beginPath(); g.arc(W / 2, 0, 360, 0, Math.PI * 2); g.fill(); g.restore();
  shadowed(g, 50, 24, 0.7, () => { g.fillStyle = '#111'; g.fillRect(cx, cy, cs, cs); });
  art(g, song, cx, cy, cs);
  return { x: 140, w: W - 280, top: floor + 6, height: H - floor - 46, align: 'center', label: null, fit: true };
}

// GLASS: a pane of frosted glass over the cover blown up behind it.
function glassPane(g, song, colors) {
  g.fillStyle = rgb(colors.bg); g.fillRect(0, 0, W, H);
  if (song.cover) { g.save(); g.filter = 'blur(40px) saturate(1.5)'; g.drawImage(song.cover, -160, -160, W + 320, W + 320); g.restore(); }
  else wash(g, song, colors, { alpha: 0.6 });
  g.fillStyle = 'rgba(12,12,14,0.42)'; g.fillRect(0, 0, W, H);
  const px = 50, py = 50, pw = W - 100, ph = H - 100;
  shadowed(g, 40, 14, 0.35, () => { g.fillStyle = 'rgba(255,255,255,0.1)'; g.beginPath(); g.roundRect(px, py, pw, ph, 30); g.fill(); });
  const edge = g.createLinearGradient(px, py, px + pw, py + ph);
  edge.addColorStop(0, 'rgba(255,255,255,0.42)'); edge.addColorStop(0.5, 'rgba(255,255,255,0.08)'); edge.addColorStop(1, 'rgba(255,255,255,0.22)');
  g.strokeStyle = edge; g.lineWidth = 1.5; g.beginPath(); g.roundRect(px + 0.75, py + 0.75, pw - 1.5, ph - 1.5, 30); g.stroke();
  const cs = ph - 80, cx = px + 40, cy = py + 40;
  shadowed(g, 30, 10, 0.45, () => { g.fillStyle = '#000'; g.beginPath(); g.roundRect(cx, cy, cs, cs, 18); g.fill(); });
  g.save(); g.beginPath(); g.roundRect(cx, cy, cs, cs, 18); g.clip(); art(g, song, cx, cy, cs); g.restore();
  return { x: cx + cs + 56, w: px + pw - (cx + cs + 56) - 40, top: cy, height: cs, mark: 'rgba(255,255,255,0.6)',
    ink: { text: [255, 255, 255], accent: [255, 255, 255], accent2: [236, 236, 242], muted: [205, 205, 215] } }; // (white on the glass, whatever the cover)
}

// PANEL: the front of a hi-fi deck — brushed metal, screws in its corners, the words lit up in its display.
function faceplate(g, song, colors, rnd) {
  const metal = g.createLinearGradient(0, 0, 0, H);
  metal.addColorStop(0, '#3a3c40'); metal.addColorStop(0.5, '#2a2b2f'); metal.addColorStop(1, '#1d1e21');
  g.fillStyle = metal; g.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 2) { g.fillStyle = `rgba(255,255,255,${rnd() * 0.035})`; g.fillRect(0, y, W, 1); } // (brushed)
  g.fillStyle = rgb(colors.accent, 0.05); g.fillRect(0, 0, W, H);
  for (const [x, y] of [[26, 26], [W - 26, 26], [26, H - 26], [W - 26, H - 26]]) {
    const head = g.createRadialGradient(x - 3, y - 3, 1, x, y, 10);
    head.addColorStop(0, '#8a8d93'); head.addColorStop(1, '#3b3d42');
    g.fillStyle = head; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x - 6, y - 2); g.lineTo(x + 6, y + 2); g.stroke();
  }
  const cs = 400, cx = 80, cy = (H - cs) / 2;
  shadowed(g, 20, 6, 0.6, () => { g.fillStyle = '#111'; g.fillRect(cx - 6, cy - 6, cs + 12, cs + 12); });
  art(g, song, cx, cy, cs);
  const vx = cx + cs + 50, vy = cy, vw = W - vx - 70, vh = cs; // the display: a window sunk into the metal, its glass ruled
  g.fillStyle = '#050607'; g.beginPath(); g.roundRect(vx, vy, vw, vh, 10); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.8)'; g.lineWidth = 3; g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.1)'; g.lineWidth = 1; g.beginPath(); g.roundRect(vx - 2, vy - 2, vw + 4, vh + 4, 12); g.stroke();
  g.fillStyle = rgb(colors.accent, 0.035);
  for (let y = vy + 3; y < vy + vh; y += 4) g.fillRect(vx + 4, y, vw - 8, 1);
  const vfd = rgb(colors.accent);
  return { x: vx + 32, w: vw - 64, top: vy + 24, height: vh - 48, font: MONO, glow: vfd, titleColor: vfd, artistColor: rgb(colors.accent, 0.85),
    ink: { text: colors.accent, accent: colors.accent, accent2: colors.accent, muted: colors.accent.map((c) => Math.round(c * 0.75)) }, fit: true, mark: 'rgba(255,255,255,0.35)' };
}

// COVER: as a streaming app's full-screen player — the cover edge to edge down the left, fading into its own colours.
function fullBleed(g, song, colors) {
  wash(g, song, colors, { alpha: 0.85, shade: [0.3, 0.45] });
  const layer = new OffscreenCanvas(W, H), l = layer.getContext('2d');
  if (song.cover) art(l, song, 0, 0, H);
  else { l.fillStyle = rgb(colors.accent, 0.2); l.fillRect(0, 0, H, H); art(l, song, 80, 80, H - 160); }
  const fade = l.createLinearGradient(H - 280, 0, H, 0);
  fade.addColorStop(0, '#000'); fade.addColorStop(1, 'rgba(0,0,0,0)');
  l.globalCompositeOperation = 'destination-in'; l.fillStyle = fade; l.fillRect(0, 0, W, H);
  g.drawImage(layer, 0, 0);
  return { x: H + 50, w: W - H - 100, top: 60, height: H - 120, font: SYSTEM, label: null, titleStyle: '800' };
}

const LOOK_STYLES = { DOCK: dockBar, STAGE: spotlight, GLASS: glassPane, PANEL: faceplate, COVER: fullBleed };

const STYLES = { RED: jewelCase, BLUE: discOut, SUNSET: sunset, FOREST: polaroid, GALAXY: planet, OCEAN: reflection, MATRIX: terminal, AUTUMN: ticket, SNOW: frost, AUTO: streamApp };
const MONO = '"SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';
const SYSTEM = '-apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif';

// The words, at `w.x`, centred on the artwork (`top`, `height`) while shorter than it: NOW PLAYING, the title, the
// artist, the album, and the quote. A long quote gets smaller type, and a two-line title gives up its second line if
// the quote would get too small. `fit`: kept inside `height`; `align: 'center'`: each line centred; `glow`: lit, as a
// display's.
function drawWords(g, song, colors, w) {
  const font = w.font || FONT, tx = w.x, tw = w.w || W - tx - 80, room = H - 100, QUOTE_GAP = 30;
  const ink = w.ink === true ? { text: [40, 28, 20], accent: colors.accent, accent2: colors.accent2, muted: [120, 96, 80] } : w.ink || colors; // (on paper)
  const centred = w.align === 'center', cx = centred ? tx + tw / 2 : tx;
  const quoteMeasure = (t, size) => { g.font = `italic ${size}px ${font}`; return g.measureText(t).width; };
  const layout = (titleLines) => {
    const parts = []; // [font, colour, lines, line height, gap after]
    const label = w.label === undefined ? t('NOW PLAYING') : w.label;
    if (label) parts.push([`bold 20px ${font}`, rgb(ink.accent), [label], 30, 20]);
    g.font = `${w.titleStyle || 'bold'} 54px ${font}`;
    parts.push([g.font, w.titleColor || rgb(ink.text), wrap(g, song.title, tw, titleLines), 62, 6]);
    if (song.artist) { g.font = `30px ${font}`; parts.push([g.font, w.artistColor || rgb(ink.accent2), wrap(g, song.artist, tw, 1), 40, 0]); }
    if (song.subtitle) { g.font = `22px ${font}`; parts.push([g.font, rgb(ink.muted), wrap(g, song.subtitle, tw, 1), 32, 0]); }
    const headH = parts.reduce((h, [, , lines, lh, after]) => h + lines.length * lh + after, 0) + (w.bar ? 40 : 0);
    const quote = song.quote ? layoutQuote(song.quote, quoteMeasure, tw - 24, Math.min(room, w.height + (w.fit ? 0 : 60)) - headH - QUOTE_GAP) : null;
    return { parts, quote, height: headH + (quote ? QUOTE_GAP + quote.rows.length * quote.lineHeight : 0) };
  };
  let words = layout(2);
  const titleAt = words.parts.length && (w.label === undefined || w.label) ? 1 : 0;
  if (words.quote && words.quote.size < 20 && words.parts[titleAt][2].length > 1) words = layout(1);
  let y = words.height < w.height ? w.top + (w.height - words.height) / 2 : w.fit ? w.top : Math.max(50, (H - words.height) / 2);
  g.save();
  if (w.glow) { g.shadowColor = w.glow; g.shadowBlur = 14; }
  g.textBaseline = 'top'; g.textAlign = centred ? 'center' : 'left';
  for (const [f, color, lines, lh, after] of words.parts) {
    g.font = f; g.fillStyle = color;
    for (const l of lines) { g.fillText(l, cx, y + (lh - parseInt(f.match(/(\d+)px/)[1], 10)) / 2); y += lh; }
    y += after;
  }
  if (w.cursor) { g.fillStyle = rgb(colors.accent); g.fillRect(tx, y + 4, 16, 28); y += 36; }
  if (w.bar) { // a progress bar, part-way, as a player shows it
    y += 18;
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.roundRect(tx, y, tw * 0.9, 6, 3); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.roundRect(tx, y, tw * 0.9 * 0.38, 6, 3); g.fill();
    g.beginPath(); g.arc(tx + tw * 0.9 * 0.38, y + 3, 8, 0, Math.PI * 2); g.fill();
    y += 16;
  }
  if (words.quote) {
    const q = words.quote;
    y += QUOTE_GAP;
    if (!centred) { g.fillStyle = rgb(ink.accent); g.fillRect(tx, y + 2, 4, q.rows.length * q.lineHeight - 4); }
    g.font = `italic ${q.size}px ${font}`;
    q.rows.forEach((r, i) => {
      g.fillStyle = r.skipped ? rgb(ink.muted) : rgb(ink.text);
      g.fillText(r.text, centred ? cx : tx + 24, y + (q.lineHeight - q.size) / 2 + i * q.lineHeight);
    });
  }
  g.restore();
}
