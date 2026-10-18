// The deck's display, under the seek bar: a dark window like a CD player's front panel — the track number and the time
// in seven-segment digits that glow in the theme's colour, the segments not lit faintly there behind them (88:88), and
// PLAY / PAUSE / SHUFFLE / REPEAT lit or dark beside them. Clicked, the time counts down what's left (a deck's TIME
// button). The digits are drawn here (no font to load); a canvas is only drawn again when what it shows has changed.
import { colors } from './theme.js';

// The segments lit for each character: a top, b top right, c bottom right, d bottom, e bottom left, f top left, g middle.
export const SEGMENTS = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '' };

/**
 * A time as the display's cells: the minutes in two cells or more (no leading zero) with a cell before them for the
 * sign (− right before the minutes, for the time left), a colon, the seconds — always as wide, so the digits never
 * move. 187 s → '  3:07', left → ' -3:07'.
 */
export function timeCells(seconds, { left = false } = {}) {
  const s = Math.max(0, Math.floor(seconds || 0)), m = `${left ? '-' : ''}${Math.floor(s / 60)}`;
  return `${m.padStart(3, ' ')}:${String(s % 60).padStart(2, '0')}`;
}
/** A track number as two cells: 3 → '03'; none → '--'. */
export const trackCells = (n) => (n > 0 ? String(Math.min(99, n)).padStart(2, '0') : '--');

const SLANT = 0.07; // the digits lean a little, as on the panel

function segmentPaths(w, h) {
  const th = h * 0.13, gap = th * 0.18, half = th / 2;
  const horiz = (yc) => [[half + gap, yc], [th + gap, yc - half], [w - th - gap, yc - half], [w - half - gap, yc], [w - th - gap, yc + half], [th + gap, yc + half]];
  const vert = (xc, ya, yb) => [[xc, ya], [xc + half, ya + half], [xc + half, yb - half], [xc, yb], [xc - half, yb - half], [xc - half, ya + half]];
  return {
    a: horiz(half), g: horiz(h / 2), d: horiz(h - half),
    f: vert(half, half + gap, h / 2 - gap), b: vert(w - half, half + gap, h / 2 - gap),
    e: vert(half, h / 2 + gap, h - half - gap), c: vert(w - half, h / 2 + gap, h - half - gap),
  };
}

function drawCells(g, text, h, lit, ghost) {
  const w = h * 0.56, step = w + h * 0.16, colonW = h * 0.32, paths = segmentPaths(w, h);
  const shape = (pts, x) => { g.beginPath(); pts.forEach(([px, py], i) => g[i ? 'lineTo' : 'moveTo'](x + px + (h - py) * SLANT, py)); g.closePath(); };
  const dot = (x, y) => { g.beginPath(); g.arc(x + (h - y) * SLANT, y, h * 0.065, 0, Math.PI * 2); };
  let x = 0;
  for (const ch of text) {
    if (ch === ':') {
      for (const pass of [ghost, lit]) { g.fillStyle = pass; for (const y of [h * 0.32, h * 0.7]) { dot(x + colonW / 2 - h * 0.04, y); g.fill(); } }
      x += colonW;
      continue;
    }
    const on = SEGMENTS[ch] || '';
    for (const [name, pts] of Object.entries(paths)) {
      g.fillStyle = on.includes(name) ? lit : ghost;
      shape(pts, x); g.fill();
    }
    x += step;
  }
}
// (the last digit's gap after it isn't part of it: the time lines up with what's above it)
const cellsWidth = (text, h) => [...text].reduce((sum, ch) => sum + (ch === ':' ? h * 0.32 : h * 0.72), 0) - (text.endsWith(':') ? 0 : h * 0.16) + h * SLANT;

export class DeckDisplay {
  constructor({ track, time, of, total, flags }) {
    Object.assign(this, { trackCanvas: track, timeCanvas: time, ofNode: of, totalNode: total, flags });
    this.shown = { track: null, time: null, color: null };
    this.track = '--'; this.time = timeCells(0); this.left = false;
  }
  setTrack(n, of) {
    this.track = trackCells(n);
    const ofText = n > 0 && of > 0 ? `/${String(of).padStart(2, '0')}` : '';
    if (this.ofNode.textContent !== ofText) this.ofNode.textContent = ofText;
    this.draw();
  }
  /** Where the song is and how long it is (s); the time left instead once TIME has been clicked. */
  setTime(position, duration, left = this.left) {
    this.left = left;
    this.time = left && duration > 0 ? timeCells(duration - position, { left: true }) : timeCells(duration > 0 || position > 0 ? position : 0);
    const total = duration > 0 ? timeCells(duration).trim() : '';
    if (this.totalNode.dataset.time !== total) { this.totalNode.dataset.time = total; this.totalNode.lastChild.textContent = total ? ` ${total}` : ' --:--'; }
    this.draw();
  }
  setFlags({ playing, paused, shuffle, repeat, repeatOne }) {
    const on = { play: playing, pause: paused, shuffle, repeat, one: repeatOne };
    for (const node of this.flags) node.classList.toggle('lit', !!on[node.dataset.flag]);
  }
  // The theme's colour moved (a theme change fades): drawn again in it.
  tick() { this.draw(); }
  draw() {
    const color = `${colors.accent.join(',')}@${window.devicePixelRatio || 1}`; // (moved to a sharper screen: drawn again)
    if (this.shown.color !== color) { this.shown = { track: null, time: null, color }; }
    if (this.shown.track !== this.track) { this.paint(this.trackCanvas, this.track, color); this.shown.track = this.track; }
    if (this.shown.time !== this.time) { this.paint(this.timeCanvas, this.time, color); this.shown.time = this.time; }
  }
  paint(canvas, text, key) {
    const color = key.split('@')[0];
    // (the digits' height is the canvas's data-h; it's drawn bigger by the glow all round, which overhangs its place)
    const h = Number(canvas.dataset.h) || 30, dpr = window.devicePixelRatio || 1, glow = Math.round(h * 0.28);
    const w = Math.ceil(cellsWidth(text, h) + glow * 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round((h + glow * 2) * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round((h + glow * 2) * dpr);
      Object.assign(canvas.style, { width: `${w}px`, height: `${h + glow * 2}px`, margin: `${-glow}px` });
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h + glow * 2);
    g.translate(glow, glow);
    // The dark segments first, then the lit ones twice: once blurred for the glow, once sharp.
    g.shadowBlur = 0;
    drawCells(g, text.replace(/[^:]/g, '8'), h, `rgba(${color},0.07)`, `rgba(${color},0.07)`);
    // (a little under full strength: PLAY stays the brightest thing in the theme's colour)
    g.shadowColor = `rgba(${color},0.7)`; g.shadowBlur = glow;
    drawCells(g, text, h, `rgba(${color},0.9)`, 'rgba(0,0,0,0)');
    g.shadowBlur = 0;
    drawCells(g, text, h, `rgba(${color},0.9)`, 'rgba(0,0,0,0)');
  }
}
