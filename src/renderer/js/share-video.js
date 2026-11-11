// The Now Playing card as a video (the card's VIDEO 9:16 and VIDEO 1:1): the song's lines as they're sung, its name,
// and the song itself, for as long as the lines picked on the card are sung (eight seconds from where it's playing, with
// none). Recorded as it happens, from a canvas and the audio engine, as MP4 (or WebM where MP4 can't be made).
// Each PLAYER LOOK's film is its card (share-card.js, share-art.js), big, on the cover's own colours (the cover blurred
// right out, turning slowly). The first frame is the finished picture (what a chat shows of it), nothing comes in,
// wobbles or pumps, and the lines come in softly:
//   CLASSIC — the CD turning, big, off the edge. JEWEL CASE — the case, the disc turning in its clear case beside it.
//   VISUALIZER — the strip of bars, on the music. HI-FI — the deck's display: the time, the line lit in its dots, L/R.
//   ALBUM — one slow push in on the cover.       LYRICS — the words, big, lit as they're sung; the CD in the corner.
//   TERMINAL — the line typing itself behind the cursor.
import { rgb, lerpColor, FONT } from './theme.js';
import { drawCells, clock } from './deck-display.js';
import { lineWords, songPace } from './lyrics.js';
import { SPIN_RAD_PER_MS } from './disc-data.js';
import { flattenMp4, mp4Reach } from './mp4-flatten.js';
import { MONO, clamp01, ease, canvas, paperOf, ambient, coverMean, coverSquare, wrapRows, discParts, drawDisc, CASE_RATIO, onShadow, drawCaseFront, drawDiscCase,
  bars, deckStrip, names, credit, mmss } from './share-art.js';

export const VIDEO_SECONDS = 8, MIN_VIDEO_SECONDS = 2, MAX_VIDEO_SECONDS = 180;
const FPS = 30;
const SANS = `system-ui, -apple-system, "Segoe UI", ${FONT}`;

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

// ---- Where things stand ---------------------------------------------------------------------------------------------

/**
 * Base A in a video, big: the art (`aspect` wide to tall) as wide as the frame lets it, a strip under it (`strip` tall:
 * VISUALIZER's bars), then the lines, big (or, with `display`, HI-FI's display that shows them, `display` tall), and the
 * names small at the foot, as a caption. The tall one keeps clear of the top and the foot, where a story's own buttons
 * go; the square one puts the names beside the art and the lines across under both (a wide art — the case — goes
 * across the top instead, the names and the lines under it).
 * → { w, h, m, art, strip, names, lyrics, display, side (names beside the art), size (the title's), lineSize }
 */
export function frameA(format, { aspect = 1, strip = 0, display = 0 } = {}) {
  const tall = format === '9:16', W = 1080, H = tall ? 1920 : 1080, gap = tall ? 40 : 34;
  if (tall) {
    const m = 72, size = 40, top = 200, foot = H - 232, namesH = Math.round(size * 3.3), stripH = strip ? strip + 28 : 0;
    const names = { x: m, y: foot - namesH, w: W - m * 2, h: namesH };
    const room = names.y - gap - top - stripH - gap - (display || 300);
    const ah = Math.min((W - m * 2) / aspect, room), aw = ah * aspect, art = { x: Math.round((W - aw) / 2), y: top, w: aw, h: ah };
    let y = top + ah;
    const st = strip ? { x: art.x, y: y + 28, w: aw, h: strip } : null; y += stripH;
    const lower = { x: m, y: y + gap, w: W - m * 2, h: names.y - gap - (y + gap) };
    return { w: W, h: H, m, art, strip: st, names, lyrics: display ? null : lower, display: display ? { ...lower, h: display } : null, side: false, size, lineSize: 72 };
  }
  const m = 64, size = 32, namesH = Math.round(size * 3.3);
  if (aspect > 1.2) {
    const aw = W - m * 2, ah = aw / aspect, art = { x: m, y: m, w: aw, h: ah };
    const names = { x: m, y: m + ah + gap, w: aw, h: namesH }, y = names.y + namesH + gap * 0.6;
    return { w: W, h: H, m, art, strip: null, names, lyrics: { x: m, y, w: aw, h: H - m - y }, display: null, side: false, size, lineSize: 50 };
  }
  const lower = display || 320, ah = H - m * 2 - gap - lower, aw = ah * aspect, col = m + aw + 40;
  const art = { x: m, y: m, w: aw, h: ah }, sideH = Math.round(size * 4.5);
  const names = { x: col, y: m + ah - sideH, w: W - m - col, h: sideH };
  const st = strip ? { x: col, y: names.y - strip - 28, w: W - m - col, h: strip } : null; // (just over the names, beside the art)
  const below = { x: m, y: m + ah + gap, w: W - m * 2, h: lower };
  return { w: W, h: H, m, art, strip: st, names, lyrics: display ? null : below, display: display ? below : null, side: true, size, lineSize: 50 };
}
/** Where CLASSIC's things stand in a '9:16' (Stories) or '1:1' video: { w, h, art, names, lyrics, … } (frameA). */
export const videoLayout = (format) => frameA(format);

