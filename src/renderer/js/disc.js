// The spinning disc in its jewel case — the app's centerpiece. Normal view, CD view (enlarged) and Mini Mode
// (no case) share one canvas; the disc face is pre-rendered once per cover/size/colors and just rotated per frame.
// Clicking the little cover in the case's corner opens the album art full-size over the case, in place of the
// disc; clicking the art puts it back in the corner.
import { colors, rgb, FONT } from './theme.js';

const SIZES = {
  normal: { cap: 380, margin: 40 },
  enlarged: { cap: 640, margin: 40 },
  mini: { cap: 84, margin: 4 },
};
const EJECT_OUT = 300, EJECT_HOLD = 180, EJECT_BACK = 320;
const ART_MS = 340;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

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
    this.onArtClick = null;       // (art's rectangle on screen) → open the booklet
    this.suppressRebuild = false; // during a theme color transition, keep the old face instead of re-rendering every frame
    this.morph = null;            // { from, to, t }: between two modes' sizes, while CD View opens or closes
    this.artOpen = false;         // the full-size album art is showing instead of the disc
    this.artT = 0;                // 0 = disc with the little cover in the corner … 1 = full art (animated)
    this.artRect = null;          // where the clickable cover is drawn right now (canvas CSS px)
    // The light the disc reflects: it follows the mouse anywhere in the window, like tilting a CD under a lamp.
    this.light = { angle: -Math.PI * 0.75, target: -Math.PI * 0.75, strength: 0.6, targetStrength: 0.6, movedAt: 0 };
    this.center = null; // the disc's center and radius on screen, from the last frame
    window.addEventListener('mousemove', (e) => this.aimLight(e.clientX, e.clientY));
    canvas.addEventListener('dblclick', (e) => { if (this.mode !== 'mini' && !this.artOpen && !this.overArt(e)) this.startEject(); });
    canvas.addEventListener('click', (e) => {
      if (this.mode === 'mini') { if (this.onMiniClick) this.onMiniClick(); return; }
      if (!this.overArt(e)) return;
      // The full-size art is the booklet's front cover: clicking it opens the booklet (booklet.js), which puts the
      // art back in the corner when it closes. Without a booklet handler it just goes back, as before.
      if (this.artOpen && this.artT >= 1 && this.onArtClick) {
        const c = this.canvas.getBoundingClientRect(), r = this.artRect;
        this.onArtClick({ left: c.left + r.x, top: c.top + r.y, width: r.w, height: r.h });
      } else this.artOpen = !this.artOpen;
    });
    canvas.addEventListener('mousemove', (e) => {
      const over = this.mode !== 'mini' && this.overArt(e);
      canvas.style.cursor = over ? 'pointer' : '';
      canvas.title = over ? (this.artOpen ? (this.onArtClick ? 'Open the booklet' : 'Back to the disc') : 'Show the full album art') : '';
    });
  }
  setMode(mode) { this.mode = mode; }
  setCover(img) {
    this.cover = img; this.coverVersion = (this.coverVersion || 0) + 1;
    if (!img) { this.artOpen = false; this.artT = 0; } // nothing to show full-size
  }
  overArt(e) {
    const r = this.artRect;
    return !!(r && this.cover && e.offsetX >= r.x && e.offsetX <= r.x + r.w && e.offsetY >= r.y && e.offsetY <= r.y + r.h);
  }
  aimLight(x, y) {
    const c = this.center;
    if (!c) return;
    const dx = x - c.x, dy = y - c.y;
    this.light.target = Math.atan2(dy, dx);
    // Brighter the closer the light is: strongest over the disc, still a glint from across the window.
    this.light.targetStrength = Math.max(0.35, Math.min(1, 1.25 - Math.hypot(dx, dy) / (c.r * 4)));
    this.light.movedAt = performance.now();
  }
  // Eases the reflection toward the mouse (the short way round); left alone for a few seconds, it drifts slowly, so a
  // spinning disc in CD View or Visualizer's idle still catches the light.
  stepLight(now, dt) {
    const l = this.light;
    if (now - l.movedAt > 4000) l.target += 0.00012 * dt;
    let delta = l.target - l.angle;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const k = 1 - Math.exp(-dt / 140);
    l.angle += delta * k;
    l.strength += (l.targetStrength - l.strength) * k;
  }

  /**
   * The tilt shine: how a CD's surface splits light into two rainbow fans on opposite sides of the hole, lined up with
   * the light, plus a soft glare. Drawn over the disc face but not turned with it — reflections stay put while a disc
   * spins. Rendered on its own canvas so the fans can fade out toward the hub and the rim.
   */
  drawShine(g, cx, cy, side, dpr) {
    const px = Math.max(1, Math.round(side * dpr));
    if (!this.shine || this.shine.width !== px) { this.shine = new OffscreenCanvas(px, px); }
    const s = this.shine.getContext('2d'), c = px / 2, { angle, strength } = this.light;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = 'source-over';
    s.clearRect(0, 0, px, px);
    const cone = s.createConicGradient(angle - Math.PI / 2, c, c);
    const RAINBOW = ['255,70,70', '255,190,60', '120,255,120', '70,220,255', '110,120,255', '220,110,255'];
    for (const mid of [0.25, 0.75]) { // the fan on the light's side, and its twin opposite
      const w = 0.075;
      cone.addColorStop(mid - w * 1.6, 'rgba(255,255,255,0)');
      RAINBOW.forEach((rgbText, i) => cone.addColorStop(mid - w + (2 * w * i) / (RAINBOW.length - 1), `rgba(${rgbText},0.9)`));
      cone.addColorStop(mid + w * 1.6, 'rgba(255,255,255,0)');
    }
    s.fillStyle = cone;
    s.fillRect(0, 0, px, px);
    // Fans are brightest across the middle of the disc, gone at the hub and fading at the rim.
    const ring = s.createRadialGradient(c, c, 0, c, c, c);
    ring.addColorStop(0, 'rgba(0,0,0,0)'); ring.addColorStop(0.22, 'rgba(0,0,0,0)');
    ring.addColorStop(0.45, 'rgba(0,0,0,1)'); ring.addColorStop(0.85, 'rgba(0,0,0,0.8)'); ring.addColorStop(1, 'rgba(0,0,0,0)');
    s.globalCompositeOperation = 'destination-in';
    s.fillStyle = ring;
    s.fillRect(0, 0, px, px);
    // A soft glare on the light's side.
    s.globalCompositeOperation = 'lighter';
    const gx = c + Math.cos(angle) * c * 0.5, gy = c + Math.sin(angle) * c * 0.5;
    const glare = s.createRadialGradient(gx, gy, 0, gx, gy, c * 0.7);
    glare.addColorStop(0, 'rgba(255,255,255,0.35)'); glare.addColorStop(1, 'rgba(255,255,255,0)');
    s.fillStyle = glare;
    s.fillRect(0, 0, px, px);

    g.save();
    g.beginPath(); g.arc(cx, cy, side / 2, 0, Math.PI * 2); g.clip();
    g.globalCompositeOperation = 'screen';
    g.globalAlpha *= 0.22 + 0.2 * strength;
    g.drawImage(this.shine, cx - side / 2, cy - side / 2, side, side);
    g.restore();
  }

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

    const a = SIZES[this.morph ? this.morph.from : this.mode], b = SIZES[this.morph ? this.morph.to : this.mode];
    const t = this.morph ? this.morph.t : 0;
    const cap = a.cap + (b.cap - a.cap) * t, margin = a.margin + (b.margin - a.margin) * t;
    const mini = this.mode === 'mini';
    const room = Math.min(r.width, r.height) - (mini ? margin : margin + 20);
    const side = Math.max(10, Math.floor(Math.min(cap, room)));
    const x = (r.width - side) / 2, y = (r.height - side) / 2, cx = x + side / 2, cy = y + side / 2;
    this.center = { x: r.left + cx, y: r.top + cy, r: side / 2 };
    let bounds = { x, y, w: side, h: side };

    this.artT = Math.max(0, Math.min(1, this.artT + (this.artOpen ? 1 : -1) * (dt / ART_MS)));
    const art = mini || !this.cover ? 0 : easeInOutCubic(this.artT);
    this.artRect = null;
    let drawArt = null;
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
        // The little cover in the corner, grown towards filling the case as the art opens. Drawn after the disc,
        // so it covers it on the way.
        const thumb = Math.round(side * 0.193), full = cs - 28;
        const size = thumb + (full - thumb) * art;
        this.artRect = { x: caseX + 14, y: caseY + 14, w: size, h: size };
        drawArt = (cover) => {
          const x = caseX + 14, y = caseY + 14;
          g.fillStyle = 'rgba(0,0,0,0.47)';
          g.beginPath(); g.roundRect(x, y, size, size, 3 + 3 * art); g.fill();
          const inner = size - 6;
          if (inner > 0) {
            const iw = cover.naturalWidth, ih = cover.naturalHeight, s = Math.min(iw, ih);
            g.save();
            g.beginPath(); g.roundRect(x + 3, y + 3, inner, inner, 1.5 + 3 * art); g.clip();
            g.imageSmoothingQuality = 'high';
            g.drawImage(cover, (iw - s) / 2, (ih - s) / 2, s, s, x + 3, y + 3, inner, inner);
            g.restore();
          }
          g.strokeStyle = rgb(colors.accent2); g.lineWidth = 1.2;
          g.beginPath(); g.roundRect(x + 2, y + 2, size - 4, size - 4, 2.5 + 3 * art); g.stroke();
        };
      }
    }

    const eject = this.ejectProgress(now);
    g.save();
    // As the full art opens, the disc sinks back a little and fades out underneath it.
    g.globalAlpha = 1 - art;
    g.translate(cx + side * 0.14 * eject, cy - side * 0.42 * eject);
    g.scale(1 - 0.08 * art, (1 - 0.08 * art) * (1 - 0.22 * eject));
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
    this.stepLight(now, dt);
    this.drawShine(g, cx, cy, side, dpr);
    if (!this.spinning) {
      g.fillStyle = 'rgba(10,11,16,0.35)';
      g.beginPath(); g.arc(cx, cy, side / 2, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    if (drawArt) drawArt(this.cover);
    return bounds;
  }

  get animating() { return this.spinning || this.ejectStart >= 0; }
}
