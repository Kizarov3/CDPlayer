// Settings → SPATIAL AUDIO: stereo heard on headphones as if from two speakers in front of you, like Apple's
// "spatialize stereo", instead of from inside your head. The left and right channels each go through a head-related
// (HRTF) panner placed where a speaker would stand, 30° either side; a short, quiet room joins them, and a little of
// the plain stereo keeps the voice in the middle from sinking back. Off, the music passes straight through.
//
//   input ─┬──────────── dry ─────────────────────┐
//          ├──────────── center ──────────────────┤
//          └→ L/R → HRTF panners → speakers ──────┼→ output
//                                   └→ room ──────┘

export const SPEAKER_ANGLE = 30; // degrees either side of straight ahead, as a stereo pair is set up

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/** The four levels of the mix, on or off, for `amount` 0–1 (how much room and space). */
export function spatialMix(on, amount) {
  if (!on) return { dry: 1, speakers: 0, center: 0, room: 0 };
  const a = clamp01(amount);
  return { dry: 0, speakers: 0.9, center: 0.3 * (1 - 0.6 * a), room: 0.12 + 0.38 * a };
}

/** Where a speaker `degrees` off centre stands, one unit away — the listener faces −z. */
export function speakerPosition(degrees) {
  const r = (degrees * Math.PI) / 180;
  return { x: Math.sin(r), z: -Math.cos(r) };
}

// A fixed pseudo-random sequence, so the room sounds the same every time.
function noise(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
  };
}

/**
 * A small room's echo: after 10 ms, decaying noise — different in each ear, for width — that has died by 0.4 s,
 * softened as it goes the way a room swallows the treble. Normalised to unit energy, so spatialMix sets its level.
 */
export function roomImpulse(ctx, seconds = 0.4, predelay = 0.01) {
  const rate = ctx.sampleRate, length = Math.round(rate * seconds), start = Math.round(rate * predelay);
  const buf = ctx.createBuffer(2, length, rate);
  let energy = 0;
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c), rnd = noise(c ? 0x51a7 : 0x1eaf);
    let smooth = 0;
    for (let i = start; i < length; i++) {
      const t = (i - start) / rate, life = t / (seconds - predelay);
      const soft = 0.2 + 0.7 * life; // more smoothing (less treble) as the echo ages
      smooth += (rnd() - smooth) * (1 - soft);
      data[i] = smooth * Math.exp(-6.9 * life); // −60 dB at the end
      energy += data[i] * data[i];
    }
  }
  const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
  for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < length; i++) d[i] *= scale; }
  return buf;
}

function place(panner, { x, z }) {
  if (panner.positionX) { panner.positionX.value = x; panner.positionY.value = 0; panner.positionZ.value = z; }
  else panner.setPosition(x, 0, z);
}

/** The effect's nodes in `ctx`: connect into `input`, out of `output`; set(on, amount) fades between mixes. */
export class Spatializer {
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    for (const name of ['dry', 'center', 'speakers', 'room']) this[name] = ctx.createGain();
    this.input.connect(this.dry); this.dry.connect(this.output);
    this.input.connect(this.center); this.center.connect(this.output);
    const split = ctx.createChannelSplitter(2);
    this.input.connect(split);
    [-SPEAKER_ANGLE, SPEAKER_ANGLE].forEach((degrees, channel) => {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'linear';
      p.refDistance = 1;
      p.rolloffFactor = 0; // the speakers are where they are: no fading with distance
      place(p, speakerPosition(degrees));
      split.connect(p, channel);
      p.connect(this.speakers);
    });
    this.speakers.connect(this.output);
    const room = ctx.createConvolver();
    room.normalize = false;
    room.buffer = roomImpulse(ctx);
    this.speakers.connect(room);
    room.connect(this.room);
    this.room.connect(this.output);
    this.set(false, 0, { now: true });
  }

  /** On or off, and how much space; faded over a few tens of milliseconds so it never clicks. */
  set(on, amount, { now = false } = {}) {
    const mix = spatialMix(on, amount);
    for (const [name, level] of Object.entries(mix)) {
      const g = this[name].gain;
      if (now) g.value = level; else g.setTargetAtTime(level, this.ctx.currentTime, 0.03);
    }
  }
}
