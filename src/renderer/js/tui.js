// PLAYER LOOK → TERMINAL, the part with no window in it: text cut to character cells (a Chinese character takes two,
// a combining mark none), a grid of cells to write into, and the screen laid out on it from what's playing, with where
// each thing to click is. look-terminal.js puts it on a canvas.

import { traySlide } from './tray-motion.js';

const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏ꥠ-꥿가-힣豈-﫿︰-﹯＀-｠￠-￦]|[\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;
const NO_WIDTH = /^[\p{M}​-‍︀-️]$/u;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

/** How many cells a character takes: 0, 1 or 2. */
export const cellWidth = (ch) => (NO_WIDTH.test(ch) ? 0 : WIDE.test(ch) ? 2 : 1);

/** Text as what goes in each cell: [{ ch, w }], a mark stuck on the character before it, nothing that isn't printable. */
export function glyphs(text) {
  const out = [];
  for (const ch of String(text == null ? '' : text).replace(CONTROL, ' ').normalize('NFC')) {
    const w = cellWidth(ch);
    if (w === 0 && out.length) out[out.length - 1].ch += ch;
    else if (w > 0) out.push({ ch, w });
  }
  return out;
}
export const textWidth = (text) => glyphs(text).reduce((sum, g) => sum + g.w, 0);

/** Text in at most `w` cells: cut with an … when it doesn't fit (a wide character isn't cut in half). */
export function clip(text, w) {
  if (w <= 0) return '';
  const all = glyphs(text);
  if (all.reduce((sum, g) => sum + g.w, 0) <= w) return all.map((g) => g.ch).join('');
  let used = 0, out = '';
  for (const g of all) {
    if (used + g.w > w - 1) break;
    out += g.ch; used += g.w;
  }
  return `${out}…`;
}

const LEVELS = ' ▁▂▃▄▅▆▇█';
/** A level 0–1 as a block as high as it is. */
export const levelChar = (v) => LEVELS[Math.max(0, Math.min(8, Math.round(v * 8)))];

/** A row of `n` rows' worth of levels: the character for `v` in row `row` (0: the top). */
export function stackedLevel(v, row, n) {
  return levelChar(Math.max(0, Math.min(1, v * n - (n - 1 - row))));
}

/** The seek bar's `w` cells as levels: the waveform's loudest in each, or an even line where there's none. */
export function seekLevels(buckets, w) {
  if (!buckets || !buckets.length) return Array(Math.max(0, w)).fill(0.25);
  let top = 0;
  for (const b of buckets) if (b > top) top = b;
  return Array.from({ length: Math.max(0, w) }, (_, i) => {
    const from = Math.floor((i * buckets.length) / w), to = Math.max(from + 1, Math.floor(((i + 1) * buckets.length) / w));
    let most = 0;
    for (let k = from; k < to && k < buckets.length; k++) if (buckets[k] > most) most = buckets[k];
    return 0.125 + 0.875 * (top > 0 ? most / top : 0);
  });
}

const RAMP = ' .:-=+*#%@';
/**
 * A picture of `w` × `h` pixels (RGBA) as `h` rows of `w` cells: each a character as dense as the pixel is bright, in
 * its colour, kept bright enough to read; nothing where the picture's clear (round the disc, its hole).
 */
// A colour of the disc's characters on a light theme's white "paper": darkened (its hue kept) until it stands out
// from `bg` at least `ratio` to 1 — the cover's pale parts would be all but white on white. A dark enough one: as it is.
const linear = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const gamma = (v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
const lum = (c) => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
export function onPaper(c, bg, ratio = 3) {
  const most = (lum(bg) + 0.05) / ratio - 0.05, l = lum(c);
  if (l <= most) return c;
  return c.map((v) => gamma(linear(v) * (most / l)));
}

export function asciiCells(rgba, w, h, { paper = false } = {}) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, a = rgba[i + 3];
      if (a < 96) { row.push(null); continue; }
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      if (paper && Math.min(r, g, b) >= 232) { row.push(null); continue; } // (on a light theme's paper, what's white is the paper: the hole, a white cover's white)
      const lift = Math.max(1, 110 / Math.max(r, g, b, 1));
      row.push({
        ch: RAMP[Math.max(1, Math.min(RAMP.length - 1, Math.round(lum * (RAMP.length - 1))))],
        rgb: [Math.min(255, Math.round(r * lift)), Math.min(255, Math.round(g * lift)), Math.min(255, Math.round(b * lift))],
      });
    }
    rows.push(row);
  }
  return rows;
}

