// The spinning disc in its jewel case — the app's centerpiece. Normal view, CD view (enlarged) and Mini Mode
// (no case) share one canvas; the disc face is pre-rendered once per cover/size/colors and just rotated per frame.
import { colors, rgb, FONT } from './theme.js';

const SIZES = {
  normal: { cap: 380, margin: 40 },
  enlarged: { cap: 640, margin: 40 },
  mini: { cap: 84, margin: 4 },
};
const EJECT_OUT = 300, EJECT_HOLD = 180, EJECT_BACK = 320;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export class Disc {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = 'normal';
    this.angle = 0;
    this.spinning = false;
    this.cover = null;         // HTMLImageElement
    this.lookingUp = false;
    this.faceCache = null;
    this.faceKey = '';
    this.ejectStart = -1;
    this.ejectPeakFired = false;
    this.onEjectPeak = null;
    this.onMiniClick = null;
    this.suppressRebuild = false; // during a theme color transition, keep the old face instead of re-rendering every frame
    canvas.addEventListener('dblclick', () => { if (this.mode !== 'mini') this.startEject(); });
    canvas.addEventListener('click', () => { if (this.mode === 'mini' && this.onMiniClick) this.onMiniClick(); });
  }
  setMode(mode) { this.mode = mode; }
  setCover(img) { this.cover = img; this.coverVersion = (this.coverVersion || 0) + 1; }
  startEject() { if (this.ejectStart < 0) { this.ejectStart = performance.now(); this.ejectPeakFired = false; } }

  ejectProgress(now) {
    if (this.ejectStart < 0) return 0;
    const t = now - this.ejectStart;
    if (!this.ejectPeakFired && t >= EJECT_OUT) { this.ejectPeakFired = true; if (this.onEjectPeak) this.onEjectPeak(); }
    if (t >= EJECT_OUT + EJECT_HOLD + EJECT_BACK) { this.ejectStart = -1; return 0; }
    if (t < EJECT_OUT) return easeOutCubic(t / EJECT_OUT);
    if (t < EJECT_OUT + EJECT_HOLD) return 1;
    return 1 - easeOutCubic((t - EJECT_OUT - EJECT_HOLD) / EJECT_BACK);
  }

  renderFace(side, dpr) {
    const key = `${side}|${dpr}|${colors.bg}|${this.coverVersion || 0}|${this.lookingUp}`;
    if (this.faceCache && (this.faceKey === key || (this.suppressRebuild && this.faceCache.side === side))) return this.faceCache;
    const scale = dpr * (dpr >= 2 ? 1 : 2); // supersample on low-DPI screens for a clean rim
    const px = Math.max(1, Math.round(side * scale));
    const face = new OffscreenCanvas(px, px);
    const g = face.getContext('2d');
    g.scale(scale, scale);
    const c = side / 2;
    g.fillStyle = 'rgb(20,21,28)';
    g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.fill();
    if (this.cover) {
      g.save();
      g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.clip();
      // Cover art fills the whole disc face (center-cropped if not square).
      const iw = this.cover.naturalWidth, ih = this.cover.naturalHeight, s = Math.min(iw, ih);
      g.imageSmoothingQuality = 'high';
      g.drawImage(this.cover, (iw - s) / 2, (ih - s) / 2, s, s, 0, 0, side, side);
      g.restore();
    } else {
      g.textAlign = 'center';
      g.fillStyle = this.lookingUp ? 'rgba(255,255,255,0.51)' : 'rgba(255,255,255,0.216)';
      if (this.lookingUp) { g.font = `bold ${Math.max(8, side / 32)}px ${FONT}`; g.fillText('…', c, c + side / 42); }
      else { g.font = `${side / 3}px sans-serif`; g.textBaseline = 'middle'; g.fillText('♪', c, c); }
    }
    g.lineWidth = 1.6; g.strokeStyle = 'rgba(255,255,255,0.63)';
    g.beginPath(); g.arc(c, c, c - 0.8, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,0.47)';
    g.beginPath(); g.arc(c, c, c - 3, 0, Math.PI * 2); g.stroke();
    const hole = side / 11;
    g.fillStyle = rgb(colors.bg);
    g.beginPath(); g.arc(c, c, hole / 2, 0, Math.PI * 2); g.fill();
    g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.235)'; g.stroke();
    this.faceCache = { canvas: face, side };
    this.faceKey = key;
    return this.faceCache;
  }

  /** Returns the drawn disc's bounds (CSS px, relative to the canvas) — used to keep theme particles off it. */
  frame(now, dt) {
    const cnv = this.canvas, dpr = window.devicePixelRatio || 1;
    const r = cnv.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const pw = Math.round(r.width * dpr), ph = Math.round(r.height * dpr);
    if (cnv.width !== pw || cnv.height !== ph) { cnv.width = pw; cnv.height = ph; }
    const g = cnv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    if (this.spinning) this.angle += 0.045 * (dt / 16);

    const { cap, margin } = SIZES[this.mode];
    const mini = this.mode === 'mini';
    const room = Math.min(r.width, r.height) - (mini ? margin : margin + 20);
    const side = Math.max(10, Math.floor(Math.min(cap, room)));
    const x = (r.width - side) / 2, y = (r.height - side) / 2, cx = x + side / 2, cy = y + side / 2;
    let bounds = { x, y, w: side, h: side };

    if (!mini) {
      const cs = side + 60, caseX = cx - cs / 2, caseY = cy - cs / 2;
      bounds = { x: caseX, y: caseY, w: cs, h: cs };
      g.fillStyle = 'rgba(255,255,255,0.055)';
      g.beginPath(); g.roundRect(caseX, caseY, cs, cs, 6); g.fill();
      g.strokeStyle = rgb(colors.accent, 0.37); g.lineWidth = 1.6; g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.1)'; g.lineWidth = 1;
      g.beginPath();
      g.moveTo(caseX + 10, caseY + 10.5); g.lineTo(caseX + cs - 10, caseY + 10.5);
      g.moveTo(caseX + 10, caseY + cs - 10.5); g.lineTo(caseX + cs - 10, caseY + cs - 10.5);
      g.stroke();
      if (this.cover) {
        const thumb = Math.round(side * 0.193);
        g.fillStyle = 'rgba(0,0,0,0.47)';
        g.beginPath(); g.roundRect(caseX + 14, caseY + 14, thumb, thumb, 3); g.fill();
        const inner = thumb - 6;
        if (inner > 0) {
          const iw = this.cover.naturalWidth, ih = this.cover.naturalHeight, s = Math.min(iw, ih);
          g.imageSmoothingQuality = 'high';
          g.drawImage(this.cover, (iw - s) / 2, (ih - s) / 2, s, s, caseX + 17, caseY + 17, inner, inner);
        }
        g.strokeStyle = rgb(colors.accent2); g.lineWidth = 1.2;
        g.beginPath(); g.roundRect(caseX + 16, caseY + 16, thumb - 4, thumb - 4, 2.5); g.stroke();
      }
    }

    const eject = this.ejectProgress(now);
    g.save();
    g.translate(cx + side * 0.14 * eject, cy - side * 0.42 * eject);
    g.scale(1, 1 - 0.22 * eject);
    g.translate(-cx, -cy);
    const pad = Math.max(4, side / 90);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.arc(cx, cy, side / 2 + pad, 0, Math.PI * 2); g.fill();
    const face = this.renderFace(side, dpr);
    g.save();
    g.translate(cx, cy); g.rotate(this.angle); g.translate(-cx, -cy);
    g.imageSmoothingQuality = 'high';
    g.drawImage(face.canvas, x, y, side, side);
    g.restore();
    if (!this.spinning) {
      g.fillStyle = 'rgba(10,11,16,0.35)';
      g.beginPath(); g.arc(cx, cy, side / 2, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    return bounds;
  }

  get animating() { return this.spinning || this.ejectStart >= 0; }
}
