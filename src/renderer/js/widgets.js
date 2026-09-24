// Custom-painted controls matching the Java app's look: canvas sliders (accent-gradient track, round thumb with a
// halo, optional waveform), pill buttons with an animated ON state, and round transport / mode buttons.
import { colors, rgb, onColorsChanged } from './theme.js';
import { glyphSvg } from './glyphs.js';

export const anim = { enabled: true };

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

export function pulse(node, strong = false) {
  if (!anim.enabled) return;
  const cls = strong ? 'pulse-strong' : 'pulse';
  node.classList.remove('pulse', 'pulse-strong');
  void node.offsetWidth; // restart the animation
  node.classList.add(cls);
  node.addEventListener('animationend', () => node.classList.remove(cls), { once: true });
}

export function pill(caption, onClick, title) {
  const b = el('button', { class: 'pill', title }, caption);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/** An ON/OFF pill (Settings toggles): gradient fill when on, crossfaded, with a squish pulse on change. */
export function toggle(isOn, onClick) {
  const b = pill(isOn ? 'ON' : 'OFF', onClick);
  b.classList.toggle('on', isOn);
  return b;
}
export function setToggle(button, isOn) {
  if (button.classList.contains('on') === isOn) return;
  button.textContent = isOn ? 'ON' : 'OFF';
  button.classList.toggle('on', isOn);
  pulse(button);
}

export function roundButton(glyph, size, { primary = false, title, onClick } = {}) {
  const b = el('button', { class: `round${primary ? ' primary' : ''}`, title });
  b.style.width = b.style.height = `${size}px`;
  b.append(glyphSvg(glyph, size));
  b.setGlyph = (g) => { if (b.glyph !== g) { b.glyph = g; b.replaceChildren(glyphSvg(g, size)); } };
  b.glyph = glyph;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/** Shuffle / Repeat: 40px circle, gradient when on, optional small badge ("1" for repeat-one). */
export function modeButton(glyph, title, onClick) {
  const b = roundButton(glyph, 40, { title, onClick });
  b.classList.add('mode');
  const badge = el('span', { class: 'badge' });
  Object.assign(badge.style, { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', fontSize: '11px', fontWeight: 'bold', pointerEvents: 'none' });
  b.append(badge);
  b.setOn = (on) => { if (b.classList.contains('on') !== on) { b.classList.toggle('on', on); pulse(b, true); } };
  b.setBadge = (text) => { badge.textContent = text || ''; };
  return b;
}

// ---- Slider ---------------------------------------------------------------------------------------------------

const THUMB = 11;
const allSliders = new Set();
onColorsChanged(() => { for (const s of allSliders) s.draw(); });

export class Slider {
  /**
   * @param {object} o min, max, value, onInput(value) while dragging, onChange(value) on release,
   *   waveform: true for the seek bar (can draw the track's amplitude shape instead of a line).
   */
  constructor({ min = 0, max = 100, value = 0, onInput, onChange, waveform = false, trackHeight = 14 } = {}) {
    Object.assign(this, { min, max, value, onInput, onChange, trackHeight });
    this.waveformCapable = waveform;
    this.waveformEnabled = true;
    this.waveform = null;
    this.dragging = false;
    this.enabled = true;
    this.canvas = el('canvas', { class: 'slider' });
    Object.assign(this.canvas.style, { display: 'block', width: '100%', height: '100%', cursor: 'pointer', touchAction: 'none' });
    this.canvas.addEventListener('pointerdown', (e) => this.pointer(e, 'down'));
    this.canvas.addEventListener('pointermove', (e) => this.dragging && this.pointer(e, 'move'));
    this.canvas.addEventListener('pointerup', (e) => this.dragging && this.pointer(e, 'up'));
    this.canvas.addEventListener('pointercancel', (e) => this.dragging && this.pointer(e, 'up'));
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    allSliders.add(this);
  }
  mount(parent) { parent.append(this.canvas); this.resize(); return this; }
  resize() {
    const r = this.canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!r.width) return;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.draw();
  }
  get track() {
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    return { x: THUMB / 2, w: Math.max(1, w - THUMB) };
  }
  valueForX(x) {
    const { x: tx, w } = this.track;
    const f = Math.max(0, Math.min(1, (x - tx) / w));
    return Math.round(this.min + f * (this.max - this.min));
  }
  pointer(e, phase) {
    if (!this.enabled) return;
    const x = e.clientX - this.canvas.getBoundingClientRect().left;
    if (phase === 'down') { this.dragging = true; this.canvas.setPointerCapture(e.pointerId); }
    const v = this.valueForX(x);
    if (v !== this.value || phase === 'down') { this.value = v; this.draw(); if (phase !== 'up' && this.onInput) this.onInput(v); }
    if (phase === 'up') {
      this.dragging = false;
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      if (this.onChange) this.onChange(v);
    }
  }
  setValue(v) {
    if (this.dragging) return; // never fight the user's own drag
    v = Math.max(this.min, Math.min(this.max, v));
    if (v === this.value) return;
    this.value = v;
    this.draw();
  }
  setWaveform(data) { this.waveform = data; this.draw(); }
  setWaveformEnabled(on) { this.waveformEnabled = on; this.draw(); }
  draw() {
    const c = this.canvas, ctx = c.getContext('2d'), dpr = window.devicePixelRatio || 1;
    if (!c.width) return;
    const w = c.width / dpr, h = c.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const { x: tx, w: tw } = this.track;
    const f = this.max > this.min ? (this.value - this.min) / (this.max - this.min) : 0;
    const thumbX = tx + f * tw, cy = h / 2;
    if (this.waveformCapable && this.waveformEnabled && this.waveform && this.waveform.length) {
      const n = this.waveform.length, maxBar = Math.max(4, Math.min(h, this.trackHeight) - 2);
      for (let i = 0; i < n; i++) {
        const x = Math.floor(tx + (i * tw) / n);
        const bw = Math.max(1, Math.floor(tx + ((i + 1) * tw) / n) - x - 1);
        const bh = Math.max(2, Math.round(this.waveform[i] * maxBar));
        ctx.fillStyle = x <= thumbX ? rgb(colors.accent) : 'rgba(255,255,255,0.137)';
        roundRect(ctx, x, cy - bh / 2, bw, bh, 1);
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      roundRect(ctx, tx, cy - 1.5, tw, 3, 1.5);
      const fill = thumbX - tx;
      if (fill > 0) {
        const g = ctx.createLinearGradient(tx, 0, tx + Math.max(1, fill), 0);
        g.addColorStop(0, rgb(colors.accent)); g.addColorStop(1, rgb(colors.accent2));
        ctx.fillStyle = g;
        roundRect(ctx, tx, cy - 1.5, fill, 3, 1.5);
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.137)';
    ctx.beginPath(); ctx.arc(thumbX, cy, THUMB / 2 + 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgb(colors.text);
    ctx.beginPath(); ctx.arc(thumbX, cy, THUMB / 2, 0, Math.PI * 2); ctx.fill();
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  ctx.fill();
}

/** Shrinks a label's font (down to minSize) until the text fits maxWidth; CSS ellipsizes anything still too long. */
const measureCtx = document.createElement('canvas').getContext('2d');
export function fitText(node, text, maxWidth, startSize, minSize, bold) {
  const family = getComputedStyle(document.documentElement).getPropertyValue('--font');
  let size = startSize;
  const width = (s) => { measureCtx.font = `${bold ? 'bold ' : ''}${s}px ${family}`; return measureCtx.measureText(text).width; };
  while (size > minSize && width(size) > maxWidth) size--;
  node.style.fontSize = `${size}px`;
  node.style.maxWidth = `min(${maxWidth}px, 100%)`;
  node.textContent = text;
  node.title = text;
}