/** Cells to write into, and what's to click among them (the last added is on top). */
export class Grid {
  constructor(cols, rows) {
    this.cols = cols; this.rows = rows; this.hits = []; this.meta = {};
    this.cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
  }
  /** Writes text from (x, y), up to `limit` (not past the grid). → the cell after it. */
  put(x, y, text, color = 'text', { bold = false, limit = this.cols } = {}) {
    if (y < 0 || y >= this.rows) return x;
    const end = Math.min(limit, this.cols);
    for (const g of glyphs(text)) {
      if (x + g.w > end) break;
      if (x >= 0) {
        this.cells[y][x] = { ch: g.ch, w: g.w, color, bold };
        if (g.w === 2) this.cells[y][x + 1] = { ch: '', w: 0, color, bold };
      }
      x += g.w;
    }
    return x;
  }
  /** A frame, its title in its top edge; `right`: words at the right of that edge. */
  box(x, y, w, h, title = '', right = '') {
    if (w < 2 || h < 2) return;
    const edge = 'muted', far = x + w - 1, low = y + h - 1;
    for (let i = x + 1; i < far; i++) { this.put(i, y, '─', edge); this.put(i, low, '─', edge); }
    for (let i = y + 1; i < low; i++) { this.put(x, i, '│', edge); this.put(far, i, '│', edge); }
    this.put(x, y, '┌', edge); this.put(far, y, '┐', edge); this.put(x, low, '└', edge); this.put(far, low, '┘', edge);
    const rightWords = right ? clip(right, Math.max(0, Math.floor(w / 2) - 4)) : '';
    if (rightWords) this.put(far - textWidth(rightWords) - 2, y, ` ${rightWords} `, 'muted');
    if (title) {
      const room = w - 6 - (rightWords ? textWidth(rightWords) + 3 : 0);
      if (room > 0) this.put(x + 2, y, ` ${clip(title, room)} `, 'accent', { bold: true });
    }
  }
  hit(x, y, w, act, arg, h = 1) { this.hits.push({ x, y, w, h, act, arg }); }
  /** What's to click at a cell, or null. */
  hitAt(x, y) {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const r = this.hits[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r;
    }
    return null;
  }
}

/** Keys as [ NAMES ] from (x, y) along a line up to `limit`: those that don't fit left out. A disabled one's dim and dead. → the cell after. */
function keys(grid, x, y, limit, items) {
  for (const item of items) {
    if (!item) continue;
    const label = `[${item.label}]`, w = textWidth(label);
    if (x + w > limit) break;
    grid.put(x, y, label, item.disabled ? 'dim' : item.on ? 'accent' : 'text', { bold: !!item.bold || !!item.on });
    if (!item.disabled) grid.hit(x, y, w, item.act, item.arg);
    x += w + 1;
  }
  return x;
}

const NOW_MIN = 66; // the cells NOW PLAYING's keys need: the disc makes do with what's left
const TRAY_REACH = 0.42; // how far out the tray runs, of its own height
const DISC_LEAST = 18; // less than this and it wouldn't read as a disc: it goes

/** The sizes of the panes for a window of `cols` × `rows` cells, a cell `cellRatio` times as tall as it's wide. */
export function panes(cols, rows, cellRatio = 2) {
  const body = rows - 1; // (the line of keys under it all)
  const top = Math.max(13, Math.min(body - 6, Math.round(body * 0.56)));
  const room = Math.min(Math.round((top - 2) * cellRatio), cols - NOW_MIN - 4);
  if (room < DISC_LEAST) return { top, queue: Math.max(0, body - top), discWidth: 0, discInner: 0, discRows: 0 };
  return { top, queue: Math.max(0, body - top), discWidth: room + 4, discInner: room, discRows: Math.min(top - 2, Math.round(room / cellRatio)) };
}

/**
 * The whole screen. `m`: { words: { now, volume }, title, artist, album, source, status, playing, elapsed, remaining,
 * fraction, volume, muted, waveform, spectrum(n) → levels 0–1, disc(w, h) → asciiCells' rows or null, transport[],
 * tools[], queue: { info, next, actions[], slots[] | null, total, rowAt(i), active, top, removable, nextWord }, hint }.
 * → a Grid; its meta.queueRows is how many songs fit.
 */