// ---- What every film shares -----------------------------------------------------------------------------------------

// The cover's own colour, for the page's tint (and the fade under ALBUM's cover).
const pageOf = (s) => paperOf(s.colors, coverMean(s));
// What doesn't move, drawn once over the page (which does): whatever `draw(g)` puts there.
function still(L, paper, s, draw) {
  const c = canvas(L.w, L.h);
  draw(c.getContext('2d'));
  return c;
}
// The names in their box, and "cdplayer" in the corner (in the tall one, at the right of the names' last row).
function namesAndCredit(g, L, s, paper, box = L.names, opts = {}) {
  const tall = L.h > L.w, room = tall ? 150 : 0;
  names(g, s, box.x, box.y, box.w - room, opts.size || L.size, paper.ink, { titleRows: L.side ? 2 : 1, ...opts });
  credit(g, L.w - L.m, tall ? box.y + box.h - 8 : L.h - 34, paper.ink, tall ? 24 : 20, opts.font);
}
const spectrumOf = (s, n) => { const sp = s.spectrum && s.spectrum(n); return sp && sp.length ? Array.from(sp, (v) => (v > 1 ? v / 255 : v)) : null; };

/**
 * The lines in `box`, coming in softly: the one being sung in full ink, its words lit as they're sung, the next one
 * faint under it. A new line fades in rising a few pixels (already there in the first frame if the video opens on it);
 * the one before it fades out where it was, quicker. Nothing scales, bounces or sweeps.
 */
function softLines(g, lines, pos, box, { layoutOf, ink, start, rise = 12 }) {
  if (!lines.length) return;
  const i = lineIndex(lines, pos);
  const gap = (l) => l.lead * 0.5;
  const shown = (k, y, alpha, current) => {
    const l = layoutOf(lines[k]);
    if (y + l.height > box.y + box.h + 2) return;
    g.save(); g.globalAlpha = alpha;
    drawLine(g, l, box.x, y, box.w, 'left', (part, px, py) => {
      if (!current) { g.fillStyle = ink(0.3); g.fillText(part.text, px, py); return; }
      wipe(g, part.text, px, py, part.w, sung(part, pos), ink(1), ink(0.5));
    });
    g.restore();
  };
  if (i < 0) { shown(0, box.y, 1, false); return; }
  const line = lines[i], since = pos - line.time, opened = line.time <= start + 0.25;
  // the line before fades out where it was, then this one comes in (one after the other: crossed, they'd tangle)
  const e = opened ? 1 : ease((since - 0.12) / 0.33), gone = clamp01((pos - line.end) / 0.5);
  if (i > 0 && !opened && since < 0.15) shown(i - 1, box.y, 1 - since / 0.15, true);
  shown(i, box.y + rise * (1 - e), e * (1 - gone * 0.7), !gone);
  const next = lines[i + 1];
  if (next) { const l = layoutOf(line); shown(i + 1, box.y + l.height + gap(l) + rise * (1 - e), e, false); }
}
// The lines' type for a film: as big as `size`, down to 80 % of it to keep within `rows` rows.
const linesType = (key, size, width, rows, font = FONT, weight = 600) => (line) => cachedLayout(line, `${key}${size}${width}`,
  () => fit(scratch(), line.words, (px) => `${weight} ${px}px ${font}`, size, Math.round(size * 0.8), width, rows, 1.22));

// ---- CLASSIC: the CD, turning as it does in the player ----------------------------------------------------------------

