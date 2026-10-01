// The spinning disc in its jewel case — the app's centerpiece. Normal view, CD view (enlarged) and Mini Mode
// (no case) share one canvas; the disc face is pre-rendered once per cover/size/colors and just rotated per frame.
// Clicking the little cover in the case's corner opens the album art full-size over the case, in place of the
// disc; clicking the art puts it back in the corner. Grab the disc and turn it to move through the song (jog.js).
import { colors, rgb, FONT } from './theme.js';
import { angleDelta, coast, releaseVelocity } from './jog.js';
import { random } from './disc-wear.js';
import { discLayout, radiusAt, trackAt, R0 } from './disc-data.js';
import { t } from './i18n.js';

const SIZES = {
  normal: { cap: 380, margin: 40 },
  enlarged: { cap: 640, margin: 40 },
  mini: { cap: 84, margin: 4 },
};
const EJECT_OUT = 300, EJECT_HOLD = 180, EJECT_BACK = 320;
const TRAY_MS = 650;     // the tray motor, one way
const SPIN_TAU_MS = 260; // how quickly the disc gets up to speed or winds down (READING spins up slower)
const ART_MS = 340;
const FLIP_MS = 460;     // turning the disc over
const MARKER_FONT = '"Marker Felt", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
// A real disc, as fractions of its radius: the clear plastic around the hole, the mirror band around that (where the
// stamped matrix number sits), and the printed label from there out to the rim.
const CLEAR_R = 0.27, LABEL_R = 0.36;
const WEAR_MIN_SIDE = 150; // too small to see (Mini Mode): no wear drawn
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Disc {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = 'normal';
    this.angle = 0;
    this.spinning = false;
    this.speed = 0;            // 0…1 of full speed, easing toward spinning ? 1 : 0
    this.reading = false;      // spinning up after the tray closes: slower to get going, like a real drive
    this.trayOpen = false;     // the disc tray is out
    this.trayT = 0;            // 0 = closed … 1 = open (animated)
    this.trayDone = null;      // resolves the open/close in progress
    this.discPresent = true;   // false: an empty tray (nothing loaded)
    this.cover = null;         // HTMLImageElement
    this.lookingUp = false;
    this.label = null;         // { title, artist }: handwritten on a disc that has no cover, like a burned CD-R
    this.wear = null;          // the scratches, scuffs and prints of a much-played disc (disc-wear.js), or null
    // The data side (disc-data.js): B, or the ⟲ on the case, turns the disc over to the rings its tracks are written in,
    // with the laser where it's reading. data: { layout, titles, key }; position() → seconds into the disc.
    this.data = null; this.position = null; this.onTrackPick = null;
    this.flipped = false; this.flipT = 0; this.flipRect = null; this.dataFace = null;
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
    // Turning the disc by hand: a press on it becomes a grab once the mouse moves (so clicks and the double-click
    // still work); let go with a spin and it coasts. The app says whether there's a song to turn through
    // (canGrab), and hears onGrab, onJog(radians, ms) as it turns — held or coasting — and onJogEnd once it's still.
    this.canGrab = null; this.onGrab = null; this.onJog = null; this.onJogEnd = null;
    this.press = null;   // { id, x, y }: pressed on the disc, not moved enough yet to be a grab
    this.held = null;    // { id, a, t, samples }: in the hand
    this.fling = 0;      // rad/ms: let go with a spin
    this.jogging = false;
    canvas.addEventListener('pointerdown', (e) => {
      this.downAt = { x: e.clientX, y: e.clientY };
      if (e.button !== 0 || !this.grabbable(e)) return;
      if (this.fling) { this.fling = 0; this.grab(e); } // caught while coasting
      else this.press = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = this.press;
      if (this.held && e.pointerId === this.held.id) this.turnTo(e);
      else if (p && e.pointerId === p.id && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 5) this.grab(e);
    });
    const up = (e) => {
      if (this.press && e.pointerId === this.press.id) this.press = null;
      if (this.held && e.pointerId === this.held.id) this.letGo();
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    window.addEventListener('mousemove', (e) => this.aimLight(e.clientX, e.clientY));
    canvas.addEventListener('dblclick', (e) => { if (this.mode !== 'mini' && !this.artOpen && !this.overArt(e) && !this.overFlip(e) && !this.showingData()) this.startEject(); });
    canvas.addEventListener('click', (e) => {
      if (this.mode === 'mini') { if (this.onMiniClick) this.onMiniClick(); return; }
      if (this.overFlip(e)) { this.flip(); return; }
      // On the data side, a click (not the end of a turn by hand) on a track's ring plays that track.
      const d = this.downAt, still = !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5;
      if (still && this.showingData()) { const i = this.trackUnder(e); if (i >= 0 && this.onTrackPick) this.onTrackPick(i); return; }
      if (!this.overArt(e)) return;
      // The full-size art is the booklet's front cover: clicking it opens the booklet (booklet.js), which puts the
      // art back in the corner when it closes. Without a booklet handler it just goes back, as before.
      if (this.artOpen && this.artT >= 1 && this.onArtClick) {
        const c = this.canvas.getBoundingClientRect(), r = this.artRect;
        this.onArtClick({ left: c.left + r.x, top: c.top + r.y, width: r.w, height: r.h });
      } else this.artOpen = !this.artOpen;
    });
    canvas.addEventListener('mousemove', (e) => {
      const over = this.mode !== 'mini' && this.overArt(e), flip = this.overFlip(e);
      const track = !over && !flip && this.showingData() ? this.trackUnder(e) : -1;
      canvas.style.cursor = this.held ? 'grabbing' : over || flip || track >= 0 ? 'pointer' : this.grabbable(e) ? 'grab' : '';
      canvas.title = flip ? t('Turn the disc over (B)') : track >= 0 ? `${track + 1}. ${this.data.titles[track] || ''}`
        : over ? (this.artOpen ? (this.onArtClick ? t('Open the booklet') : t('Back to the disc')) : t('Show the full album art')) : '';
    });
  }
  setMode(mode) { this.mode = mode; }
  /** The tracks on the disc that's in: { id, durations (s), titles }, or null. A different disc (id) comes in face up. */
  setData(data) {
    const key = data ? JSON.stringify([data.durations, data.titles]) : '';
    if (key === (this.data && this.data.key)) return;
    const another = !this.data || !data || this.data.id !== data.id;
    this.data = data ? { layout: discLayout(data.durations), titles: data.titles, key, id: data.id } : null;
    this.dataFace = null;
    if (another) this.flipped = false; // another disc comes in face up (the same one, its names filling in, stays as it is)
  }
  /** Turns the disc over (or to `side`: true for the data side). */
  flip(side = !this.flipped) { this.flipped = !!side && !!this.data; }
  showingData() { return !!this.data && this.flipT >= 1 && this.mode !== 'mini' && !this.artOpen; }
  overFlip(e) {
    const r = this.flipRect;
    return !!(r && e.offsetX >= r.x - r.r && e.offsetX <= r.x + r.r && e.offsetY >= r.y - r.r && e.offsetY <= r.y + r.r);
  }
  // Which track's ring the pointer is over (the disc turns, but its rings are circles: only the distance matters).
  trackUnder(e) {
    const c = this.center;
    if (!c || !this.data) return -1;
    return trackAt(this.data.layout, Math.hypot(e.clientX - c.x, e.clientY - c.y) / c.r);
  }
  setLabel(title, artist) {
    const label = title ? { title, artist: artist || '' } : null;
    if (JSON.stringify(label) !== JSON.stringify(this.label)) this.label = label;
  }
  setWear(wear) {
    if ((wear && wear.key) !== (this.wear && this.wear.key)) { this.wear = wear; this.glint = null; }
  }
  setCover(img) {
    this.cover = img; this.coverVersion = (this.coverVersion || 0) + 1;
    if (!img) { this.artOpen = false; this.artT = 0; } // nothing to show full-size
  }
  overArt(e) {
    const r = this.artRect;
    return !!(r && this.cover && e.offsetX >= r.x && e.offsetX <= r.x + r.w && e.offsetY >= r.y && e.offsetY <= r.y + r.h);
  }
  // A press here can take hold of the disc: on the disc itself, in the case (not Mini Mode), with nothing over it.
  grabbable(e) {
    const c = this.center;
    if (!c || this.mode === 'mini' || this.artOpen || this.artT > 0 || this.trayT > 0 || this.ejectStart >= 0 || this.morph) return false;
    if (!this.discPresent || this.overArt(e) || Math.hypot(e.clientX - c.x, e.clientY - c.y) > c.r) return false;
    return !this.canGrab || this.canGrab();
  }
  handAngle(e) { return Math.atan2(e.clientY - this.center.y, e.clientX - this.center.x); }
  grab(e) {
    this.press = null;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* the pointer's gone */ }
    const t = performance.now();
    this.held = { id: e.pointerId, a: this.handAngle(e), t, samples: [{ t, a: 0 }], turned: 0 };
    this.canvas.style.cursor = 'grabbing';
    if (!this.jogging) { this.jogging = true; if (this.onGrab) this.onGrab(); }
  }
  turnTo(e) {
    const h = this.held, t = performance.now(), a = this.handAngle(e);
    const d = angleDelta(h.a, a), dt = t - h.t;
    h.a = a; h.t = t; h.turned += d;
    h.samples.push({ t, a: h.turned });
    while (h.samples.length > 2 && t - h.samples[0].t > 150) h.samples.shift();
    this.angle += d;
    if (d && this.onJog) this.onJog(d, dt);
  }
  letGo() {
    const h = this.held;
    this.held = null;
    this.canvas.style.cursor = '';
    this.fling = coast(releaseVelocity(h.samples, performance.now()), 0);
    if (!this.fling) this.endJog();
  }
  endJog() {
    this.fling = 0;
    if (!this.jogging) return;
    this.jogging = false;
    if (this.onJogEnd) this.onJogEnd();
  }
  // Lets go of the disc without a spin — its song changed, or the tray is opening.
  drop() { this.press = null; if (this.held) { this.held = null; this.canvas.style.cursor = ''; } this.endJog(); }

  aimLight(x, y) {
    const c = this.center;
    if (!c) return;
    const dx = x - c.x, dy = y - c.y;
    this.light.target = Math.atan2(dy, dx);
    // Brighter the closer the light is: strongest over the disc, still a glint from across the window.
    this.light.targetStrength = Math.max(0.35, Math.min(1, 1.25 - Math.hypot(dx, dy) / (c.r * 4)));
    this.light.movedAt = performance.now();
  }
  // Eases the reflection toward the mouse (the short way round); left alone for a few seconds, a spinning disc's drifts
  // slowly, so it still catches the light in CD View or Visualizer's idle. Once there, it stops (and so does drawing).
  stepLight(now, dt) {
    const l = this.light;
    if (this.spinning && now - l.movedAt > 4000) l.target += 0.00012 * dt;
    let delta = l.target - l.angle;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const k = 1 - Math.exp(-dt / 140);
    if (Math.abs(delta) < 1e-4) l.angle = l.target; else l.angle += delta * k;
    if (Math.abs(l.targetStrength - l.strength) < 1e-4) l.strength = l.targetStrength; else l.strength += (l.targetStrength - l.strength) * k;
  }

  /**
   * The tilt shine: how a CD's surface splits light into two rainbow fans on opposite sides of the hole, lined up with
   * the light, plus a soft glare. Drawn over the disc face but not turned with it — reflections stay put while a disc
   * spins. Rendered once per size on its own canvas, facing the light at angle 0 (so the fans can fade out toward the
   * hub and the rim), then turned to wherever the light is: the whole pattern just rotates with it.
   */
  drawShine(g, cx, cy, side, dpr) {
    const px = Math.max(1, Math.round(side * dpr));
    if (!this.shine || this.shine.width !== px) { this.shine = new OffscreenCanvas(px, px); this.renderShine(px); }
    const { angle, strength } = this.light;
    g.save();
    g.beginPath(); g.arc(cx, cy, side / 2, 0, Math.PI * 2); g.clip();
    g.globalCompositeOperation = 'screen';
    g.globalAlpha *= 0.22 + 0.2 * strength;
    g.translate(cx, cy); g.rotate(angle);
    g.drawImage(this.shine, -side / 2, -side / 2, side, side);
    g.restore();
  }
  renderShine(px) {
    const s = this.shine.getContext('2d'), c = px / 2, angle = 0;
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
  }

  /** Runs the tray motor out (true) or in (false); resolves when it's there. */
  setTray(open) {
    this.trayOpen = open;
    if (this.trayT === (open ? 1 : 0)) return Promise.resolve();
    return new Promise((resolve) => { const prev = this.trayDone; this.trayDone = () => { if (prev) prev(); resolve(); }; });
  }
  stepTray(dt) {
    const target = this.trayOpen ? 1 : 0;
    if (this.trayT === target) return;
    this.trayT = Math.max(0, Math.min(1, this.trayT + (this.trayOpen ? 1 : -1) * (dt / TRAY_MS)));
    if (this.trayT === target && this.trayDone) { const done = this.trayDone; this.trayDone = null; done(); }
  }

  /** A jolt: the disc shudders for a moment (disc noise's skip, when the window is shaken). */
  startWobble() { this.wobbleStart = performance.now(); }
  wobbleOffset(now) {
    const t = now - (this.wobbleStart || -1e9);
    if (t > 450) return 0;
    return Math.sin(t / 22) * (1 - t / 450) * 5;
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
    const label = this.cover || !this.label ? '' : `${this.label.title}\n${this.label.artist}`;
    const key = `${side}|${dpr}|${colors.bg}|${this.coverVersion || 0}|${this.lookingUp}|${label}|${this.wear ? this.wear.key : ''}`;
    if (this.faceCache && (this.faceKey === key || (this.suppressRebuild && this.faceCache.side === side))) return this.faceCache;
    const scale = dpr * (dpr >= 2 ? 1 : 2); // supersample on low-DPI screens for a clean rim
    const px = Math.max(1, Math.round(side * scale));
    const face = new OffscreenCanvas(px, px);
    const g = face.getContext('2d');
    g.scale(scale, scale);
    const c = side / 2;
    if (this.cover) {
      // A picture disc: the cover printed on the label, out from the mirror band (center-cropped if not square).
      g.save();
      g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.arc(c, c, c * LABEL_R, 0, Math.PI * 2, true); g.clip('evenodd');
      const iw = this.cover.naturalWidth, ih = this.cover.naturalHeight, s = Math.min(iw, ih);
      g.imageSmoothingQuality = 'high';
      g.drawImage(this.cover, (iw - s) / 2, (ih - s) / 2, s, s, 0, 0, side, side);
      g.restore();
      this.drawHub(g, c, side, true);
    } else {
      // No cover: a silver CD-R, the song's name written on it in marker (or "…" while a cover is being looked up).
      this.drawSilver(g, c, 0, c);
      this.drawHub(g, c, side, false);
      if (this.label) this.drawHandwriting(g, c, side);
      if (this.lookingUp) {
        g.textAlign = 'center'; g.fillStyle = 'rgba(30,32,60,0.55)';
        g.font = `bold ${Math.max(8, side / 26)}px ${FONT}`;
        g.fillText('…', c, c + c * 0.62);
      }
    }
    if (this.wear && side >= WEAR_MIN_SIDE) this.drawWear(g, c, side);
    g.lineWidth = 1.6; g.strokeStyle = 'rgba(255,255,255,0.63)';
    g.beginPath(); g.arc(c, c, c - 0.8, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,0.47)';
    g.beginPath(); g.arc(c, c, c - 3, 0, Math.PI * 2); g.stroke();
    const hole = side / 11;
    g.fillStyle = rgb(colors.bg);
    g.beginPath(); g.arc(c, c, hole / 2, 0, Math.PI * 2); g.fill();
    g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.235)'; g.stroke();
    if (this.wear && side >= WEAR_MIN_SIDE) this.drawChips(g, c);
    this.faceCache = { canvas: face, side };
    this.faceKey = key;
    return this.faceCache;
  }

  // Disc wear (disc-wear.js), on the face so it turns with the disc: hairline scratches, rubbed patches, scratches
  // worn round the way it spins and greasy thumbprints (and, once the rim is drawn, nicks out of it: drawChips).
  drawWear(g, c, side) {
    const w = this.wear, at = (r, a) => [c + Math.cos(a) * r * c, c + Math.sin(a) * r * c];
    g.save();
    g.lineCap = 'round';
    for (const s of w.scratches) this.traceScratch(g, c, s, (path) => {
      g.lineWidth = s.w; g.strokeStyle = `rgba(0,0,0,${(s.alpha * 0.45).toFixed(3)})`; g.stroke(path);
      g.lineWidth = s.w * 0.6; g.strokeStyle = `rgba(255,255,255,${s.alpha.toFixed(3)})`; g.stroke(path);
    });
    for (const s of w.rings) {
      g.lineWidth = s.w; g.strokeStyle = `rgba(255,255,255,${s.alpha.toFixed(3)})`;
      g.beginPath(); g.arc(c, c, s.r * c, s.a, s.a + s.span); g.stroke();
    }
    for (const s of w.scuffs) {
      const rnd = random(s.seed), [x, y] = at(s.r, s.a), spread = s.size * c;
      g.lineWidth = Math.max(0.5, side / 900);
      g.strokeStyle = `rgba(255,255,255,${s.alpha.toFixed(3)})`;
      g.beginPath();
      for (let i = 0; i < s.lines; i++) {
        const px = x + (rnd() - 0.5) * spread, py = y + (rnd() - 0.5) * spread;
        const dir = s.a + Math.PI / 2 + (rnd() - 0.5) * 0.8, len = spread * (0.15 + rnd() * 0.35);
        g.moveTo(px - Math.cos(dir) * len / 2, py - Math.sin(dir) * len / 2);
        g.lineTo(px + Math.cos(dir) * len / 2, py + Math.sin(dir) * len / 2);
      }
      g.stroke();
    }
    for (const s of w.prints) {
      const [x, y] = at(s.r, s.a), size = s.size * c;
      const smudge = g.createRadialGradient(x, y, 0, x, y, size * 1.1);
      smudge.addColorStop(0, `rgba(255,255,255,${(s.alpha * 0.55).toFixed(3)})`); smudge.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = smudge;
      g.beginPath(); g.arc(x, y, size * 1.1, 0, Math.PI * 2); g.fill();
      g.lineWidth = Math.max(0.5, (size / s.ridges) * 0.4);
      g.strokeStyle = `rgba(255,255,255,${s.alpha.toFixed(3)})`;
      // Broken, uneven ridges fading out toward the edge of the print, not a neat target.
      const rnd = random(s.seed);
      for (let i = 1; i <= s.ridges; i++) {
        const rx = (size * (i + (rnd() - 0.5) * 0.4)) / s.ridges, fade = 1 - (i / s.ridges) * 0.6;
        for (let k = 0; k < 3; k++) {
          const from = rnd() * Math.PI * 2, span = 0.5 + rnd() * 1.4;
          g.globalAlpha = fade * (0.5 + rnd() * 0.5);
          g.beginPath(); g.ellipse(x, y, rx, rx * 0.72, s.rot, from, from + span); g.stroke();
        }
      }
      g.globalAlpha = 1;
    }
    g.restore();
  }
  // Nicks out of the rim: cut after the rim's own lines are drawn, so they break them.
  drawChips(g, c) {
    g.save();
    for (const s of this.wear.chips) {
      const x = c + Math.cos(s.a) * c, y = c + Math.sin(s.a) * c, r = s.size * c;
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.globalCompositeOperation = 'source-over';
      g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.45)';
      g.beginPath(); g.arc(x, y, r, s.a + Math.PI * 0.55, s.a + Math.PI * 1.45); g.stroke();
    }
    g.restore();
  }
  // A hairline scratch: centered on its spot, across the way the disc turns, very slightly bent.
  traceScratch(g, c, s, stroke) {
    const x = c + Math.cos(s.a) * s.r * c, y = c + Math.sin(s.a) * s.r * c;
    const dir = s.a + Math.PI / 2 + s.tilt, half = (s.len * c) / 2;
    const dx = Math.cos(dir) * half, dy = Math.sin(dir) * half, bend = s.bend * c;
    const path = new Path2D();
    path.moveTo(x - dx, y - dy);
    path.quadraticCurveTo(x - dy / half * bend, y + dx / half * bend, x + dx, y + dy);
    stroke(path);
  }
  // Scratches catch the light: where the tilt shine's fans fall on them, they flash white. Drawn with the disc turned,
  // but lit only along the fans, which stay put with the light (see drawShine).
  drawGlint(g, cx, cy, side, dpr) {
    // Worked out at half the screen's resolution — it's a blur of light, and this runs every frame the disc turns.
    const px = Math.max(1, Math.round((side * dpr) / 2));
    if (!this.glint || this.glint.width !== px) {
      this.glint = new OffscreenCanvas(px, px);
      const s = this.glint.getContext('2d'), c = side / 2;
      s.scale(px / side, px / side); s.lineCap = 'round'; s.strokeStyle = '#fff';
      for (const sc of this.wear.scratches) this.traceScratch(s, c, sc, (path) => { s.lineWidth = sc.w * 1.2; s.stroke(path); });
      for (const r of this.wear.rings) { s.lineWidth = r.w * 1.2; s.beginPath(); s.arc(c, c, r.r * c, r.a, r.a + r.span); s.stroke(); }
      this.glintWork = new OffscreenCanvas(px, px);
    }
    const work = this.glintWork, w = work.getContext('2d'), c = px / 2, { angle, strength } = this.light;
    w.setTransform(1, 0, 0, 1, 0, 0);
    w.globalCompositeOperation = 'source-over';
    w.clearRect(0, 0, px, px);
    w.translate(c, c); w.rotate(this.angle); w.drawImage(this.glint, -c, -c); w.setTransform(1, 0, 0, 1, 0, 0);
    const fans = w.createConicGradient(angle - 0.2, c, c);
    for (const mid of [0, 0.5]) {
      fans.addColorStop(mid, 'rgba(0,0,0,0)'); fans.addColorStop(mid + 0.032, 'rgba(0,0,0,1)'); fans.addColorStop(mid + 0.064, 'rgba(0,0,0,0)');
    }
    w.globalCompositeOperation = 'destination-in';
    w.fillStyle = fans; w.fillRect(0, 0, px, px);
    g.save();
    g.globalCompositeOperation = 'screen';
    g.globalAlpha *= 0.25 + 0.45 * strength;
    g.drawImage(work, cx - side / 2, cy - side / 2, side, side);
    g.restore();
  }

  /** The data side: bare silver, the written area a shade darker, a faint ring where each track begins. Cached. */
  renderDataFace(side, dpr) {
    const key = `${side}|${dpr}|${colors.bg}|${this.data.key}`;
    if (this.dataFace && this.dataFace.key === key) return this.dataFace;
    const scale = dpr * (dpr >= 2 ? 1 : 2), px = Math.max(1, Math.round(side * scale));
    const face = new OffscreenCanvas(px, px), g = face.getContext('2d');
    g.scale(scale, scale);
    const c = side / 2, { layout } = this.data;
    this.drawSilver(g, c, 0, c);
    g.fillStyle = 'rgba(46,44,70,0.16)'; // where it's written
    g.beginPath(); g.arc(c, c, layout.end * c, 0, Math.PI * 2); g.arc(c, c, R0 * c, 0, Math.PI * 2, true); g.fill('evenodd');
    // Each track a band, every other one a touch darker, with a thin gap between them where the silence is.
    layout.tracks.forEach((t, i) => {
      if (i % 2) {
        g.fillStyle = 'rgba(30,30,50,0.09)';
        g.beginPath(); g.arc(c, c, t.r1 * c, 0, Math.PI * 2); g.arc(c, c, t.r0 * c, 0, Math.PI * 2, true); g.fill('evenodd');
      }
      if (!i) return;
      g.lineWidth = Math.max(1.2, side / 260); g.strokeStyle = 'rgba(16,16,28,0.34)';
      g.beginPath(); g.arc(c, c, t.r0 * c, 0, Math.PI * 2); g.stroke();
    });
    g.lineWidth = Math.max(1, side / 400); g.strokeStyle = 'rgba(20,20,34,0.22)';
    g.beginPath(); g.arc(c, c, layout.end * c, 0, Math.PI * 2); g.stroke(); // the end of the written area
    this.drawHub(g, c, side, false);
    g.lineWidth = 1.6; g.strokeStyle = 'rgba(255,255,255,0.63)';
    g.beginPath(); g.arc(c, c, c - 0.8, 0, Math.PI * 2); g.stroke();
    g.fillStyle = rgb(colors.bg);
    g.beginPath(); g.arc(c, c, side / 22, 0, Math.PI * 2); g.fill();
    this.dataFace = { key, canvas: face, side };
    return this.dataFace;
  }
  // The laser under the disc, where it's reading: a red point on the radius to the right, glowing.
  drawLaser(g, cx, cy, side) {
    if (!this.position) return;
    const r = radiusAt(this.data.layout, this.position()) * (side / 2), x = cx + r, y = cy;
    const glow = g.createRadialGradient(x, y, 0, x, y, side / 30);
    glow.addColorStop(0, 'rgba(255,60,60,0.95)'); glow.addColorStop(0.35, 'rgba(255,40,40,0.45)'); glow.addColorStop(1, 'rgba(255,0,0,0)');
    g.fillStyle = glow;
    g.beginPath(); g.arc(x, y, side / 30, 0, Math.PI * 2); g.fill();
  }

  // Brushed-silver data side: a conic sweep of greys with a faint rainbow tint, between radii r0 and r1.
  drawSilver(g, c, r0, r1) {
    const cone = g.createConicGradient(0.6, c, c);
    const stops = ['#d9dbe0', '#b9bcc4', '#eef0f3', '#c3c1cf', '#dfe3e1', '#b4b8c2', '#ecebf1', '#c8ccd2', '#d9dbe0'];
    stops.forEach((s, i) => cone.addColorStop(i / (stops.length - 1), s));
    g.save();
    g.fillStyle = cone;
    g.beginPath(); g.arc(c, c, r1, 0, Math.PI * 2); if (r0) g.arc(c, c, r0, 0, Math.PI * 2, true); g.fill('evenodd');
    g.restore();
  }
  // The middle of a real disc: the mirror band with its stamped matrix number, the clear plastic with the stacking
  // ring moulded into it, and the hole.
  drawHub(g, c, side, printed) {
    if (printed) this.drawSilver(g, c, c * CLEAR_R, c * LABEL_R);
    g.fillStyle = 'rgba(40,42,52,0.55)'; // clear plastic, the darkness behind it showing through
    g.beginPath(); g.arc(c, c, c * CLEAR_R, 0, Math.PI * 2); g.fill();
    g.lineWidth = Math.max(0.6, side / 400);
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    for (const r of [CLEAR_R, 0.205, 0.195]) { g.beginPath(); g.arc(c, c, c * r, 0, Math.PI * 2); g.stroke(); }
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.beginPath(); g.arc(c, c, c * LABEL_R, 0, Math.PI * 2); g.stroke();
    // The matrix number, tiny, round the inner edge of the mirror band.
    const text = 'CDP-0001  ·  MADE ON CDPLAYER  ·  11'; // printed on the disc, like a real one's matrix code
    g.save();
    g.fillStyle = 'rgba(60,62,72,0.45)'; g.font = `${Math.max(3, side / 120)}px ${FONT}`; g.textAlign = 'center';
    const radius = c * (CLEAR_R + 0.022), step = (side / 120) * 0.62 / radius;
    g.translate(c, c); g.rotate(-step * text.length / 2);
    for (const ch of text) { g.save(); g.translate(0, -radius); g.fillText(ch, 0, 0); g.restore(); g.rotate(step); }
    g.restore();
  }
  // The title across the top of the label and the artist under the hole, as if written with a marker: slightly
  // tilted, in dark blue ink, and shrunk to fit the width of the disc at that height.
  drawHandwriting(g, c, side) {
    const write = (text, y, size, tilt) => {
      const chord = 2 * Math.sqrt(Math.max(0, c * c - (y - c) * (y - c))) * 0.82;
      g.save();
      g.translate(c, y); g.rotate(tilt);
      let px = size;
      g.font = `${px}px ${MARKER_FONT}`;
      const w = g.measureText(text).width;
      if (w > chord) { px = Math.max(size * 0.45, px * chord / w); g.font = `${px}px ${MARKER_FONT}`; }
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(22,28,78,0.88)';
      g.fillText(text, 0, 0, chord);
      g.restore();
    };
    write(this.label.title, c - c * 0.6, side / 11, -0.06);
    if (this.label.artist) write(this.label.artist, c + c * 0.6, side / 15, 0.04);
  }

  /** Returns the drawn disc's bounds (CSS px, relative to the canvas) — used to keep theme particles off it. */
  frame(now, dt) {
    const cnv = this.canvas, dpr = window.devicePixelRatio || 1;
    const r = cnv.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const pw = Math.round(r.width * dpr), ph = Math.round(r.height * dpr);
    if (cnv.width !== pw || cnv.height !== ph) { cnv.width = pw; cnv.height = ph; }
    const tau = this.reading ? SPIN_TAU_MS * 3 : SPIN_TAU_MS;
    this.speed += ((this.spinning ? 1 : 0) - this.speed) * (1 - Math.exp(-dt / tau));
    if (this.speed < 0.002 && !this.spinning) this.speed = 0;
    if (this.fling) {
      const d = this.fling * dt;
      this.angle += d;
      if (this.onJog) this.onJog(d, dt);
      this.fling = coast(this.fling, dt);
      if (!this.fling) this.endJog();
    } else if (!this.jogging) this.angle += 0.045 * this.speed * (dt / 16);
    this.stepTray(dt);
    this.flipT = Math.max(0, Math.min(1, this.flipT + (this.flipped ? 1 : -1) * (dt / FLIP_MS)));

    const mini = this.mode === 'mini';
    const tray = mini ? 0 : easeInOutCubic(this.trayT);
    const a = SIZES[this.morph ? this.morph.from : this.mode], b = SIZES[this.morph ? this.morph.to : this.mode];
    const t = this.morph ? this.morph.t : 0;
    const cap = a.cap + (b.cap - a.cap) * t, margin = a.margin + (b.margin - a.margin) * t;
    const room = Math.min(r.width, r.height) - (mini ? margin : margin + 20);
    const side = Math.max(10, Math.floor(Math.min(cap, room)));
    const x = (r.width - side) / 2, y = (r.height - side) / 2, cx = x + side / 2, cy = y + side / 2;
    this.center = { x: r.left + cx, y: r.top + cy, r: side / 2 };
    let bounds = { x, y, w: side, h: side };

    this.artT = Math.max(0, Math.min(1, this.artT + (this.artOpen ? 1 : -1) * (dt / ART_MS)));
    const art = mini || !this.cover ? 0 : easeInOutCubic(this.artT);
    const eject = this.ejectProgress(now), wobble = this.wobbleOffset(now);
    this.stepLight(now, dt);
    this.artRect = null;
    if (!mini && this.cover && !(tray > 0)) {
      const cs = side + 60, thumb = Math.round(side * 0.193), full = cs - 28, size = thumb + (full - thumb) * art;
      this.artRect = { x: cx - cs / 2 + 14, y: cy - cs / 2 + 14, w: size, h: size };
    }
    if (!mini) { const cs = side + 60; bounds = { x: cx - cs / 2, y: cy - cs / 2, w: cs, h: cs }; }
    // Nothing that shows has changed since the last frame (a paused disc, the light at rest): leave the canvas be —
    // redrawing it 60 times a second anyway kept the GPU busy for nothing.
    const l = this.light;
    const look = [pw, ph, side, x, y, this.angle, this.speed, l.angle, l.strength, tray, art, eject, wobble, this.mode,
      this.faceKey, this.coverVersion, this.lookingUp, this.label && this.label.title, this.label && this.label.artist,
      this.discPresent, colors.accent, colors.accent2, colors.bg, dpr, this.flipT, this.data && this.data.key,
      this.flipT > 0 && this.data && this.position ? Math.round(radiusAt(this.data.layout, this.position()) * 2000) : 0].join('|');
    if (look === this.lastLook) return bounds;
    this.lastLook = look;
    const g = cnv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    let drawArt = null;
    if (!mini) {
      const cs = side + 60, caseX = cx - cs / 2, caseY = cy - cs / 2;
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

    // The tray: a dark plate with a recess for the disc, coming forward out of the case (drawn over it, with a shadow)
    // and carrying the disc with it.
    const trayDy = side * 0.16 * tray, trayScale = 1 + 0.05 * tray;
    if (tray > 0) {
      g.save();
      g.globalAlpha = Math.min(1, tray * 1.6);
      g.translate(cx, cy + trayDy); g.scale(trayScale, trayScale);
      const plate = side * 1.1;
      g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 24 * tray; g.shadowOffsetY = 10 * tray;
      const grad = g.createLinearGradient(0, -plate / 2, 0, plate / 2);
      grad.addColorStop(0, 'rgb(34,35,41)'); grad.addColorStop(1, 'rgb(16,16,20)');
      g.fillStyle = grad;
      g.beginPath(); g.roundRect(-plate / 2, -plate / 2, plate, plate, side * 0.03); g.fill();
      g.shadowColor = 'transparent';
      g.strokeStyle = 'rgba(255,255,255,0.1)'; g.lineWidth = 1; g.stroke();
      g.fillStyle = 'rgb(10,10,13)';
      g.beginPath(); g.arc(0, 0, side / 2 + side * 0.025, 0, Math.PI * 2); g.fill();
      g.strokeStyle = rgb(colors.accent, 0.35); g.stroke();
      g.restore();
    }
    g.save();
    if (!this.discPresent && tray > 0) g.globalAlpha = 0; // an empty tray
    g.translate(cx + wobble, cy + trayDy + wobble * 0.4); g.scale(trayScale, trayScale); g.translate(-cx, -cy);
    // As the full art opens, the disc sinks back a little and fades out underneath it.
    g.globalAlpha = 1 - art;
    g.translate(cx + side * 0.14 * eject, cy - side * 0.42 * eject);
    g.scale(1 - 0.08 * art, (1 - 0.08 * art) * (1 - 0.22 * eject));
    g.translate(-cx, -cy);
    // Turning over: the disc narrows to its edge and widens again showing its other side.
    const flip = easeInOutCubic(this.flipT), dataSide = !!this.data && flip >= 0.5;
    g.translate(cx, cy); g.scale(Math.max(0.02, Math.abs(Math.cos(Math.PI * flip))), 1); g.translate(-cx, -cy);
    const pad = Math.max(4, side / 90);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.arc(cx, cy, side / 2 + pad, 0, Math.PI * 2); g.fill();
    const face = dataSide ? this.renderDataFace(side, dpr) : this.renderFace(side, dpr);
    g.save();
    g.translate(cx, cy); g.rotate(this.angle); g.translate(-cx, -cy);
    g.imageSmoothingQuality = 'high';
    g.drawImage(face.canvas, x, y, side, side);
    g.restore();
    this.drawShine(g, cx, cy, side, dpr);
    if (this.wear && side >= WEAR_MIN_SIDE && !dataSide) this.drawGlint(g, cx, cy, side, dpr);
    if (dataSide) this.drawLaser(g, cx, cy, side);
    if (this.speed < 0.99) { // a stopped disc sits a little darker, brightening as it gets up to speed
      g.fillStyle = `rgba(10,11,16,${(0.35 * (1 - this.speed)).toFixed(3)})`;
      g.beginPath(); g.arc(cx, cy, side / 2, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    if (drawArt && tray < 1) { // the case's cover thumbnail steps aside while the tray is out
      g.save(); g.globalAlpha = 1 - tray; drawArt(this.cover); g.restore();
    }
    // The ⟲ in the case's corner that turns the disc over.
    this.flipRect = null;
    if (!mini && this.data && !(tray > 0) && !(art > 0)) {
      const cs = side + 60, r = 11, bx = cx + cs / 2 - 22, by = cy + cs / 2 - 22;
      this.flipRect = { x: bx, y: by, r };
      g.save();
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.strokeStyle = rgb(colors.accent, 0.6); g.lineWidth = 1.2;
      g.beginPath(); g.arc(bx, by, r, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = rgb(colors.accent2); g.font = `bold 13px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('⟲', bx, by + 1);
      g.restore();
    }
    return bounds;
  }

  get animating() { return this.spinning || this.speed > 0 || this.trayT > 0 || this.ejectStart >= 0 || this.jogging || this.flipT !== (this.flipped ? 1 : 0); }
}