export function screen(m, cols, rows, cellRatio = 2) {
  const grid = new Grid(cols, rows);
  if (cols < 20 || rows < 8) return grid;
  const p = panes(cols, rows, cellRatio);
  if (p.discWidth) {
    grid.box(0, 0, p.discWidth, p.top, m.words.disc || '');
    if (!(m.tray > 0)) discArt(grid, m, p, 0);
    grid.hit(1, 1, p.discWidth - 2, 'toggle', undefined, p.top - 2);
  }
  nowPlaying(grid, m, p.discWidth, cols - p.discWidth, p.top);
  queuePane(grid, m, p.top, cols, p.queue);
  if (m.hint) {
    const shown = clip(m.hint, cols - 2);
    grid.put(1, rows - 1, shown, 'muted');
    if (m.allKeys && shown.endsWith(m.allKeys)) grid.hit(1 + textWidth(shown) - textWidth(m.allKeys), rows - 1, textWidth(m.allKeys), 'keys');
  }
  if (p.discWidth && m.tray > 0) tray(grid, m, p);
  return grid;
}

function discArt(grid, m, p, by) {
  const art = m.disc ? m.disc(p.discInner, p.discRows) : null, down = 1 + by + Math.floor((p.top - 2 - p.discRows) / 2);
  if (!art) {
    const word = clip(m.words.noDisc || '', p.discInner);
    grid.put(2 + Math.floor((p.discInner - textWidth(word)) / 2), by + Math.floor(p.top / 2), word, 'muted');
    return;
  }
  art.forEach((row, y) => row.forEach((c, x) => {
    if (c && y + down < grid.rows) grid.cells[y + down][x + 2] = { ch: c.ch, w: 1, color: c.rgb, bold: false };
  }));
}

/** The tray out (`m.tray` 0–1, tray-motion.js): the disc's frame runs down a row at a time over what's under it, the disc in it, the opening behind it shaded. */
export const trayRows = (t, top) => Math.max(0, Math.round(traySlide(t) * top * TRAY_REACH));
function tray(grid, m, p) {
  const by = trayRows(m.tray, p.top), w = p.discWidth;
  for (let y = 1; y <= by && y < p.top - 1; y++) for (let x = 1; x < w - 1; x++) grid.put(x, y, '░', 'dim');
  for (let y = by; y < by + p.top && y < grid.rows; y++) for (let x = 0; x < w; x++) grid.cells[y][x] = null;
  grid.box(0, by, w, Math.min(p.top, grid.rows - by), by > 0 ? m.words.tray || '' : m.words.disc || '');
  discArt(grid, m, p, by);
  grid.hit(0, by, w, 'click', 'tray-button', p.top); // (clicked: it closes)
}