// (the disc bigger than its place, running off the frame's edge: the tall one's off the right, the square one's off the
// top left, its foot where the art's is)
function classic(L, s, lines, start) {
  const paper = pageOf(s), tall = L.h > L.w, A = L.art, r = A.w * (tall ? 0.6 : 0.56);
  const cx = tall ? A.x + A.w / 2 + A.w * 0.14 : A.x + A.w - r, cy = A.y + A.h - r, parts = discParts(s, Math.round(r), paper.light);
  const bg = ambient(s, L.w, L.h, paper), back = still(L, paper, s, (g) => namesAndCredit(g, L, s, paper));
  const layoutOf = linesType('classic', L.lineSize, L.lyrics.w, 2);
  return (g, at) => {
    bg(g, at);
    g.drawImage(back, 0, 0);
    drawDisc(g, s, cx, cy, r, at * 1000 * SPIN_RAD_PER_MS, parts); // (as fast as in the player)
    softLines(g, lines, s.position(), L.lyrics, { layoutOf, ink: paper.ink, start });
  };
}

// ---- JEWEL CASE: as the look has it, the closed case and beside it the disc turning in its clear case ---------------

const DISC_CASE = 1.2, CASE_GAP = 0.05; // (the disc's case: its size against the disc's, as disc.js draws it; the gap between them, of the case's height)
// (the tall one: the case at the top left and the disc in its case under it at the right, a step down; the square one:
// side by side across the top. Both whole in the frame)
const STEP = 2 + CASE_GAP; // (the tall one's two cases, one over the other: their height against one's)
function caseFilm(L0, s, lines, start) {
  const tall = L0.h > L0.w, L = frameA(tall ? '9:16' : '1:1', { aspect: tall ? (1080 - 72 * 2) / 978 : CASE_RATIO + CASE_GAP + 1 }), paper = pageOf(s), lt = paper.light;
  const h = tall ? L.art.h / STEP : L.art.h, w = h * CASE_RATIO, x0 = L.art.x, y0 = L.art.y, cs = h, side = cs / DISC_CASE, r = side / 2;
  const X = tall ? L.art.x + L.art.w - cs / 2 : x0 + w + CASE_GAP * h + cs / 2, Y = tall ? y0 + h * (1 + CASE_GAP) + cs / 2 : y0 + h / 2;
  const parts = discParts(s, Math.round(r), lt);
  const bg = ambient(s, L.w, L.h, paper);
  const back = still(L, paper, s, (g) => {
    drawCaseFront(g, s, x0, y0, w, lt);
    drawDiscCase(g, X, Y, side, lt);
    namesAndCredit(g, L, s, paper);
  });
  const layoutOf = linesType('case', L.lineSize, L.lyrics.w, 2);
  return (g, at) => {
    bg(g, at);
    g.drawImage(back, 0, 0);
    drawDisc(g, s, X, Y, r, at * 1000 * SPIN_RAD_PER_MS, parts);
    softLines(g, lines, s.position(), L.lyrics, { layoutOf, ink: paper.ink, start });
  };
}

// ---- VISUALIZER: the cover still, a strip of the music moving under it ----------------------------------------------

function visualizer(L0, s, lines, start) {
  const format = L0.h > L0.w ? '9:16' : '1:1', tall = format === '9:16', L = frameA(format, { strip: tall ? 120 : 160 }), paper = pageOf(s);
  const bg = ambient(s, L.w, L.h, paper);
  const back = still(L, paper, s, (g) => {
    const c = onShadow(L.art.w, L.art.h, paper.light, (cg) => cg.drawImage(coverSquare(s, Math.round(L.art.w)), 0, 0, L.art.w, L.art.h));
    g.drawImage(c.canvas, L.art.x - c.pad, L.art.y - c.pad);
    namesAndCredit(g, L, s, paper);
  });
  const N = tall ? 56 : 32, level = new Array(N).fill(0.08), layoutOf = linesType('vis', L.lineSize, L.lyrics.w, 2);
  let last = null;
  return (g, at) => {
    const dt = last === null ? 1 / 30 : Math.max(0, at - last); last = at;
    const sp = spectrumOf(s, N);
    // quick up, slower down, as a meter
    for (let i = 0; i < N; i++) { const to = sp ? Math.min(1, sp[i] * 1.15) : 0.08; level[i] += (to - level[i]) * Math.min(1, dt * (to > level[i] ? 22 : 7)); }
    bg(g, at);
    g.drawImage(back, 0, 0);
    bars(g, L.strip.x, L.strip.y, L.strip.w, L.strip.h, level, 1, paper.ink);
    softLines(g, lines, s.position(), L.lyrics, { layoutOf, ink: paper.ink, start });
  };
}

