// The "now playing" card (P, or right-click the disc): a picture of what's on, to paste into a chat or save — 4:5, as
// a chat shows a picture big. The art big, the lines picked from its lyrics (up to ten, or none) big and plain under it,
// the title and the artist small at the foot in one face, "cdplayer" small beside them; all on the cover's own colours
// (share-art.js ambient, as the videos have it). Each PLAYER LOOK its own card, adding the one thing it has in the
// player (share-art.js); the theme only colours it.
import { rgb, FONT, drawThemeImage, isLight } from './theme.js';
import { currentLineIndex, parseLrc } from './lyrics.js';
import { MONO, paperOf, ambient, coverMean, coverSquare, wrapRows, discParts, drawDisc, drawCaseFront, CASE_RATIO, onShadow,
  bars, barValues, deckStrip, names, namesHeight, credit, mmss } from './share-art.js';

const CW = 1080, CH = 1350, M = 72;
// (the year's card keeps its wide shape)
const W = 1200, H = 630;
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
 * The quote laid out to fit `maxWidth` × `maxHeight`: the biggest type, `max` px down to `min`, at which its lines —
 * each wrapped onto two rows at most — fit. Plain: no quotation marks. `measure(text, size)` → width. →
 * { size, lineHeight, rows: [{ text, skipped, entry (which line it's of) }] }
 */
export function layoutQuote(entries, measure, maxWidth, maxHeight, { max = 28, min = 14, leading = 1.36 } = {}) {
  let layout;
  for (let size = max; size >= min; size -= 2) {
    const lineHeight = Math.round(size * leading), rows = [];
    let cut = false; // (a line cut short with "…" at this size: smaller, then, while it can go smaller)
    entries.forEach((line, entry) => {
      const skipped = line === SKIPPED, wrapped = skipped ? [line] : wrapText((x) => measure(x, size), line, maxWidth, 2);
      if (!skipped && wrapped.join(' ') !== String(line).split(/\s+/).filter(Boolean).join(' ')) cut = true;
      for (const text of wrapped) rows.push({ text, skipped, entry });
    });
    layout = { size, lineHeight, rows };
    if (rows.length * lineHeight <= maxHeight && !cut) break;
  }
  return layout;
}

/**
 * The card as PNG bytes. `song`: { cover (image or null), title, artist, subtitle, quote (lines, or null), backdrop,
 * and, where known: face (the disc as the player draws it), track, position, duration (s), waveform (buckets) };
 * `colors`: the theme's; `look`: the PLAYER LOOK. (`theme`, the theme's name, no longer changes the card.)
 */
export async function drawCard(song, colors, theme = 'RED', look = 'CLASSIC') {
  const canvas = new OffscreenCanvas(CW, CH), g = canvas.getContext('2d');
  const paper = paperOf(colors, coverMean(song));
  ambient(song, CW, CH, paper, { dim: look === 'TERMINAL' ? 2 : 1 })(g, 0); // (TERMINAL's behind dark glass)
  (LOOK_CARDS[look] || classicCard)(g, song, colors, paper);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

const trackTime = (song) => [song.track ? String(song.track).padStart(2, '0') : '', [mmss(song.position), mmss(song.duration)].filter(Boolean).join(' / ')].filter(Boolean).join(' · ');

// The quote's rows from (x, y), the first line in full ink and the others a step fainter, "…" fainter still.
function drawQuote(g, q, x, y, ink, font, weight = 400) {
  g.save(); g.textBaseline = 'top'; g.textAlign = 'left'; g.font = `${weight} ${q.size}px ${font}`;
  q.rows.forEach((r, i) => { g.fillStyle = ink(r.skipped ? 0.32 : r.entry === 0 ? 0.95 : 0.6); g.fillText(r.text, x, y + (q.lineHeight - q.size) / 2 + i * q.lineHeight); });
  g.restore();
  return q.rows.length * q.lineHeight;
}
const measureIn = (g, font, weight = 400) => (text, size) => { g.font = `${weight} ${size}px ${font}`; return g.measureText(text).width; };

/**
 * Base A: the art (`art.aspect` wide to tall, drawn by `art.draw(x, y, w, h)`), a strip under it if the look has one
 * (`strip.h`, `strip.draw(x, y, w, h)`), the quote big, and the names small at the foot with "cdplayer" beside them;
 * the art as big as leaves the rest room. No quote: the names bigger, straight under the art.
 */
const NAMES = 34, QUOTE = { max: 56, min: 28, leading: 1.22 };
function baseA(g, song, paper, art, strip = null) {
  const width = CW - M * 2, foot = CH - M, gap = 36, size = song.quote ? NAMES : 46;
  const nh = namesHeight(g, song, width - 150, size), sh = strip ? strip.h + 28 : 0, minArt = 560;
  const q = song.quote ? layoutQuote(song.quote, measureIn(g, FONT, 600), width, foot - M - minArt - sh - gap - nh - gap, QUOTE) : null;
  const qh = q ? q.rows.length * q.lineHeight + gap : 0;
  const ah = Math.min(width / art.aspect, foot - M - sh - gap - nh - qh), aw = ah * art.aspect, ax = M + (width - aw) / 2;
  art.draw(ax, M, aw, ah);
  let y = M + ah;
  if (strip) { strip.draw(ax, y + 28, aw, strip.h); y += sh; }
  if (q) drawQuote(g, q, M, y + gap, paper.ink, FONT, 600);
  const ny = q ? foot - nh : y + gap;
  names(g, song, M, ny, width - 150, size, paper.ink);
  credit(g, CW - M, ny + nh - 10, paper.ink, 24);
}
// The cover lying flat on the page, on a soft short shadow.
const flatCover = (g, song, paper) => (x, y, w, h) => {
  const c = onShadow(w, h, paper.light, (cg) => cg.drawImage(coverSquare(song, Math.round(w)), 0, 0, w, h));
  g.drawImage(c.canvas, x - c.pad, y - c.pad);
};

// CLASSIC: the CD itself, the cover printed on it (the player's own disc where it's given), bigger than its place and
// running off the card's right edge, its foot where the art's is.
function classicCard(g, song, colors, paper) {
  baseA(g, song, paper, { aspect: 1, draw: (x, y, w, h) => {
    const r = w * 0.6;
    drawDisc(g, song, x + w / 2 + w * 0.14, y + h - r, r, 0, discParts(song, Math.round(r), paper.light));
  } });
}
// JEWEL CASE: the cover in a shut case, lying on the page.
function caseCard(g, song, colors, paper) {
  baseA(g, song, paper, { aspect: CASE_RATIO, draw: (x, y, w, h) => {
    drawCaseFront(g, song, x, y, w, paper.light); // (as the JEWEL CASE look draws it)
  } });
}
// VISUALIZER: the cover, a strip of the song's own bars under it — played so far in full ink, the rest faint.
function visualizerCard(g, song, colors, paper) {
  const played = song.duration > 0 && song.position >= 0 ? song.position / song.duration : 0;
  baseA(g, song, paper, { aspect: 1, draw: flatCover(g, song, paper) },
    { h: 80, draw: (x, y, w, h) => bars(g, x, y, w, h, barValues(song.waveform, 56, `${song.title}|${song.artist}`), played, paper.ink) });
}
// HI-FI: the cover, a strip of the deck's display under it: the track and the time into the song.
function hifiCard(g, song, colors, paper) {
  baseA(g, song, paper, { aspect: 1, draw: flatCover(g, song, paper) },
    { h: 112, draw: (x, y, w, h) => deckStrip(g, x, y, w, h, colors, { track: song.track, time: mmss(song.position) }) });
}

// ALBUM (base C): the cover edge to edge across the top, melting into the page (which is the cover, blurred: it runs on
// into its own colours); the quote and the names over it at the foot.
function albumCard(g, song, colors, paper) {
  const width = CW - M * 2, size = song.quote ? NAMES : 46, gap = 36, foot = CH - M;
  const nh = namesHeight(g, song, width - 150, size);
  const q = song.quote ? layoutQuote(song.quote, measureIn(g, FONT, 600), width, 560, QUOTE) : null;
  const qh = q ? q.rows.length * q.lineHeight + gap : 0, top = foot - nh - qh;
  const art = coverSquare(song, CW), ag = art.getContext('2d'), melt = ag.createLinearGradient(0, 0, 0, CW);
  melt.addColorStop(0.6, 'rgba(0,0,0,1)'); melt.addColorStop(1, 'rgba(0,0,0,0)');
  ag.globalCompositeOperation = 'destination-in'; ag.fillStyle = melt; ag.fillRect(0, 0, CW, CW); // (over all of it: destination-in clears what it doesn't cover)
  const ay = Math.min(0, top + 140 - CW);
  g.drawImage(art, 0, ay);
  // under the words, the cover dimmed (to the page's ink: dark for light words, paper for dark ones)
  const tone = paper.light ? paper.top.join(',') : '0,0,0', scrim = g.createLinearGradient(0, top - 220, 0, top + 80);
  scrim.addColorStop(0, `rgba(${tone},0)`); scrim.addColorStop(1, `rgba(${tone},${paper.light ? 0.7 : 0.55})`);
  g.fillStyle = scrim; g.fillRect(0, top - 220, CW, CH - top + 220);
  let y = top;
  if (q) y += drawQuote(g, q, M, y, paper.ink, FONT, 600) + gap;
  names(g, song, M, y, width - 150, size, paper.ink);
  credit(g, CW - M, y + nh - 10, paper.ink, 24);
}

// LYRICS (base B): the lines big at the top; the CD big in the lower right corner, running off both edges; the names,
// the track and the time at the foot beside it.
function lyricsCard(g, song, colors, paper) {
  const width = CW - M * 2, r = 330, cx = CW - 130, cy = CH - 120, foot = CH - M, tw = cx - r - M - 24;
  drawDisc(g, song, cx, cy, r, 0, discParts(song, r, paper.light));
  if (song.quote) {
    const q = layoutQuote(song.quote, measureIn(g, FONT, 600), width, cy - r - 60 - M, { max: 88, min: 32, leading: 1.18 });
    drawQuote(g, q, M, M, paper.ink, FONT, 600);
  } else names(g, { title: song.title, artist: song.artist }, M, M, width, 88, paper.ink, { titleRows: 3 });
  g.save(); g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  const rows = [song.quote && [`600 34px ${FONT}`, 0.96, song.title], song.quote && [`400 34px ${FONT}`, 0.55, song.artist],
    !song.quote && [`400 30px ${FONT}`, 0.55, song.subtitle], [`400 22px ${MONO}`, 0.42, trackTime(song)]].filter((x) => x && x[2]);
  let y = foot;
  for (const [font, a, text] of rows.reverse()) { g.font = font; g.fillStyle = paper.ink(a); g.fillText(wrapRows(g, text, tw, 1)[0], M, y); y -= 44; }
  g.restore();
  credit(g, M + tw, foot, paper.ink, 22); // (at the right of the track's row: the corner is the disc's)
}

// TERMINAL (base B, monospace), on dark glass over the cover's colours: a prompt, the lines as its output with a cursor
// after them; at the foot the cover in blocks, its own colours, and what it is.
function terminalCard(g, song, colors, paper) {
  const width = CW - M * 2, rowH = 240, footY = CH - M - rowH, ink = paper.ink;
  g.save(); g.textBaseline = 'top'; g.textAlign = 'left';
  g.font = `400 30px ${MONO}`; g.fillStyle = ink(0.45); g.fillText('$ cdplayer now', M, M);
  const lines = song.quote || [song.title || ''];
  const q = layoutQuote(lines, measureIn(g, MONO), width - 40, footY - M - 150, { max: 56, min: 24, leading: 1.3 });
  const qh = drawQuote(g, q, M, M + 80, ink, MONO);
  const last = q.rows[q.rows.length - 1];
  g.font = `400 ${q.size}px ${MONO}`;
  const cx = M + (last ? g.measureText(last.text).width + q.size * 0.25 : 0), cy = M + 80 + qh - q.lineHeight + (q.lineHeight - q.size) / 2;
  g.fillStyle = ink(0.85); g.fillRect(cx, cy, q.size * 0.58, q.size * 1.05);
  // The cover drawn from few pixels and shown as them.
  g.imageSmoothingEnabled = false; g.drawImage(coverSquare(song, 24), M, footY, rowH, rowH); g.imageSmoothingEnabled = true;
  const tx = M + rowH + 32, tw = CW - M - tx, step = 44;
  const rows = [[0.95, song.title], [0.6, song.artist], [0.45, song.subtitle], [0.45, trackTime(song)]].filter(([, t]) => t);
  g.font = `400 30px ${MONO}`;
  rows.forEach(([a, text], i) => { g.fillStyle = ink(a); g.fillText(wrapRows(g, text, tw, 1)[0], tx, footY + rowH - rows.length * step + i * step + 4); });
  g.restore();
}

const LOOK_CARDS = { CLASSIC: classicCard, CASE: caseCard, VISUALIZER: visualizerCard, HIFI: hifiCard, ALBUM: albumCard, LYRICS: lyricsCard, TERMINAL: terminalCard };

// ---- What the year's card is drawn with ------------------------------------------------------------------------------

const MARKER_FONT = '"Marker Felt", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
let light = false;
// The theme's background, washed with a blur of the cover, darker to the right (a light theme's: lighter).
function wash(g, song, colors, { alpha = 0.45, shade = [0.15, 0.55] } = {}) {
  g.fillStyle = rgb(colors.bg); g.fillRect(0, 0, W, H);
  if (song.backdrop) drawThemeImage(g, W, H, song.backdrop.image, song.backdrop);
  else if (song.cover) {
    g.save(); g.filter = 'blur(60px) saturate(1.3)'; g.globalAlpha = alpha;
    g.drawImage(song.cover, -100, -100, W + 200, H + 200);
    g.restore();
  }
  const s = g.createLinearGradient(0, 0, W, 0);
  const tone = light ? colors.bg.join(',') : '0,0,0';
  s.addColorStop(0, `rgba(${tone},${shade[0]})`); s.addColorStop(1, `rgba(${tone},${shade[1]})`);
  g.fillStyle = s; g.fillRect(0, 0, W, H);
}
// The cover, square; none: a silver CD-R written on in marker.
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
const shadowed = (g, blur, dy, alpha, draw) => { g.save(); g.shadowColor = `rgba(0,0,0,${light ? +(alpha * 0.35).toFixed(3) : alpha})`; g.shadowBlur = blur; g.shadowOffsetY = dy; draw(); g.restore(); };

// ---- THE YEAR ON THE SHELF's card -------------------------------------------------------------------------------

/**
 * The year's card as PNG bytes: the hours and plays, the five albums played most standing in their cases, the artists,
 * and the year month by month (ALL TIME: year by year). `year`: { heading ("MY 2026 ON THE SHELF"), hours, hoursLabel,
 * playsLabel, albums: [{ title, artist, cover (image or null) }], artistsLabel, artists: [names], strip: [{ label,
 * minutes }], foot (small print) }.
 */
export async function drawYearCard(year, colors) {
  const canvas = new OffscreenCanvas(W, H), g = canvas.getContext('2d');
  light = isLight(colors.bg);
  wash(g, { cover: (year.albums[0] || {}).cover || null }, colors, { alpha: 0.35, shade: [0.35, 0.55] });
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  g.font = `bold 20px ${FONT}`; g.fillStyle = rgb(colors.accent); g.fillText(year.heading, 60, 70);
  g.font = `bold 92px ${FONT}`; g.fillStyle = rgb(colors.text); g.fillText(year.hours, 56, 166);
  const hoursW = g.measureText(year.hours).width;
  g.font = `26px ${FONT}`; g.fillStyle = rgb(colors.accent2); g.fillText(year.hoursLabel, 70 + hoursW, 164);
  g.font = `22px ${FONT}`; g.fillStyle = rgb(colors.muted); g.fillText(year.playsLabel, 60, 204);
  // The albums played most, side by side in their cases, the first the biggest.
  let x = 60;
  year.albums.slice(0, 5).forEach((a, i) => {
    const size = i === 0 ? 180 : 120, y = 250 + (180 - size);
    shadowed(g, 24, 10, 0.55, () => { g.fillStyle = '#16161a'; g.fillRect(x, y, size, size); });
    art(g, a, x, y, size);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, y, 8, size); // (the hinge)
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1.5; g.strokeRect(x + 0.75, y + 0.75, size - 1.5, size - 1.5);
    g.font = `bold ${i === 0 ? 16 : 13}px ${FONT}`; g.fillStyle = rgb(colors.text);
    g.fillText(wrap(g, `${i + 1}. ${a.title}`, size, 1)[0] || '', x, y + size + 24);
    x += size + 18;
  });
  // The artists, down the right.
  const rx = 880;
  g.font = `bold 16px ${FONT}`; g.fillStyle = rgb(colors.accent); g.fillText(year.artistsLabel, rx, 70);
  year.artists.slice(0, 5).forEach((name, i) => {
    g.font = `${i === 0 ? 'bold 26' : '22'}px ${FONT}`; g.fillStyle = i === 0 ? rgb(colors.text) : rgb(colors.accent2);
    g.fillText(wrap(g, name, W - rx - 50, 1)[0] || '', rx, 112 + i * 38);
  });
  // The year month by month (or year by year), a bar each.
  const strip = (year.strip || []).slice(-12), most = Math.max(1, ...strip.map((s) => s.minutes)), sw = W - rx - 50, bw = strip.length ? sw / strip.length : 0;
  strip.forEach((s, i) => {
    const h = Math.max(2, Math.round((s.minutes / most) * 120));
    g.fillStyle = rgb(colors.accent, s.minutes ? 0.9 : 0.25); g.fillRect(rx + i * bw + 2, 470 - h, Math.max(2, bw - 4), h);
    g.font = `11px ${FONT}`; g.fillStyle = rgb(colors.muted); g.textAlign = 'center';
    g.fillText(s.label, rx + i * bw + bw / 2, 490);
    g.textAlign = 'left';
  });
  if (year.foot) { g.font = `14px ${FONT}`; g.fillStyle = rgb(colors.muted); g.fillText(wrap(g, year.foot, 760, 1)[0] || '', 60, H - 32); }
  g.font = `bold 16px ${FONT}`; g.fillStyle = rgb(colors.muted); g.textAlign = 'right';
  g.fillText('CDPlayer', W - 40, H - 32);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}
