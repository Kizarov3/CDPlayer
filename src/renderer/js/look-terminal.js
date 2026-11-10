// PLAYER LOOK → TERMINAL: the player as a console's screen, one grid of character cells on a canvas (tui.js lays it
// out). On a canvas rather than in text so nothing can push a frame out of line: every character is put in its own
// cell whatever font it came from, and the frames' lines and the blocks are drawn, so they meet with no gaps.
import { colors, shown } from './theme.js';
import { asciiCells, onPaper, screen } from './tui.js';

const FONT_PX = 13;
const LINE = 1.42;
const FPS = 15;
const FONT = '"SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';
const LEVELS = '▁▂▃▄▅▆▇█';
const SHADES = { '░': 0.26, '▒': 0.5, '▓': 0.75 };
const LINES = { // which way each frame's line goes from the middle of its cell
  '─': 'lr', '│': 'ud', '┌': 'rd', '┐': 'ld', '└': 'ru', '┘': 'lu', '├': 'udr', '┤': 'udl', '┬': 'lrd', '┴': 'lru', '┼': 'lrud',
};
const SCROLL_KEPT_MS = 6000; // scrolled away: back to the song playing after this long
const WHEEL_PX_PER_ROW = 40;

export class TerminalLook {
  /** `model()`: tui.js's screen's `m`, as things are now; `act(hit, fraction)`: something on it clicked; `discFace(side)` → the disc's face to draw from; `discTurn()`: how far it's turned over, 0–1. */
  constructor(canvas, { model, act, discFace, discTurn }) {
    Object.assign(this, { canvas, model, act, discFace, discTurn });
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.lastDraw = 0; this.painted = null; this.key = ''; this.angle = 0; this.hover = null;
    this.scrollTop = null; this.scrolledAt = 0; this.grid = null; this.dragging = null;
    this.art = document.createElement('canvas');
    this.artCtx = this.art.getContext('2d', { willReadFrequently: true });
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', () => { this.dragging = null; });
    canvas.addEventListener('pointerleave', () => { this.hover = null; canvas.style.cursor = ''; });
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: true });
  }
  /** Called every frame; draws at its own pace, and only the cells that changed. */
  frame(now, spinning) {
    if (now - this.lastDraw < 1000 / FPS) return;
    const dt = Math.min(250, now - this.lastDraw);
    this.lastDraw = now;
    if (spinning) this.angle += 0.0027 * dt;
    if (this.scrollTop !== null && now - this.scrolledAt > SCROLL_KEPT_MS) this.scrollTop = null;
    this.measure();
    if (!this.cols || !this.rows) return;
    const m = this.model();
    m.disc = (w, h) => this.discCells(w, h);
    if (m.queue) m.queue.top = this.scrollTop;
    this.grid = screen(m, this.cols, this.rows, this.cellRatio);
    this.paint(this.grid);
  }
  measure() {
    const c = this.canvas, dpr = window.devicePixelRatio || 1, w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (!w || !h) { this.cols = 0; return; }
    if (c.width !== w || c.height !== h || this.dpr !== dpr) {
      c.width = w; c.height = h; this.dpr = dpr; this.painted = null;
      this.ctx.font = `${FONT_PX * dpr}px ${FONT}`;
      this.cw = this.ctx.measureText('M').width;
      this.ch = Math.round(FONT_PX * LINE * dpr);
      this.cols = Math.floor(w / this.cw); this.rows = Math.floor(h / this.ch);
      this.cellRatio = this.ch / this.cw;
    }
  }
  discCells(w, h) {
    const face = this.discFace(Math.max(96, Math.min(420, w * 4)));
    if (!face) return null;
    const a = this.art, g = this.artCtx;
    if (a.width !== w || a.height !== h) { a.width = w; a.height = h; }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    // A round disc in cells taller than they're wide: turned first, then squeezed to them.
    const side = face.width;
    const narrowed = Math.max(0.02, Math.abs(Math.cos(Math.PI * this.discTurn()))); // (turning over: narrowing to its edge and widening again)
    g.setTransform((narrowed * w) / side, 0, 0, h / side, w / 2, h / 2);
    g.rotate(this.angle);
    g.imageSmoothingQuality = 'high';
    g.drawImage(face, -side / 2, -side / 2);
    return asciiCells(g.getImageData(0, 0, w, h).data, w, h, { paper: shown.light });
  }
  cellX(x) { return Math.round(x * this.cw); }
  colorOf(name) {
    if (Array.isArray(name)) return `rgb(${(shown.light ? onPaper(name, colors.bg) : name).join(',')})`; // (the disc's: darkened on a light theme's paper)
    if (name === 'dim') return `rgba(${colors.muted.join(',')},.45)`;
    return `rgb(${(colors[name] || colors.text).join(',')})`;
  }
  paint(grid) {
    const g = this.ctx, key = `${colors.bg}|${colors.text}|${colors.accent}|${colors.muted}|${shown.light}`;
    const fresh = !this.painted || this.painted.length !== grid.rows || this.key !== key;
    this.key = key;
    if (fresh) {
      g.fillStyle = this.colorOf('bg');
      g.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.painted = Array.from({ length: grid.rows }, () => Array(grid.cols).fill(''));
    }
    g.textBaseline = 'alphabetic';
    const hover = this.hover;
    for (let y = 0; y < grid.rows; y++) {
      for (let x = 0; x < grid.cols; x++) {
        const c = grid.cells[y][x];
        const lit = !!hover && !!c && y >= hover.y && y < hover.y + hover.h && x >= hover.x && x < hover.x + hover.w && hover.act !== 'toggle';
        const was = c ? `${c.ch}|${Array.isArray(c.color) ? c.color.join() : c.color}|${c.bold ? 1 : 0}|${lit ? 1 : 0}` : '';
        if (was === this.painted[y][x]) continue;
        this.painted[y][x] = was;
        if (c && c.w === 0) continue; // (the second half of a wide character: drawn with its first)
        this.cell(x, y, c, lit);
      }
    }
  }
  cell(x, y, c, lit) {
    const g = this.ctx, wide = c && c.w === 2 ? 2 : 1, left = this.cellX(x), right = this.cellX(x + wide), top = y * this.ch, h = this.ch;
    g.fillStyle = lit ? this.colorOf('accent') : this.colorOf('bg');
    g.fillRect(left, top, right - left, h);
    if (!c || c.ch === ' ') return;
    const color = lit ? this.colorOf('bg') : this.colorOf(c.color);
    g.fillStyle = color;
    const shape = this.drawn(c.ch, left, top, right - left, h);
    if (shape) return;
    // (kept to its cell: a glyph's edge over the next one's stays there when this one's cleared, as crumbs round the turning disc)
    g.save();
    g.beginPath(); g.rect(left, top, right - left, h); g.clip();
    g.font = `${c.bold ? 'bold ' : ''}${FONT_PX * this.dpr}px ${FONT}`;
    g.fillText(c.ch, left, top + Math.round(h * 0.76), right - left);
    g.restore();
  }
  /** The frames' lines and the blocks, drawn so they meet from cell to cell. → whether `ch` was one of them. */
  drawn(ch, left, top, w, h) {
    const g = this.ctx, lines = LINES[ch];
    if (lines) {
      const t = Math.max(1, Math.round(this.dpr)), cx = left + Math.floor((w - t) / 2), cy = top + Math.floor((h - t) / 2);
      if (lines.includes('l')) g.fillRect(left, cy, cx - left + t, t);
      if (lines.includes('r')) g.fillRect(cx, cy, left + w - cx, t);
      if (lines.includes('u')) g.fillRect(cx, top, t, cy - top + t);
      if (lines.includes('d')) g.fillRect(cx, cy, t, top + h - cy);
      return true;
    }
    const level = LEVELS.indexOf(ch);
    if (level >= 0) {
      const high = Math.max(1, Math.round((h * (level + 1)) / 8));
      g.fillRect(left, top + h - high, w, high);
      return true;
    }
    if (SHADES[ch]) {
      g.save(); g.globalAlpha = SHADES[ch]; g.fillRect(left, top, w, h); g.restore();
      return true;
    }
    return false;
  }
  at(e) {
    const r = this.canvas.getBoundingClientRect(), dpr = this.dpr || 1;
    return { x: Math.floor(((e.clientX - r.left) * dpr) / this.cw), y: Math.floor(((e.clientY - r.top) * dpr) / this.ch), px: ((e.clientX - r.left) * dpr) / this.cw };
  }
  fractionIn(hit, px) { return Math.max(0, Math.min(1, (px - hit.x) / hit.w)); }
  down(e) {
    if (e.button !== 0 || !this.grid) return;
    const p = this.at(e), hit = this.grid.hitAt(p.x, p.y);
    if (!hit) return;
    if (hit.act === 'seek' || hit.act === 'volume') {
      this.dragging = hit;
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* gone */ }
      this.act(hit, this.fractionIn(hit, p.px));
    } else this.pressed = hit;
  }
  move(e) {
    if (!this.grid) return;
    const p = this.at(e);
    if (this.dragging) { if (this.dragging.act === 'volume') this.act(this.dragging, this.fractionIn(this.dragging, p.px)); return; }
    const hit = this.grid.hitAt(p.x, p.y);
    this.hover = hit;
    this.canvas.style.cursor = hit ? 'pointer' : '';
  }
  up(e) {
    const p = this.at(e);
    if (this.dragging) {
      if (this.dragging.act === 'seek') this.act(this.dragging, this.fractionIn(this.dragging, p.px));
      this.dragging = null;
      return;
    }
    const hit = this.grid && this.grid.hitAt(p.x, p.y), was = this.pressed;
    this.pressed = null;
    if (hit && was && hit.act === was.act && hit.arg === was.arg) this.act(hit);
  }
  wheel(e) {
    if (!this.grid || !this.grid.meta.queueRows) return;
    // Rows by how far it's turned, what's left over carried on (a trackpad sends many small turns), and never past the list's end.
    this.wheelLeft = (this.wheelLeft || 0) + e.deltaY;
    const rows = Math.trunc(this.wheelLeft / WHEEL_PX_PER_ROW);
    if (!rows) return;
    this.wheelLeft -= rows * WHEEL_PX_PER_ROW;
    const from = this.scrollTop !== null ? this.scrollTop : this.grid.meta.queueTop || 0;
    this.scrollTop = Math.max(0, Math.min(this.grid.meta.queueMost || 0, from + rows));
    this.scrolledAt = performance.now();
  }
}