// ---- HI-FI: the cover, the deck's display under it, the lines lit in its dots ---------------------------------------

function hifi(L0, s, lines, start) {
  const format = L0.h > L0.w ? '9:16' : '1:1', tall = format === '9:16', L = frameA(format, { display: tall ? 340 : 300 }), paper = pageOf(s);
  const D = L.display, C = s.colors, P = tall ? 7 : 6, ROWS = 15, GAP = 4;
  let inner = null, color = null, lt = paper.light;
  const bg = ambient(s, L.w, L.h, paper);
  const back = still(L, paper, s, (g) => {
    const c = onShadow(L.art.w, L.art.h, lt, (cg) => cg.drawImage(coverSquare(s, Math.round(L.art.w)), 0, 0, L.art.w, L.art.h));
    g.drawImage(c.canvas, L.art.x - c.pad, L.art.y - c.pad);
    // the glass, without its digits: they're drawn each frame
    ({ inner, color } = deckStrip(g, D.x, D.y, D.w, D.h, C, {}));
    namesAndCredit(g, L, s, paper);
  });
  const ink = rgb(color), digit = tall ? 64 : 56, area = { x: inner.x, y: inner.y + digit + (tall ? 30 : 22), w: inner.w, h: inner.y + inner.h - (inner.y + digit + (tall ? 30 : 22)) - (tall ? 40 : 34) };
  const cols = Math.floor(area.w / P), ox = area.x + (area.w - cols * P) / 2;
  // the display's unlit dots, and its lines' dots, each line's made once
  const unlit = canvas(D.w, D.h), ug = unlit.getContext('2d');
  ug.fillStyle = rgb(color, 0.06);
  for (let r = 0; r < Math.floor(area.h / P); r++) for (let c = 0; c < cols; c++) ug.fillRect(ox - D.x + c * P + P * 0.14, area.y - D.y + r * P + P * 0.14, P * 0.72, P * 0.72);
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
    const step = size + GAP, used = Math.min(rows.length, Math.max(1, Math.floor((area.h / P + GAP) / step)));
    const c = canvas(cols * P, used * step * P), g = c.getContext('2d');
    g.fillStyle = ink;
    for (const row of rows.slice(0, used)) for (const it of row) {
      it.col = it.x;
      for (let y = 0; y < size; y++) for (let xx = 0; xx < it.d.used; xx++) if (it.d.on[y * it.d.cols + xx]) g.fillRect((it.col + xx) * P + P * 0.14, (it.row * step + y) * P + P * 0.14, P * 0.72, P * 0.72);
    }
    return (line.plate = { canvas: lt ? c : glowing(c, P, ink), words: words.filter((it) => it.row < used), rows: used, step });
  };
  for (const line of lines) if (line.time >= start - 10 && line.time <= start + MAX_VIDEO_SECONDS + 5) plate(line); // ready before the recording starts
  // the meters, as the deck's: quick up, slow down
  const SEGS = 40, LOW = -20, HIGH = 3, level = [LOW, LOW];
  const dbOf = (v) => 20 * Math.log10(Math.max(v, 1e-4) / 0.7), frac = (db) => (Math.max(LOW, Math.min(HIGH, db)) - LOW) / (HIGH - LOW);
  let last = null;
  return (g, at) => {
    const pos = s.position(), dt = last === null ? 33 : Math.max(0, (at - last) * 1000); last = at;
    const levels = (s.levels && s.levels()) || null;
    for (let k = 0; k < 2; k++) { const to = levels ? dbOf(levels[k]) : LOW; level[k] += (to - level[k]) * Math.min(1, dt * (to > level[k] ? 0.012 : 0.005)); }
    bg(g, at);
    g.drawImage(back, 0, 0);
    g.drawImage(unlit, D.x, D.y);
    // the track and the time, the time going on
    g.save(); if (!lt) { g.shadowColor = rgb(color, 0.6); g.shadowBlur = Math.round(digit * 0.25); }
    g.font = `700 ${Math.round(digit * 0.3)}px ${FONT}`; g.fillStyle = ink; g.textBaseline = 'top'; g.letterSpacing = '2px';
    g.fillText('TRK', inner.x, inner.y); const lw = g.measureText('TRK ').width; g.letterSpacing = '0px';
    g.save(); g.translate(inner.x + lw, inner.y); drawCells(g, String(s.track || 1).padStart(2, '0'), digit, ink, rgb(color, 0.07)); g.restore();
    const time = clock(pos), tw = [...time].reduce((sum, ch) => sum + (ch === ':' ? digit * 0.32 : digit * 0.72), 0) - digit * 0.16;
    g.save(); g.translate(inner.x + inner.w - tw, inner.y); drawCells(g, time, digit, ink, rgb(color, 0.07)); g.restore();
    g.restore();
    // the line, its words faint till sung (no wipe in, no flash: it's there, and lights up)
    const i = lineIndex(lines, pos);
    if (i >= 0 && pos < lines[i].end + 0.25) {
      const pl = plate(lines[i]), y0 = area.y + Math.floor((Math.floor(area.h / P) - pl.rows * pl.step + GAP) / 2) * P;
      const fade = 1 - clamp01((pos - lines[i].end) / 0.25), inn = lines[i].time <= start + 0.25 ? 1 : clamp01((pos - lines[i].time) / 0.25);
      for (const it of pl.words) {
        const sx = it.col * P, sy = it.row * pl.step * P, sw = it.d.used * P, sh = pl.step * P;
        g.globalAlpha = (pos < it.w.time ? 0.16 : 1) * fade * inn;
        g.drawImage(pl.canvas, sx, sy, sw, sh, ox + sx, y0 + sy, sw, sh);
      }
      g.globalAlpha = 1;
    }
    // L and R, two thin rows of segments along the foot of the glass
    const my = inner.y + inner.h - (tall ? 24 : 20), seg = inner.w / SEGS, bar = tall ? 8 : 6;
    for (let k = 0; k < 2; k++) {
      const n = Math.round(frac(level[k]) * SEGS), y = my + k * (bar + 6);
      for (let q = 0; q < SEGS; q++) { g.fillStyle = rgb(color, q < n ? 0.85 : 0.08); g.fillRect(inner.x + q * seg + seg * 0.15, y, seg * 0.7, bar); }
    }
  };
}

