// Disc noise (Settings → DISC NOISE, off by default): the sounds of a real CD player, synthesized — a faint hiss under
// the music, the tray motor, the whir of the disc spinning up, and the stutter of a skip when the window is shaken.
// Everything goes into the player's own output after the EQ, so the volume slider (and mute) apply to it too.

const HISS_GAIN = 0.0035;

function noiseBuffer(ctx, seconds, brown = false) {
  const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * white) / 1.02; data[i] = last * 3.5; } else data[i] = white;
  }
  return buf;
}

export class DiscNoise {
  constructor(engine) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.out = this.ctx.createGain();
    this.out.connect(engine.master);
    this.enabled = false;
    this.white = noiseBuffer(this.ctx, 2);
    this.brown = noiseBuffer(this.ctx, 2, true);
    // The hiss: looped white noise, band-limited to the airy top end, faded in only while playing.
    this.hiss = this.ctx.createGain();
    this.hiss.gain.value = 0;
    const src = this.ctx.createBufferSource();
    src.buffer = this.white; src.loop = true;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 11000;
    src.connect(hp); hp.connect(lp); lp.connect(this.hiss); this.hiss.connect(this.out);
    src.start();
  }

  setEnabled(on) { this.enabled = on; if (!on) this.setPlaying(false); }
  /** The hiss follows playback: it's the disc's surface, so it's only there while the disc turns. */
  setPlaying(playing) {
    const now = this.ctx.currentTime;
    this.hiss.gain.cancelScheduledValues(now);
    this.hiss.gain.setTargetAtTime(this.enabled && playing ? HISS_GAIN : 0, now, 0.15);
  }

  // A burst of filtered noise with an envelope: the building block of the mechanical sounds.
  burst({ buffer = this.brown, type = 'bandpass', freq = 200, q = 1, gain = 0.1, attack = 0.02, hold = 0.2, release = 0.1, sweepTo = null }) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + attack + hold);
    const env = ctx.createGain(); env.gain.value = 0;
    env.gain.linearRampToValueAtTime(gain, t + attack);
    env.gain.setValueAtTime(gain, t + attack + hold);
    env.gain.linearRampToValueAtTime(0, t + attack + hold + release);
    src.connect(filter); filter.connect(env); env.connect(this.out);
    src.start(t); src.stop(t + attack + hold + release + 0.05);
  }
  click(gain = 0.08) { this.burst({ buffer: this.white, type: 'highpass', freq: 1800, gain, attack: 0.002, hold: 0.004, release: 0.03 }); }

  /** The tray motor running for `ms`, ending in the clunk of the tray reaching its stop. */
  tray(ms) {
    if (!this.enabled) return;
    this.burst({ freq: 170, q: 3, gain: 0.35, attack: 0.04, hold: ms / 1000 - 0.1, release: 0.06 });
    this.burst({ buffer: this.white, freq: 2400, q: 2, gain: 0.018, attack: 0.04, hold: ms / 1000 - 0.1, release: 0.06 });
    setTimeout(() => { this.click(0.12); this.burst({ freq: 90, q: 2, gain: 0.5, attack: 0.003, hold: 0.02, release: 0.08 }); }, ms - 20);
  }
  /** The disc spinning up while the drive reads it: a rising whir, and the pickup seeking. */
  spinUp(ms) {
    if (!this.enabled) return;
    this.burst({ buffer: this.white, freq: 300, sweepTo: 2600, q: 4, gain: 0.03, attack: ms / 2000, hold: ms / 2000, release: 0.25 });
    for (let i = 0; i < 4; i++) setTimeout(() => this.click(0.04), 200 + i * (ms / 5) + Math.random() * 60);
  }
  /** A skip: the pickup losing its place — a click, a tiny repeat of what just played, and the music carrying on. */
  skip() {
    const { engine } = this;
    if (!engine.playing) return;
    const back = 0.14;
    let n = 0;
    const jump = () => {
      if (!engine.playing) return;
      this.click(0.1);
      engine.seek(Math.max(0, engine.position - back));
      if (++n < 3) setTimeout(jump, 110 + Math.random() * 40);
    };
    jump();
  }
}

/**
 * A shaken window: the window's position swings back and forth — at least four changes of direction of 25px or more
 * within a second. Fed the window position every frame; → true (once) when that just happened.
 */
export class ShakeDetector {
  constructor({ reversals = 4, distance = 25, windowMs = 1000 } = {}) {
    Object.assign(this, { reversals, distance, windowMs, turns: [], anchor: null, dir: 0, last: null, cooldownUntil: 0 });
  }
  feed(x, y, t) {
    if (this.last && this.last.x === x && this.last.y === y) return false;
    this.last = { x, y };
    if (!this.anchor) { this.anchor = { x, y }; return false; }
    // Horizontal or vertical, whichever the window is moving along most.
    const dx = x - this.anchor.x, dy = y - this.anchor.y;
    const along = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    if (Math.abs(along) < this.distance) return false;
    const dir = Math.sign(along);
    if (dir !== this.dir) {
      if (this.dir !== 0) this.turns.push(t);
      this.dir = dir;
    }
    this.anchor = { x, y };
    this.turns = this.turns.filter((when) => t - when <= this.windowMs);
    if (this.turns.length >= this.reversals && t >= this.cooldownUntil) {
      this.turns = []; this.cooldownUntil = t + 1500;
      return true;
    }
    return false;
  }
}