function nowPlaying(grid, m, x0, w, h) {
  grid.box(x0, 0, w, h, m.words.now || '', m.status || '');
  const x = x0 + 2, end = x0 + w - 2, width = end - x;
  const inner = h - 2;
  // what's always there: the song, the bar, the keys, the volume; the room left over goes to the levels
  const album = m.album && m.source && m.source.includes(m.album) ? '' : [m.album, m.year].filter(Boolean).join(' · '); // (the source's line often says it already)
  const lines = [m.title, m.artist, album, m.source].filter(Boolean);
  const fixed = lines.length + 1 + 1 + 1 + 1 + (m.tools && m.tools.some(Boolean) ? 1 : 0); // bar, keys, volume, a gap…
  const levels = Math.max(0, Math.min(6, inner - fixed - 2)); // (with a line's gap above them and below)
  let y = 1;
  lines.forEach((text, i) => {
    grid.put(x, y++, clip(text, width), i === 0 ? 'accent' : i === 1 ? 'text' : 'muted', { bold: i === 0 });
  });
  if (levels > 0) {
    y++;
    const bars = m.spectrum ? m.spectrum(width) : [];
    for (let r = 0; r < levels; r++) {
      for (let i = 0; i < width; i++) {
        const c = stackedLevel(bars[i] || 0, r, levels);
        if (c !== ' ') grid.put(x + i, y + r, c, r < levels / 2 ? 'accent' : 'muted');
      }
    }
    y += levels;
  }
  y = Math.max(y + 1, h - 2 - (m.tools && m.tools.some(Boolean) ? 4 : 3)); // (the bar, a gap, the keys, the volume, the tools: down to the frame's bottom edge)

  // The seek bar: its waveform, lit as far as the song's got.
  const elapsed = m.elapsed || '', remaining = m.remaining || '';
  grid.put(x, y, elapsed, 'text');
  grid.put(end - textWidth(remaining), y, remaining, 'muted');
  const bx = x + textWidth(elapsed) + 1, bw = end - textWidth(remaining) - 1 - bx;
  if (bw > 3) {
    const shape = seekLevels(m.waveform, bw), at = Math.max(0, Math.min(bw - 1, Math.floor((m.fraction || 0) * bw)));
    shape.forEach((v, i) => grid.put(bx + i, y, i === at ? '█' : levelChar(v), i === at ? 'text' : i < at ? 'accent' : 'muted'));
    grid.hit(bx, y, bw, 'seek');
  }
  y += 2;
  keys(grid, x, y, end, m.transport || []);
  y += 1;

  // The volume: as a row of blocks; its name to mute.
  const name = m.words.volume || '';
  grid.put(x, y, name, m.muted ? 'accent' : 'muted');
  grid.hit(x, y, textWidth(name), 'mute');
  const vx = x + textWidth(name) + 1, percent = `${m.volume}%`, vw = Math.min(24, Math.max(0, end - vx - 6));
  if (vw > 0) {
    const on = Math.round((m.volume / 100) * vw);
    for (let i = 0; i < vw; i++) grid.put(vx + i, y, i < on ? '█' : '░', i < on ? (m.muted ? 'muted' : 'accent') : 'dim');
    grid.hit(vx, y, vw, 'volume');
    grid.put(vx + vw + 1, y, percent, 'muted');
  }
  if (m.tools && m.tools.some(Boolean)) keys(grid, x, y + 1, end, m.tools);
}

function queuePane(grid, m, y0, cols, h) {
  if (h < 3 || !m.queue) return;
  const q = m.queue;
  grid.box(0, y0, cols, h, q.info || '');
  const x = 2, end = cols - 2;
  let y = y0 + 1;
  const low = y0 + h - 1;
  if (q.actions && q.actions.some(Boolean) && y < low) keys(grid, x, y++, end, q.actions);
  if (q.next && y < low) grid.put(x, y++, clip(q.next, end - x), 'muted');
  if (q.slots && y < low) {
    const each = Math.floor((end - x) / q.slots.length);
    q.slots.forEach((slot, i) => {
      const sx = x + i * each, word = `${i + 1} ${slot ? slot.title : '—'}`;
      grid.put(sx, y, clip(word, each - 1), slot && slot.playing ? 'accent' : slot ? (slot.done ? 'dim' : 'text') : 'dim', { bold: !!(slot && slot.playing) });
      if (slot) grid.hit(sx, y, each - 1, 'slot', i);
    });
    y++;
  }
  const fit = Math.max(0, low - y);
  grid.meta.queueRows = fit;
  const total = q.total || 0, most = Math.max(0, total - fit);
  // Where the list starts: where it was scrolled to, or round the song playing.
  const first = Math.max(0, Math.min(most, q.top !== null && q.top !== undefined ? q.top : (q.active || 0) - Math.floor(fit / 3)));
  grid.meta.queueTop = first; grid.meta.queueMost = most;
  for (let i = 0; i < fit && first + i < total; i++) {
    const row = q.rowAt(first + i);
    if (!row) continue;
    const ry = y + i, color = row.active ? 'accent' : row.skipped ? 'dim' : 'text', bold = !!row.active;
    grid.put(x, ry, row.active ? '>' : ' ', 'accent', { bold: true });
    const no = `${row.no}.`.padStart(4, ' ');
    grid.put(x + 2, ry, no, row.active ? 'accent' : 'muted');
    const right = q.removable ? end - 2 : end, time = row.time || '';
    const timeX = right - textWidth(time);
    grid.put(timeX, ry, time, 'muted');
    const tag = row.next && q.nextWord ? ` ${q.nextWord}` : '', room = timeX - 1 - (x + 7) - textWidth(tag);
    const after = grid.put(x + 7, ry, clip(row.title, room), color, { bold });
    if (tag) grid.put(after, ry, tag, 'muted');
    grid.hit(x, ry, end - x, 'row', row.index);
    if (q.removable) { grid.put(end - 1, ry, '×', 'muted'); grid.hit(end - 2, ry, 2, 'remove', row.index); }
  }
}