// ---- ALBUM: the cover full frame, one slow push in ------------------------------------------------------------------

function album(L0, s, lines, start) {
  const tall = L0.h > L0.w, W = L0.w, H = L0.h, m = tall ? 72 : 64, size = tall ? 40 : 32;
  // (the square one is all cover, its words on a dark fade, whatever the theme: the cover is the page)
  const paper0 = pageOf(s), paper = tall ? paper0 : { ...paper0, light: false, bottom: lerpColor(coverMean(s) || [20, 20, 22], [0, 0, 0], 0.75), ink: (a = 1) => `rgba(255,255,255,${a})` };
  const lt = paper.light, foot = H - (tall ? 232 : m), namesH = Math.round(size * 3.3);
  const namesBox = { x: m, y: foot - namesH, w: W - m * 2, h: namesH };
  const box = tall ? { x: m, y: 1180, w: W - m * 2, h: namesBox.y - 40 - 1180 } : { x: m, y: namesBox.y - 250, w: W - m * 2, h: 220 };
  // the tall one's cover melts into the page below it (the page is the cover, blurred: it runs on into its own colours)
  const art = coverSquare(s, W), ag = art.getContext('2d');
  if (tall) {
    // (over the whole of it: destination-in clears whatever the shape doesn't cover)
    const melt = ag.createLinearGradient(0, 0, 0, W);
    melt.addColorStop(0.6, 'rgba(0,0,0,1)'); melt.addColorStop(1, 'rgba(0,0,0,0)');
    ag.globalCompositeOperation = 'destination-in'; ag.fillStyle = melt; ag.fillRect(0, 0, W, W); ag.globalCompositeOperation = 'source-over';
  }
  const bg = tall ? ambient(s, W, H, paper) : null;
  const front = canvas(W, H), fg = front.getContext('2d');
  // what lies over the square one's cover: the fade the words sit on, the names, the credit
  const bottom = paper.bottom.join(',');
  if (!tall) {
    const from = H * 0.22, to = H * 0.6, fade = fg.createLinearGradient(0, from, 0, to);
    fade.addColorStop(0, `rgba(${bottom},0)`); fade.addColorStop(0.55, `rgba(${bottom},0.88)`); fade.addColorStop(1, `rgba(${bottom},0.97)`);
    fg.fillStyle = fade; fg.fillRect(0, from, W, to - from);
    fg.fillStyle = `rgba(${bottom},0.95)`; fg.fillRect(0, to, W, H - to);
  }
  namesAndCredit(fg, { w: W, h: H, m, size, side: false }, s, paper, namesBox);
  const layoutOf = linesType('album', tall ? 72 : 50, box.w, 2);
  return (g, at) => {
    if (bg) bg(g, at);
    const z = 1 + 0.03 * (1 - Math.exp(-at / 10)), S = W * z; // (one way, slowing, never back)
    if (tall) g.drawImage(art, (W - S) / 2, 0, S, S);
    else { g.save(); g.beginPath(); g.rect(0, 0, W, H); g.clip(); g.drawImage(art, (W - S) / 2, (H - S) / 2, S, S); g.restore(); }
    g.drawImage(front, 0, 0);
    softLines(g, lines, s.position(), box, { layoutOf, ink: paper.ink, start });
  };
}

// ---- LYRICS (base B): the words big, the small CD at the foot -------------------------------------------------------

// (the CD big in the lower right corner, running off both edges and turning; the names at the foot beside it)
function kinetic(L0, s, lines, start) {
  const tall = L0.h > L0.w, W = L0.w, H = L0.h, m = tall ? 72 : 64, paper = pageOf(s);
  const r = tall ? 360 : 250, cx = W - (tall ? 150 : 90), cy = H - (tall ? 250 : 80), parts = discParts(s, r, paper.light);
  const foot = tall ? H - 232 : H - m, tw = cx - r - m - 24, top = tall ? 220 : m;
  const box = { x: m, y: top, w: W - m * 2, h: cy - r - 50 - top };
  const bg = ambient(s, W, H, paper);
  const back = still(L0, paper, s, (g) => {
    g.save(); g.textBaseline = 'alphabetic';
    const size = tall ? 34 : 28, rows = [[`600 ${size}px ${FONT}`, 0.96, s.title], [`400 ${size}px ${FONT}`, 0.55, s.artist],
      [`400 ${tall ? 22 : 19}px ${MONO}`, 0.42, [String(s.track || 1).padStart(2, '0'), mmss(s.duration)].filter(Boolean).join(' · ')]].filter((x) => x[2]);
    let y = foot;
    for (const [font, a, text] of rows.reverse()) { g.font = font; g.fillStyle = paper.ink(a); g.fillText(wrapRows(g, text, tw, 1)[0], m, y); y -= Math.round(size * 1.3); }
    g.restore();
    credit(g, m + tw, foot, paper.ink, tall ? 22 : 19); // (at the right of the track's row: the corner is the disc's)
    // no lyrics: the name big where the lines would be
    if (!lines.length) names(g, { title: s.title, artist: s.artist }, box.x, box.y, box.w, tall ? 96 : 68, paper.ink, { titleRows: 3 });
  });
  const big = tall ? 96 : 68, layoutOf = linesType('lyrics', big, box.w, tall ? 5 : 3);
  return (g, at) => {
    bg(g, at);
    drawDisc(g, s, cx, cy, r, at * 1000 * SPIN_RAD_PER_MS, parts);
    g.drawImage(back, 0, 0);
    softLines(g, lines, s.position(), box, { layoutOf, ink: paper.ink, start, rise: 10 });
  };
}

// ---- TERMINAL (base B, monospace): the screen ready, the line typing itself as it's sung ----------------------------

// How much of a line is typed by `pos`: each word's letters as far as it's sung. → text
function typed(line, pos) {
  let out = '';
  for (const w of line.words) {
    let word = '';
    for (const p of w.parts) word += p.text.slice(0, Math.floor(p.text.length * sung(p, pos) + 0.001));
    if (!word) break;
    out += (out ? ' ' : '') + word;
    if (word.length < w.text.length) break;
  }
  return out;
}
function terminalFilm(L0, s, lines, start) {
  const tall = L0.h > L0.w, W = L0.w, H = L0.h, m = tall ? 72 : 64, rowH = tall ? 264 : 168;
  // (the page the cover's colours behind dark glass, as a terminal window with its background blurred)
  const paper = paperOf(s.colors), bg = ambient(s, W, H, paper, { dim: 2 });
  const footY = (tall ? H - 232 : H - m) - rowH, top = tall ? 220 : m, size = tall ? 56 : 40, lead = Math.round(size * 1.3), ink = paper.ink;
  const back = still(L0, paper, s, (g) => {
    g.save(); g.textBaseline = 'top'; g.font = `400 ${tall ? 30 : 24}px ${MONO}`; g.fillStyle = ink(0.45); g.fillText('$ cdplayer now', m, top);
    // the cover as a terminal would show it, in blocks
    g.imageSmoothingEnabled = false; g.drawImage(coverSquare(s, 24), m, footY, rowH, rowH); g.imageSmoothingEnabled = true;
    const tx = m + rowH + 32, tw = W - m - tx, step = tall ? 46 : 34;
    const rows = [[0.95, s.title], [0.6, s.artist], [0.45, s.subtitle], [0.45, [String(s.track || 1).padStart(2, '0'), mmss(s.duration)].filter(Boolean).join(' · ')]].filter(([, t]) => t);
    g.font = `400 ${tall ? 30 : 24}px ${MONO}`;
    rows.forEach(([a, text], k) => { g.fillStyle = ink(a); g.fillText(wrapRows(g, text, tw, 1)[0], tx, footY + rowH - rows.length * step + k * step + 4); });
    g.restore();
  });
  const box = { x: m, y: top + (tall ? 80 : 62), w: W - m * 2, h: footY - 50 - (top + (tall ? 80 : 62)) }, maxRows = Math.floor(box.h / lead);
  const shown = lines.length ? lines : [{ time: start, end: Infinity, text: s.title || '', words: [] }];
  const rowsOf = (text) => { const g = scratch(); g.font = `400 ${size}px ${MONO}`; return wrapRows(g, text, box.w - size, 99); };
  return (g, at) => {
    const pos = s.position();
    bg(g, at);
    g.drawImage(back, 0, 0);
    // what's been sung since the video began stays on the screen above, fainter; the line now types itself, the rest
    // of it waiting faintly ahead of the cursor, as a shell suggests what you'll type
    const i = Math.max(0, lineIndex(shown, pos)), first = Math.max(0, lineIndex(shown, start)), rows = [];
    for (let k = first; k < i; k++) for (const r of rowsOf(shown[k].text)) rows.push([r, 0.5]);
    const now = shown[i], done = now.words.length ? typed(now, pos) : now.text;
    const all = rowsOf(now.text), doneRows = rowsOf(done || ' ');
    all.forEach((r, k) => rows.push([r, 0.22, k < doneRows.length ? (k === doneRows.length - 1 ? doneRows[k] : r) : '']));
    const fromRow = Math.max(0, rows.length - maxRows);
    g.save(); g.textBaseline = 'top'; g.font = `400 ${size}px ${MONO}`;
    let cursor = null, startsAt = null;
    rows.slice(fromRow).forEach(([text, a, over], k) => {
      const y = box.y + k * lead;
      g.fillStyle = ink(a); g.fillText(text, box.x, y);
      if (over === undefined) return;
      if (!startsAt) startsAt = { x: box.x, y };
      if (over) { g.fillStyle = ink(0.95); g.fillText(over, box.x, y); cursor = { x: box.x + g.measureText(over).width, y }; }
    });
    cursor = cursor || startsAt;
    if (cursor && Math.floor(at * 1.6) % 2 === 0) { g.fillStyle = ink(0.85); g.fillRect(cursor.x + size * 0.08, cursor.y + (lead - size) / 2, size * 0.58, size * 1.05); }
    g.restore();
  };
}

// ---- The words, as they're sung --------------------------------------------------------------------------------

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

// ---- The parts of things --------------------------------------------------------------------------------------------

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
